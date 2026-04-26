"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { CompanyWithGoals, Person } from "@/lib/types/tracker";
import { AtlasBreadcrumbs, type AtlasCrumb } from "./AtlasBreadcrumbs";
import { AtlasCompany } from "./AtlasCompany";
import { AtlasGoal } from "./AtlasGoal";
import { AtlasGroupingToggle } from "./AtlasGroupingToggle";
import { AtlasMilestone } from "./AtlasMilestone";
import { AtlasMilestonePanel } from "./AtlasMilestonePanel";
import { AtlasProject } from "./AtlasProject";
import { AtlasStarfield } from "./AtlasStarfield";
import {
  CANVAS_H,
  CANVAS_W,
  getMilestonePathGeometry,
  layoutCompanies,
  layoutCompanyInner,
  positionMilestones,
} from "./atlas-layout";
import { calendarDaysFromTodayYmd } from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";
import type {
  CameraTarget,
  GroupingKey,
  LaidCompany,
  LaidGoal,
  LaidMilestone,
  LaidProject,
} from "./atlas-types";

interface PortfolioAtlasProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
}

/**
 * Focus path: [companyId, goalId, projectId, milestoneId]. Length = current
 * zoom level (0 = overview, 4 = milestone panel open).
 */
type FocusPath = string[];

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Euclidean distance between two 2D points (used for hit-testing circles). */
function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

/** Deterministic 0–1 PRNG from a string seed + numeric salt (FNV-1a). */
function seededRandom(seed: string, salt: number): number {
  let h = 2166136261;
  const combined = `${seed}:${salt}`;
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/**
 * Build a per-entity SMIL drift descriptor — an orbital wander with four
 * distinct stops so the motion never reads as back-and-forth on a single
 * axis. Each entity gets unique offsets, duration (8–14s), and a negative
 * begin time so its phase is out of sync with its siblings. SMIL is used
 * (rather than CSS keyframes) because animating `transform` on SVG `<g>`
 * elements via CSS has historically been unreliable across engines —
 * `<animateTransform>` is purpose-built for SVG and works everywhere.
 *
 * `amplitudeScale` cascades: companies use 1.0, goals 0.5, projects 0.25 —
 * so the deeper you drill, the more delicately the bubbles drift.
 */
interface DriftDescriptor {
  /** Space-separated translation values for SMIL (5 stops: 0, A, B, A', 0). */
  values: string;
  dur: string;
  begin: string;
}

function driftDescriptorFor(seed: string, amplitudeScale = 1): DriftDescriptor {
  const ax = (seededRandom(seed, 1) * 2 - 1) * 10 * amplitudeScale;
  const ay = (seededRandom(seed, 2) * 2 - 1) * 8 * amplitudeScale;
  const bx = (seededRandom(seed, 5) * 2 - 1) * 8 * amplitudeScale;
  const by = (seededRandom(seed, 6) * 2 - 1) * 10 * amplitudeScale;
  const cx = ax * -0.55;
  const cy = ay * 0.55;
  const dur = 8 + seededRandom(seed, 3) * 6;
  const beginOffset = -seededRandom(seed, 4) * dur;
  const fmt = (n: number) => n.toFixed(2);
  return {
    values: `0 0; ${fmt(ax)} ${fmt(ay)}; ${fmt(bx)} ${fmt(by)}; ${fmt(cx)} ${fmt(cy)}; 0 0`,
    dur: `${dur.toFixed(2)}s`,
    begin: `${beginOffset.toFixed(2)}s`,
  };
}

/**
 * Read the *live* translate applied to a drift `<g>` (SMIL `animateTransform`
 * updates `transform.animVal` in supporting browsers).
 */
function readDriftTranslate(g: SVGGElement): { tx: number; ty: number } {
  const t = g.transform;
  if (!t) return { tx: 0, ty: 0 };
  const list =
    t.animVal.numberOfItems > 0 ? t.animVal : t.baseVal;
  if (list.numberOfItems === 0) return { tx: 0, ty: 0 };
  const m = list.getItem(0).matrix;
  return { tx: m.e, ty: m.f };
}

const HINTS = [
  "Click a company to zoom in",
  "Click a goal to see its projects",
  "Click a project to reveal milestones",
  "Click a milestone to open its Slack thread",
  "Press Esc to close",
];

/**
 * User-driven camera — overrides the focus-driven camera when the user
 * actively wheel-zooms or drags the canvas. Cleared when a new focus is
 * committed (click or auto-descend) so the camera snaps to the new target.
 */
interface UserCamera {
  cx: number;
  cy: number;
  scale: number;
}

const MIN_CAMERA_SCALE = 0.7;
const MAX_CAMERA_SCALE = 16;
/**
 * At company-only focus, wheel zoom-out pops to the portfolio when scale
 * falls below this fraction of the focus "natural" scale. Lower = user must
 * zoom out further before leaving the company view.
 */
const ZOOM_OUT_TO_PORTFOLIO_FRAC = 0.68;
/**
 * Wheel zoom uses `exp(-deltaY / WHEEL_ZOOM_SENSITIVITY)`. Larger values
 * make each scroll step change scale more gently.
 */
const WHEEL_ZOOM_SENSITIVITY = 800;
/** Distance (px) of pointer movement required to treat pointerdown/up as a drag (not a click). */
const DRAG_THRESHOLD_PX = 4;

export function PortfolioAtlas({ hierarchy, people }: PortfolioAtlasProps) {
  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [grouping, setGroupingState] = useState<GroupingKey>("goal");
  const [userCamera, setUserCamera] = useState<UserCamera | null>(null);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  /**
   * Overview only: freeze SMIL drift at the current translate + timeline
   * position so hover pauses without snapping to the origin.
   */
  const [driftHoverFreeze, setDriftHoverFreeze] = useState<{
    id: string;
    tx: number;
    ty: number;
    resumeT: number;
  } | null>(null);
  const driftBeginOverrideSecRef = useRef<Record<string, number>>({});

  /**
   * Switching grouping invalidates layout positions (goals are placed by a
   * grouping-aware seed). Drop back to the company level so the user can
   * pick a new goal in the new layout.
   */
  const setGrouping = useCallback((next: GroupingKey) => {
    setGroupingState(next);
    setFocusPath((prev) => (prev.length > 1 ? prev.slice(0, 1) : prev));
    setUserCamera(null);
  }, []);

  const peopleById = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of people) map.set(p.id, p);
    return map;
  }, [people]);

  const companies = useMemo<LaidCompany[]>(
    () => layoutCompanies(hierarchy),
    [hierarchy]
  );

  const focusedCompany = useMemo(
    () => (focusPath[0] ? companies.find((c) => c.id === focusPath[0]) : undefined),
    [focusPath, companies]
  );

  const inner = useMemo(() => {
    if (!focusedCompany) return null;
    return layoutCompanyInner(focusedCompany, grouping, peopleById);
  }, [focusedCompany, grouping, peopleById]);

  const focusedGoal = useMemo<LaidGoal | undefined>(() => {
    if (!inner || !focusPath[1]) return undefined;
    return inner.goals.find((g) => g.bucketKey === focusPath[1]);
  }, [inner, focusPath]);

  const focusedProject = useMemo<LaidProject | undefined>(() => {
    if (!inner || !focusPath[2]) return undefined;
    return inner.projects.find((p) => p.id === focusPath[2]);
  }, [inner, focusPath]);

  const focusedMilestones = useMemo(() => {
    if (!focusedProject) return [];
    return positionMilestones(focusedProject);
  }, [focusedProject]);

  const focusedMilestoneLaid = useMemo(() => {
    if (!focusPath[3]) return undefined;
    return focusedMilestones.find((m) => m.id === focusPath[3]);
  }, [focusPath, focusedMilestones]);

  const level = focusPath.length;

  const cameraTarget = useMemo<CameraTarget | null>(() => {
    if (focusedProject) return focusedProject;
    if (focusedGoal) return focusedGoal;
    if (focusedCompany) return focusedCompany;
    return null;
  }, [focusedCompany, focusedGoal, focusedProject]);

  const { scale, tx, ty, isUserDriven } = useMemo(() => {
    if (userCamera) {
      return {
        scale: userCamera.scale,
        tx: CANVAS_W / 2 - userCamera.cx * userCamera.scale,
        ty: CANVAS_H / 2 - userCamera.cy * userCamera.scale,
        isUserDriven: true,
      };
    }
    if (!cameraTarget) {
      return { scale: 1, tx: 0, ty: 0, isUserDriven: false };
    }
    const s = Math.min(CANVAS_W, CANVAS_H) / (cameraTarget.r * 2.9);
    return {
      scale: s,
      tx: CANVAS_W / 2 - cameraTarget.cx * s,
      ty: CANVAS_H / 2 - cameraTarget.cy * s,
      isUserDriven: false,
    };
  }, [cameraTarget, userCamera]);

  const popLevel = useCallback(() => {
    setUserCamera(null);
    setFocusPath((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const fitToAll = useCallback(() => {
    setUserCamera(null);
    setFocusPath([]);
  }, []);

  const crumbs: AtlasCrumb[] = [
    {
      label: "Portfolio",
      onClick: fitToAll,
      active: focusPath.length === 0,
    },
  ];
  if (focusedCompany) {
    crumbs.push({
      label: focusedCompany.name,
      onClick: () => setFocusPath([focusedCompany.id]),
      active: focusPath.length === 1,
    });
  }
  if (focusedGoal && focusedCompany) {
    crumbs.push({
      label: truncate(focusedGoal.label, 28),
      onClick: () => setFocusPath([focusedCompany.id, focusedGoal.bucketKey]),
      active: focusPath.length === 2,
    });
  }
  if (focusedProject && focusedCompany && focusedGoal) {
    crumbs.push({
      label: focusedProject.project.name,
      onClick: () =>
        setFocusPath([
          focusedCompany.id,
          focusedGoal.bucketKey,
          focusedProject.id,
        ]),
      active: focusPath.length === 3,
    });
  }
  if (focusedMilestoneLaid) {
    crumbs.push({
      label: truncate(focusedMilestoneLaid.milestone.name, 22),
      onClick: () => {},
      active: true,
    });
  }

  // ---------------------------------------------------------------------
  // Wheel-zoom + pointer-drag + auto-descend.
  // ---------------------------------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    moved: boolean;
    originCam: { cx: number; cy: number; scale: number };
  } | null>(null);
  const autoDescendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorSvg = useRef<{ x: number; y: number } | null>(null);
  const wheelTargetRef = useRef<UserCamera | null>(null);
  const wheelIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clientToSvgWithCamera = useCallback(
    (
      clientX: number,
      clientY: number,
      camScale: number,
      camTx: number,
      camTy: number
    ): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const vbAspect = CANVAS_W / CANVAS_H;
      const rectAspect = rect.width / rect.height;
      let visW: number;
      let visH: number;
      let offsetX: number;
      let offsetY: number;
      if (rectAspect > vbAspect) {
        visH = rect.height;
        visW = visH * vbAspect;
        offsetX = (rect.width - visW) / 2;
        offsetY = 0;
      } else {
        visW = rect.width;
        visH = visW / vbAspect;
        offsetX = 0;
        offsetY = (rect.height - visH) / 2;
      }
      const px = clientX - rect.left - offsetX;
      const py = clientY - rect.top - offsetY;
      const vbX = (px / visW) * CANVAS_W;
      const vbY = (py / visH) * CANVAS_H;
      const x = (vbX - camTx) / camScale;
      const y = (vbY - camTy) / camScale;
      return { x, y };
    },
    []
  );

  const runAutoDescend = useCallback(() => {
    const cursor = lastCursorSvg.current;
    if (!cursor) return;
    const focusScale = cameraTarget
      ? Math.min(CANVAS_W, CANVAS_H) / (cameraTarget.r * 2.9)
      : 1;
    if (scale < focusScale * 1.6) return;

    const currentLevel = focusPath.length;

    if (currentLevel === 0) {
      const hit = companies.find(
        (c) => dist(c.cx, c.cy, cursor.x, cursor.y) <= c.r
      );
      if (hit) {
        setFocusPath([hit.id]);
        setUserCamera(null);
      }
      return;
    }

    if (currentLevel === 1 && inner && focusedCompany) {
      const hitGoal = inner.goals.find(
        (g) => dist(g.cx, g.cy, cursor.x, cursor.y) <= g.r
      );
      if (hitGoal) {
        setFocusPath([focusedCompany.id, hitGoal.bucketKey]);
        setUserCamera(null);
      }
      return;
    }

    if (currentLevel === 2 && inner && focusedCompany && focusedGoal) {
      const hitProject = inner.projects
        .filter((p) => p.bucketKey === focusedGoal.bucketKey)
        .find((p) => dist(p.cx, p.cy, cursor.x, cursor.y) <= p.r);
      if (hitProject) {
        setFocusPath([
          focusedCompany.id,
          focusedGoal.bucketKey,
          hitProject.id,
        ]);
        setUserCamera(null);
      }
      return;
    }

    if (currentLevel === 3 && focusedProject && focusedCompany && focusedGoal) {
      const laid = positionMilestones(focusedProject);
      const hitMilestone = laid.find(
        (m) => dist(m.cx, m.cy, cursor.x, cursor.y) <= m.r
      );
      if (hitMilestone) {
        setFocusPath([
          focusedCompany.id,
          focusedGoal.bucketKey,
          focusedProject.id,
          hitMilestone.id,
        ]);
        setUserCamera(null);
      }
    }
  }, [
    cameraTarget,
    companies,
    focusedCompany,
    focusedGoal,
    focusedProject,
    focusPath,
    inner,
    scale,
  ]);

  const scheduleAutoDescend = useCallback(() => {
    if (autoDescendTimer.current) clearTimeout(autoDescendTimer.current);
    autoDescendTimer.current = setTimeout(() => {
      runAutoDescend();
    }, 220);
  }, [runAutoDescend]);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      e.stopPropagation();

      const baseScale = wheelTargetRef.current?.scale ?? scale;
      const baseTx =
        wheelTargetRef.current
          ? CANVAS_W / 2 - wheelTargetRef.current.cx * wheelTargetRef.current.scale
          : tx;
      const baseTy =
        wheelTargetRef.current
          ? CANVAS_H / 2 - wheelTargetRef.current.cy * wheelTargetRef.current.scale
          : ty;

      const cursor = clientToSvgWithCamera(
        e.clientX,
        e.clientY,
        baseScale,
        baseTx,
        baseTy
      );
      if (!cursor) return;
      lastCursorSvg.current = cursor;

      const factor = Math.exp(-e.deltaY / WHEEL_ZOOM_SENSITIVITY);
      const nextScale = Math.max(
        MIN_CAMERA_SCALE,
        Math.min(MAX_CAMERA_SCALE, baseScale * factor)
      );
      if (nextScale === baseScale) return;

      // Company (goals) view only: scroll-zoom out past the "natural" framing
      // for this company returns to the full portfolio.
      if (
        focusPath.length === 1 &&
        e.deltaY > 0 &&
        focusedCompany
      ) {
        const naturalScale =
          Math.min(CANVAS_W, CANVAS_H) / (focusedCompany.r * 2.9);
        if (nextScale < naturalScale * ZOOM_OUT_TO_PORTFOLIO_FRAC) {
          if (wheelIdleTimer.current) {
            clearTimeout(wheelIdleTimer.current);
            wheelIdleTimer.current = null;
          }
          wheelTargetRef.current = null;
          setIsWheelZooming(false);
          setUserCamera(null);
          setFocusPath([]);
          return;
        }
      }

      const newTx = baseTx + (baseScale - nextScale) * cursor.x;
      const newTy = baseTy + (baseScale - nextScale) * cursor.y;
      const nextTarget: UserCamera = {
        cx: (CANVAS_W / 2 - newTx) / nextScale,
        cy: (CANVAS_H / 2 - newTy) / nextScale,
        scale: nextScale,
      };
      wheelTargetRef.current = nextTarget;
      setUserCamera(nextTarget);
      setIsWheelZooming(true);

      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current);
      wheelIdleTimer.current = setTimeout(() => {
        wheelTargetRef.current = null;
        setIsWheelZooming(false);
      }, 220);

      scheduleAutoDescend();
    },
    [
      clientToSvgWithCamera,
      focusPath,
      focusedCompany,
      scale,
      scheduleAutoDescend,
      tx,
      ty,
    ]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target && target !== e.currentTarget && target.closest("[data-atlas-interactive=true]")) {
        return;
      }
      if (wheelIdleTimer.current) {
        clearTimeout(wheelIdleTimer.current);
        wheelIdleTimer.current = null;
      }
      wheelTargetRef.current = null;
      if (isWheelZooming) setIsWheelZooming(false);
      const originCx = (CANVAS_W / 2 - tx) / scale;
      const originCy = (CANVAS_H / 2 - ty) / scale;
      pointerRef.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        originCam: { cx: originCx, cy: originCy, scale },
      };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    },
    [isWheelZooming, scale, tx, ty]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const state = pointerRef.current;
      if (!state || state.id !== e.pointerId) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      state.moved = true;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vbAspect = CANVAS_W / CANVAS_H;
      const rectAspect = rect.width / rect.height;
      let visW: number;
      let visH: number;
      if (rectAspect > vbAspect) {
        visH = rect.height;
        visW = visH * vbAspect;
      } else {
        visW = rect.width;
        visH = visW / vbAspect;
      }
      const vbDx = (dx / visW) * CANVAS_W;
      const vbDy = (dy / visH) * CANVAS_H;
      const nextCx = state.originCam.cx - vbDx / state.originCam.scale;
      const nextCy = state.originCam.cy - vbDy / state.originCam.scale;
      setUserCamera({
        cx: nextCx,
        cy: nextCy,
        scale: state.originCam.scale,
      });
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const state = pointerRef.current;
      if (!state || state.id !== e.pointerId) return;
      const wasMoved = state.moved;
      pointerRef.current = null;
      try {
        (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
      } catch {
        /* releasePointerCapture can throw if the capture was lost */
      }
      if (!wasMoved) {
        popLevel();
      }
    },
    [popLevel]
  );

  useEffect(() => {
    return () => {
      if (autoDescendTimer.current) clearTimeout(autoDescendTimer.current);
      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current);
    };
  }, []);

  useEffect(() => {
    if (wheelIdleTimer.current) {
      clearTimeout(wheelIdleTimer.current);
      wheelIdleTimer.current = null;
    }
    wheelTargetRef.current = null;
    setIsWheelZooming(false);
  }, [focusPath]);

  useEffect(() => {
    if (focusPath.length > 0) {
      setDriftHoverFreeze(null);
      driftBeginOverrideSecRef.current = {};
    }
  }, [focusPath]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    svg.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onNativeWheel);
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (e.key === "Escape") {
        if (focusPath.length === 0) return;
        e.preventDefault();
        setUserCamera(null);
        setFocusPath([]);
        return;
      }
      if (e.key === "ArrowUp") {
        if (focusPath.length === 0) return;
        e.preventDefault();
        popLevel();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (focusPath.length === 1 && focusedCompany) {
          const sorted = [...companies].sort((a, b) => b.activity - a.activity);
          const idx = sorted.findIndex((c) => c.id === focusedCompany.id);
          if (idx < 0) return;
          const nextIdx = (idx + dir + sorted.length) % sorted.length;
          const next = sorted[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([next.id]);
          return;
        }
        if (focusPath.length === 2 && focusedCompany && focusedGoal && inner) {
          const allGoals = inner.goals;
          const idx = allGoals.findIndex(
            (g) => g.bucketKey === focusedGoal.bucketKey
          );
          if (idx < 0 || allGoals.length === 0) return;
          const nextIdx = (idx + dir + allGoals.length) % allGoals.length;
          const next = allGoals[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([focusedCompany.id, next.bucketKey]);
          return;
        }
        if (
          focusPath.length === 3 &&
          focusedCompany &&
          focusedGoal &&
          focusedProject
        ) {
          const siblings = focusedGoal.projects.filter((p) => !p.isMirror);
          const idx = siblings.findIndex((p) => p.id === focusedProject.id);
          if (idx < 0 || siblings.length === 0) return;
          const nextIdx = (idx + dir + siblings.length) % siblings.length;
          const next = siblings[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([
            focusedCompany.id,
            focusedGoal.bucketKey,
            next.id,
          ]);
          return;
        }
        if (
          focusPath.length === 4 &&
          focusedCompany &&
          focusedGoal &&
          focusedProject &&
          focusedMilestoneLaid
        ) {
          const laid = positionMilestones(focusedProject);
          const idx = laid.findIndex((m) => m.id === focusedMilestoneLaid.id);
          if (idx < 0 || laid.length === 0) return;
          const nextIdx = (idx + dir + laid.length) % laid.length;
          const next = laid[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([
            focusedCompany.id,
            focusedGoal.bucketKey,
            focusedProject.id,
            next.id,
          ]);
          return;
        }
        return;
      }
      if (e.key === "ArrowDown") {
        if (focusPath.length === 0 && companies.length > 0) {
          const sorted = [...companies].sort((a, b) => b.activity - a.activity);
          const first = sorted[0]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([first.id]);
          return;
        }
        if (focusPath.length === 1 && focusedCompany && inner) {
          const first = inner.goals[0];
          if (!first) return;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([focusedCompany.id, first.bucketKey]);
          return;
        }
        if (focusPath.length === 2 && focusedCompany && focusedGoal && inner) {
          const first = inner.projects.find(
            (p) => p.bucketKey === focusedGoal.bucketKey
          );
          if (!first) return;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([focusedCompany.id, focusedGoal.bucketKey, first.id]);
          return;
        }
        if (
          focusPath.length === 3 &&
          focusedCompany &&
          focusedGoal &&
          focusedProject
        ) {
          const laid = positionMilestones(focusedProject);
          const first = laid[0];
          if (!first) return;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([
            focusedCompany.id,
            focusedGoal.bucketKey,
            focusedProject.id,
            first.id,
          ]);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    companies,
    focusPath,
    focusedCompany,
    focusedGoal,
    focusedProject,
    focusedMilestoneLaid,
    inner,
    popLevel,
  ]);

  const milestonePanelProps = useMemo(() => {
    if (!focusedMilestoneLaid || !focusedProject || !focusedCompany) return null;
    const goal = focusedCompany.company.goals.find(
      (g) => g.id === focusedProject.project.goalId
    );
    const owner = peopleById.get(focusedProject.project.ownerId);
    return {
      milestone: focusedMilestoneLaid.milestone,
      project: focusedProject.project,
      owner,
      goalDescription: goal?.description ?? "",
      goalPriority: goal?.priority ?? "",
      goalSlackChannelId: goal?.slackChannelId ?? "",
      goalSlackChannelName: goal?.slackChannel ?? "",
      companyName: focusedCompany.name,
      companyLogoPath: focusedCompany.company.logoPath ?? "",
      people,
      siblingMilestones: focusedProject.project.milestones,
    };
  }, [
    focusedMilestoneLaid,
    focusedProject,
    focusedCompany,
    peopleById,
    people,
  ]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <style>{`
        .atlas-fade { transition: opacity 600ms ease; }
        .atlas-camera { transition: transform 900ms cubic-bezier(0.7, 0, 0.2, 1); transform-origin: 0 0; }
        .atlas-camera-smooth { transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1); transform-origin: 0 0; }
        .atlas-surface {
          background:
            radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.05), transparent 55%),
            radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.045), transparent 50%),
            radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.55) 100%),
            #07070a;
        }
        @keyframes atlas-pulse-soft {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
        .atlas-pulse-soft {
          animation: atlas-pulse-soft 2.6s ease-in-out infinite;
        }
        @keyframes atlas-spark-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.08); }
        }
        .atlas-spark-pulse {
          animation: atlas-spark-pulse 3.2s ease-in-out infinite;
          transform-box: fill-box;
          transform-origin: center;
        }
      `}</style>

      <div className="atlas-surface pointer-events-none absolute inset-0" />
      <AtlasStarfield className="pointer-events-none absolute inset-0" />

      {/* Header (top-left) */}
      <div className="pointer-events-none absolute left-6 top-5 z-10 select-none">
        <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-zinc-500/80">
          Portfolio atlas
        </p>
        <h1 className="mt-0 text-base italic tracking-tight text-zinc-100">
          Momentum map
        </h1>
      </div>

      {/* Grouping toggle (top, centered) */}
      <div className="pointer-events-auto absolute left-1/2 top-6 z-10 -translate-x-1/2">
        <AtlasGroupingToggle
          value={grouping}
          onChange={setGrouping}
          disabled={!focusedCompany}
        />
      </div>

      {/* Breadcrumbs (top-right) */}
      <div className="pointer-events-auto absolute right-6 top-6 z-10 max-w-[40vw] overflow-hidden">
        <AtlasBreadcrumbs crumbs={crumbs} />
      </div>

      {/* Hint (bottom center) */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.36em] text-zinc-500/60">
        {HINTS[Math.min(level, HINTS.length - 1)]}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        className={cn(
          "relative z-0 h-full w-full touch-none select-none",
          isUserDriven ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        role="img"
        aria-label="Portfolio atlas canvas"
      >
        <g
          className={
            !isUserDriven
              ? "atlas-camera"
              : isWheelZooming
                ? "atlas-camera-smooth"
                : undefined
          }
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {companies.map((company) => {
            const isFocused = focusedCompany?.id === company.id;
            const isDimmed = Boolean(focusedCompany) && !isFocused;
            const drift = driftDescriptorFor(company.id, 1);
            const beginOverride = driftBeginOverrideSecRef.current[company.id];
            const beginForAnim =
              beginOverride != null
                ? `-${beginOverride.toFixed(4)}s`
                : drift.begin;
            const hoverThis =
              level === 0 && driftHoverFreeze?.id === company.id;
            const showDriftAnim = level === 0 && !hoverThis;
            const driftTransform = hoverThis
              ? `translate(${driftHoverFreeze!.tx} ${driftHoverFreeze!.ty})`
              : undefined;

            return (
              <g key={company.id}>
                <g
                  transform={driftTransform}
                  onPointerEnter={(e) => {
                    if (level !== 0) return;
                    if (isDimmed) return;
                    const g = e.currentTarget as SVGGElement;
                    const anim = g.querySelector("animateTransform");
                    if (!anim) return;
                    const resumeT = (anim as SVGAnimationElement).getCurrentTime();
                    if (!Number.isFinite(resumeT)) return;
                    const { tx, ty } = readDriftTranslate(g);
                    setDriftHoverFreeze({ id: company.id, tx, ty, resumeT });
                  }}
                  onPointerLeave={() => {
                    setDriftHoverFreeze((prev) => {
                      if (prev?.id === company.id) {
                        driftBeginOverrideSecRef.current[company.id] =
                          prev.resumeT;
                        return null;
                      }
                      return prev;
                    });
                  }}
                >
                  {showDriftAnim ? (
                    <animateTransform
                      key={`${company.id}-drift-${beginForAnim}`}
                      attributeName="transform"
                      attributeType="XML"
                      type="translate"
                      values={drift.values}
                      keyTimes="0;0.25;0.5;0.75;1"
                      calcMode="spline"
                      keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                      dur={drift.dur}
                      begin={beginForAnim}
                      repeatCount="indefinite"
                      additive="sum"
                    />
                  ) : null}
                  <AtlasCompany
                    company={company}
                    isFocused={isFocused}
                    isDimmed={isDimmed}
                    showLabel={level === 0}
                    scale={scale}
                    onClick={() => {
                      setUserCamera(null);
                      setFocusPath([company.id]);
                    }}
                  />
                </g>

                {isFocused && inner
                  ? renderCompanyInner({
                      company,
                      inner,
                      peopleById,
                      focusedGoal,
                      focusedProject,
                      focusedMilestoneLaid,
                      level,
                      focusPath,
                      setFocusPath: (next) => {
                        setUserCamera(null);
                        setFocusPath(next);
                      },
                      scale,
                    })
                  : null}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Floating zoom controls (right edge, vertically centered). */}
      <div className="pointer-events-auto absolute right-6 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomAroundCenter(1.3, { scale, tx, ty }, setUserCamera)}
          aria-label="Zoom in"
          title="Zoom in"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800/60 bg-zinc-950/60 text-zinc-400 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:bg-zinc-950/90 hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomAroundCenter(1 / 1.3, { scale, tx, ty }, setUserCamera)}
          aria-label="Zoom out"
          title="Zoom out"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800/60 bg-zinc-950/60 text-zinc-400 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:bg-zinc-950/90 hover:text-zinc-100"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={fitToAll}
          aria-label="Fit portfolio overview"
          title="Fit portfolio — show all companies (clears pan, zoom, and drill-down)"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800/60 bg-zinc-950/60 text-zinc-400 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:bg-zinc-950/90 hover:text-zinc-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {milestonePanelProps ? (
        <AtlasMilestonePanel
          {...milestonePanelProps}
          onClose={popLevel}
        />
      ) : null}
    </div>
  );
}

/**
 * Zoom the user camera around the viewport center by `factor`. Used for the
 * floating +/- controls so they always zoom into the middle of the view.
 */
function zoomAroundCenter(
  factor: number,
  current: { scale: number; tx: number; ty: number },
  setUserCamera: (next: UserCamera) => void
): void {
  const nextScale = Math.max(
    MIN_CAMERA_SCALE,
    Math.min(MAX_CAMERA_SCALE, current.scale * factor)
  );
  if (nextScale === current.scale) return;
  const centerX = (CANVAS_W / 2 - current.tx) / current.scale;
  const centerY = (CANVAS_H / 2 - current.ty) / current.scale;
  setUserCamera({ cx: centerX, cy: centerY, scale: nextScale });
}

/**
 * Render one focused company's inner scene: goal bubbles in the ether
 * (level 1+), projects of the focused goal in the ether (level 2+), and
 * the wandering milestone path on the focused project (level 3+).
 */
function renderCompanyInner(args: {
  company: LaidCompany;
  inner: { goals: LaidGoal[]; projects: LaidProject[] };
  peopleById: Map<string, Person>;
  focusedGoal: LaidGoal | undefined;
  focusedProject: LaidProject | undefined;
  focusedMilestoneLaid: LaidMilestone | undefined;
  level: number;
  focusPath: FocusPath;
  setFocusPath: (next: FocusPath) => void;
  scale: number;
}) {
  const {
    company,
    inner,
    peopleById,
    focusedGoal,
    focusedProject,
    focusedMilestoneLaid,
    level,
    focusPath,
    setFocusPath,
    scale,
  } = args;

  const showGoalLabels = level === 1;

  const focusLogoPath = company.company.logoPath?.trim() ?? "";
  const focusCenterLogoR = company.r * 0.18;

  return (
    <g>
      {/* Soft watermark of the company logo at the center, only at level 1
          (less obtrusive than the previous layout's behind-the-ring hero). */}
      {level === 1 && focusLogoPath ? (
        <g pointerEvents="none">
          <defs>
            <clipPath id={`atlas-focus-logo-${company.id}`}>
              <circle cx={company.cx} cy={company.cy} r={focusCenterLogoR} />
            </clipPath>
          </defs>
          <image
            href={focusLogoPath}
            x={company.cx - focusCenterLogoR}
            y={company.cy - focusCenterLogoR}
            width={focusCenterLogoR * 2}
            height={focusCenterLogoR * 2}
            clipPath={`url(#atlas-focus-logo-${company.id})`}
            preserveAspectRatio="xMidYMid slice"
            opacity={0.22}
          />
        </g>
      ) : null}

      {inner.goals.map((goal) => {
        const isGoalFocused = focusedGoal?.bucketKey === goal.bucketKey;
        const isGoalDimmed = Boolean(focusedGoal) && !isGoalFocused;
        const owner = peopleById.get(goal.goal.ownerId);
        const showThisLabel = showGoalLabels;

        const drift = driftDescriptorFor(`${company.id}:${goal.id}`, 0.5);
        const showDriftAnim = level === 1;

        const goalNode = (
          <AtlasGoal
            goal={goal}
            owner={owner}
            isFocused={isGoalFocused}
            isDimmed={isGoalDimmed}
            showLabel={showThisLabel}
            scale={scale}
            onClick={() => setFocusPath([company.id, goal.bucketKey])}
          />
        );

        return (
          <g key={goal.id}>
            <g>
              {showDriftAnim ? (
                <animateTransform
                  key={`${goal.id}-drift`}
                  attributeName="transform"
                  attributeType="XML"
                  type="translate"
                  values={drift.values}
                  keyTimes="0;0.25;0.5;0.75;1"
                  calcMode="spline"
                  keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  dur={drift.dur}
                  begin={drift.begin}
                  repeatCount="indefinite"
                  additive="sum"
                />
              ) : null}
              {goalNode}
            </g>
          </g>
        );
      })}

      {/* Projects (level 2+). Only the focused goal's projects render. */}
      {level >= 2 && focusedGoal
        ? inner.projects
            .filter((p) => p.bucketKey === focusedGoal.bucketKey)
            .map((project) => {
              const owner = peopleById.get(project.project.ownerId);
              const isProjectFocused = focusedProject?.id === project.id;
              const isProjectDimmed = level >= 3 && !isProjectFocused;
              const showProjectLabel = level === 2;
              const drift = driftDescriptorFor(
                `${focusedGoal.id}:${project.id}`,
                0.25
              );
              const showProjectDrift = level === 2;

              return (
                <g key={project.id}>
                  <g>
                    {showProjectDrift ? (
                      <animateTransform
                        key={`${project.id}-drift`}
                        attributeName="transform"
                        attributeType="XML"
                        type="translate"
                        values={drift.values}
                        keyTimes="0;0.25;0.5;0.75;1"
                        calcMode="spline"
                        keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                        dur={drift.dur}
                        begin={drift.begin}
                        repeatCount="indefinite"
                        additive="sum"
                      />
                    ) : null}
                    <AtlasProject
                      project={project}
                      owner={owner}
                      showLabel={showProjectLabel}
                      isFocused={isProjectFocused}
                      isDimmed={isProjectDimmed}
                      scale={scale}
                      onClick={() => {
                        setFocusPath([
                          company.id,
                          focusedGoal.bucketKey,
                          project.id,
                        ]);
                      }}
                    />
                  </g>

                  {isProjectFocused && level >= 3
                    ? renderMilestonePath({
                        project,
                        focusedMilestoneLaid,
                        level,
                        scale,
                        onSelect: (milestoneId) =>
                          setFocusPath([
                            company.id,
                            focusPath[1]!,
                            project.id,
                            milestoneId,
                          ]),
                      })
                    : null}
                </g>
              );
            })
        : null}
    </g>
  );
}

/**
 * Draw the wandering chronological path under the milestones for a focused
 * project: a smooth Catmull-Rom-derived Bézier through the milestone
 * centers, plus a TODAY marker interpolated between the earliest and
 * latest dated milestones.
 *
 * Milestones themselves are positioned via `positionMilestones` (which sorts
 * chronologically) and rendered with `AtlasMilestone`. The path + today
 * tick live in this parent so the geometry helper is shared (no duplicated
 * constants) and so the decoration can be hidden with a single toggle if
 * we ever want to.
 */
function renderMilestonePath(args: {
  project: LaidProject;
  focusedMilestoneLaid: LaidMilestone | undefined;
  level: number;
  scale: number;
  onSelect: (milestoneId: string) => void;
}): React.ReactNode {
  const { project, focusedMilestoneLaid, level, scale, onSelect } = args;

  const laidMilestones = positionMilestones(project);
  const geom = getMilestonePathGeometry(project);

  // Build a smooth path (Catmull-Rom → cubic Bézier) through the milestone
  // centers. With ≤1 point there's nothing to connect.
  const pts = geom.points;
  const arcD = pts.length >= 2 ? buildCatmullRomPath(pts) : "";

  // Today marker: linearly interpolate today between firstYmd and lastYmd
  // (in days), then map that fraction onto the polyline through the
  // milestone centers (since milestones sit at evenly-spaced t = i/(n-1)).
  const todayTick = (() => {
    if (geom.datedCount < 2 || !geom.firstYmd || !geom.lastYmd) return null;
    const first = calendarDaysFromTodayYmd(geom.firstYmd);
    const last = calendarDaysFromTodayYmd(geom.lastYmd);
    if (first == null || last == null) return null;
    const span = last - first;
    if (span <= 0) return null;
    // tDate is the chronological fraction TODAY occupies between first and
    // last dated milestones.
    const tDate = -first / span;
    if (tDate < -0.05 || tDate > 1.05) return null;
    const clamped = Math.max(0, Math.min(1, tDate));

    // Map onto the polyline. Dated milestones live at indexes
    // [0 ... datedCount - 1]; map the clamped fraction onto those slots.
    const tIdx = clamped * (geom.datedCount - 1);
    const iLow = Math.floor(tIdx);
    const iHigh = Math.min(geom.datedCount - 1, iLow + 1);
    const frac = tIdx - iLow;
    const a = pts[iLow]!;
    const b = pts[iHigh]!;
    const x = a.x + (b.x - a.x) * frac;
    const y = a.y + (b.y - a.y) * frac;
    // Tangent (for the tick orientation) — perpendicular to the segment.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { tx: x, ty: y, nx, ny };
  })();

  const inv = 1 / Math.max(scale, 0.0001);

  return (
    <>
      {/* Connector path — soft dashed guide line under the milestones. */}
      {arcD ? (
        <path
          d={arcD}
          fill="none"
          stroke="#3f3f46"
          strokeOpacity={0.65}
          strokeWidth={1.2}
          strokeDasharray="4 5"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {/* TODAY tick + label. */}
      {todayTick ? (
        <g pointerEvents="none">
          <line
            x1={todayTick.tx - todayTick.nx * project.r * 0.05}
            y1={todayTick.ty - todayTick.ny * project.r * 0.05}
            x2={todayTick.tx + todayTick.nx * project.r * 0.12}
            y2={todayTick.ty + todayTick.ny * project.r * 0.12}
            stroke="#10b981"
            strokeOpacity={0.9}
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <g
            transform={`translate(${todayTick.tx} ${todayTick.ty}) scale(${inv}) translate(${-todayTick.tx} ${-todayTick.ty})`}
          >
            <rect
              x={todayTick.tx + todayTick.nx * 28 - 18}
              y={todayTick.ty + todayTick.ny * 28 - 7}
              width={36}
              height={12}
              rx={2}
              fill="#09090b"
              fillOpacity={0.85}
            />
            <text
              x={todayTick.tx + todayTick.nx * 28}
              y={todayTick.ty + todayTick.ny * 28 + 2}
              textAnchor="middle"
              fontSize={8}
              fontWeight={600}
              letterSpacing={1.4}
              fill="#10b981"
            >
              TODAY
            </text>
          </g>
        </g>
      ) : null}

      {laidMilestones.map((m, idx) => {
        const isMFocused = focusedMilestoneLaid?.id === m.id;
        const isMDimmed = level === 4 && !isMFocused;
        const labelSide: "above" | "below" = idx % 2 === 0 ? "above" : "below";
        return (
          <AtlasMilestone
            key={m.id}
            milestone={m}
            sequence={idx + 1}
            showLabel={level === 3 || (level === 4 && isMFocused)}
            isFocused={isMFocused}
            isDimmed={isMDimmed}
            scale={scale}
            labelSide={labelSide}
            onClick={() => onSelect(m.id)}
          />
        );
      })}
    </>
  );
}

/**
 * Smooth a polyline via Catmull-Rom-to-Bézier conversion. Each interior
 * segment between (p1, p2) is approximated by a cubic with control points
 * cp1 = p1 + (p2 - p0)/6 and cp2 = p2 - (p3 - p1)/6. End segments duplicate
 * the boundary point so the curve passes cleanly through start/end.
 */
function buildCatmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const out: string[] = [];
  out.push(`M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i === 0 ? pts[i]! : pts[i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = i + 2 < pts.length ? pts[i + 2]! : p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    out.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }
  return out.join(" ");
}
