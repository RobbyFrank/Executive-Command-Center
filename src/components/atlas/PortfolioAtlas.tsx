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
import { AtlasGoalStatusPopoverHost } from "./AtlasGoalStatusPopoverHost";
import { AtlasGroupingToggle } from "./AtlasGroupingToggle";
import { AtlasMilestone } from "./AtlasMilestone";
import { AtlasMilestonePanel } from "./AtlasMilestonePanel";
import { AtlasProject } from "./AtlasProject";
import { AtlasProjectStatusPopoverHost } from "./AtlasProjectStatusPopoverHost";
import { AtlasStarfield } from "./AtlasStarfield";
import {
  CANVAS_H,
  CANVAS_W,
  getMilestonePathGeometry,
  layoutCompanies,
  layoutCompanyInner,
  layoutProjectsInEther,
  positionMilestones,
} from "./atlas-layout";
import { projectAssigneesForGoal } from "./atlas-activity";
import {
  calendarDaysFromTodayYmd,
  parseCalendarDateString,
} from "@/lib/relativeCalendarDate";
import { ATLAS_RESET_TO_COMPANIES_EVENT } from "@/lib/atlasNav";
import { cn } from "@/lib/utils";
import type {
  AtlasSection,
  GroupingKey,
  LaidCompany,
  LaidGoal,
  LaidMilestone,
  LaidProject,
} from "./atlas-types";

interface PortfolioAtlasProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
  /**
   * Server-provided "today" as YYYY-MM-DD. Keeps date-dependent SVG text
   * (tooltips, relative due labels) identical between SSR and the client
   * so React hydration does not fail on timezone or clock skew.
   */
  asOfYmd: string;
}

/**
 * Focus path: [companyId, goalId, projectId, milestoneId]. Length = current
 * zoom level (0 = portfolio overview, 4 = milestone panel open).
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
 * elements via CSS has historically been unreliable across engines.
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
 * updates `transform.animVal` in supporting browsers). Used for the
 * hover-freeze pattern at level 0.
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
  "Click a company to see its goals",
  "Click a goal to see its projects",
  "Click a project to reveal milestones",
  "Click a milestone to open its Slack thread",
  "Press Esc to close",
];

/**
 * User-driven camera — overrides the default canvas-fit camera when the
 * user actively wheel-zooms or drags the canvas. Cleared when the level
 * changes so each level starts at the canvas-fit view.
 */
interface UserCamera {
  cx: number;
  cy: number;
  scale: number;
}

/** Tight range around the default (scale 1) “fit” view. */
const MIN_CAMERA_SCALE = 0.9;
const MAX_CAMERA_SCALE = 1.1;
/**
 * Wheel zoom uses `exp(-deltaY / WHEEL_ZOOM_SENSITIVITY)`. Larger values
 * make each scroll step change scale more gently.
 */
const WHEEL_ZOOM_SENSITIVITY = 1500;
/**
 * Nudge the floating zoom +/- buttons; kept close to 1.0 to match
 * `MIN/MAX_CAMERA_SCALE` (see `ZOOM_BUTTON_FACTOR`).
 */
const ZOOM_BUTTON_FACTOR = 1.05;
/** Distance (px) of pointer movement required to treat pointerdown/up as a drag (not a click). */
const DRAG_THRESHOLD_PX = 4;

/**
 * Keep the “camera” center so the 1200×800 atlas art stays near the
 * default fit: zoomed in → cannot pan the canvas out of the frame; zoomed
 * out (scale below 1) → cannot lose the full canvas from view.
 */
function clampUserCamera(camera: UserCamera): UserCamera {
  const s = Math.max(
    MIN_CAMERA_SCALE,
    Math.min(MAX_CAMERA_SCALE, camera.scale)
  );
  let { cx, cy } = camera;

  const visW = CANVAS_W / s;
  if (visW <= CANVAS_W) {
    const hx = visW / 2;
    cx = Math.max(hx, Math.min(CANVAS_W - hx, cx));
  } else {
    const hx = visW / 2;
    cx = Math.max(CANVAS_W - hx, Math.min(hx, cx));
  }

  const visH = CANVAS_H / s;
  if (visH <= CANVAS_H) {
    const hy = visH / 2;
    cy = Math.max(hy, Math.min(CANVAS_H - hy, cy));
  } else {
    const hy = visH / 2;
    cy = Math.max(CANVAS_H - hy, Math.min(hy, cy));
  }

  return { scale: s, cx, cy };
}

export function PortfolioAtlas({
  hierarchy,
  people,
  asOfYmd,
}: PortfolioAtlasProps) {
  const asOf = useMemo(
    () => parseCalendarDateString(asOfYmd) ?? new Date(),
    [asOfYmd]
  );
  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [grouping, setGroupingState] = useState<GroupingKey>("goal");
  const [userCamera, setUserCamera] = useState<UserCamera | null>(null);
  const setClampedUserCamera = useCallback((next: UserCamera) => {
    setUserCamera(clampUserCamera(next));
  }, []);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  /**
   * Drift hover-freeze (level 0): freeze SMIL drift at the current
   * translate + timeline position so hover pauses without snapping to the
   * origin.
   */
  const [driftHoverFreeze, setDriftHoverFreeze] = useState<{
    id: string;
    tx: number;
    ty: number;
    resumeT: number;
  } | null>(null);
  const driftBeginOverrideSecRef = useRef<Record<string, number>>({});

  /**
   * Active status popover (clicking a goal's status pip at L1 or a project's
   * status pip / at-risk pulse at L2). Mirrors the Roadmap goal+project
   * popovers via host components anchored to a fixed-position proxy at the
   * pip's screen rect. Cleared when the focus level changes so the popover
   * never lingers across navigation.
   */
  const [statusPopover, setStatusPopover] = useState<
    | {
        kind: "goal";
        bucketKey: string;
        anchorRect: { left: number; top: number; width: number; height: number };
      }
    | {
        kind: "project";
        projectId: string;
        /** Milestone the user clicked on the project bubble (L2). */
        milestoneId: string;
        anchorRect: { left: number; top: number; width: number; height: number };
      }
    | null
  >(null);

  /**
   * Re-layout with the new grouping. Stays on the current company; keeps a
   * selected goal if the path had one, and drops only project/milestone
   * segments so L2 projects re-flow without leaving the goal.
   */
  const setGrouping = useCallback((next: GroupingKey) => {
    setGroupingState(next);
    // Keep the company, and a selected goal if any, so projects (L2) re-layout
    // in place. Pop only the project / milestone if we're deeper than a goal.
    setFocusPath((prev) => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, 2);
    });
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

  /**
   * Goals of the focused company, laid out across the canvas. Computed only
   * when there's a focused company (level ≥ 1).
   */
  const inner = useMemo(() => {
    if (!focusedCompany) return null;
    return layoutCompanyInner(focusedCompany, grouping, peopleById);
  }, [focusedCompany, grouping, peopleById]);

  const focusedGoal = useMemo<LaidGoal | undefined>(() => {
    if (!inner || !focusPath[1]) return undefined;
    return inner.goals.find((g) => g.bucketKey === focusPath[1]);
  }, [inner, focusPath]);

  /**
   * Projects of the focused goal, laid out across the canvas. Computed only
   * when there's a focused goal (level ≥ 2). Avoids laying out projects
   * for goals the user isn't currently inside.
   */
  const { focusedGoalProjects, projectLayoutSections } = useMemo<{
    focusedGoalProjects: LaidProject[];
    projectLayoutSections: AtlasSection[];
  }>(() => {
    if (!focusedGoal) {
      return { focusedGoalProjects: [], projectLayoutSections: [] };
    }
    const { projects, sections } = layoutProjectsInEther(
      focusedGoal,
      grouping,
      peopleById
    );
    return { focusedGoalProjects: projects, projectLayoutSections: sections };
  }, [focusedGoal, grouping, peopleById]);

  const focusedProject = useMemo<LaidProject | undefined>(() => {
    if (!focusPath[2]) return undefined;
    return focusedGoalProjects.find((p) => p.id === focusPath[2]);
  }, [focusedGoalProjects, focusPath]);

  const focusedMilestones = useMemo(() => {
    if (!focusedProject) return [];
    return positionMilestones(focusedProject, asOf);
  }, [asOf, focusedProject]);

  const focusedMilestoneLaid = useMemo(() => {
    if (!focusPath[3]) return undefined;
    return focusedMilestones.find((m) => m.id === focusPath[3]);
  }, [focusPath, focusedMilestones]);

  const level = focusPath.length;

  /**
   * Camera — always defaults to canvas-fit (scale=1). User wheel/drag may
   * override for free exploration. Each level starts at default; popping
   * back also resets to default. There is no "zoom into the bubble"
   * camera target anymore — every level just uses the full canvas.
   */
  const { scale, tx, ty, isUserDriven } = useMemo(() => {
    if (userCamera) {
      return {
        scale: userCamera.scale,
        tx: CANVAS_W / 2 - userCamera.cx * userCamera.scale,
        ty: CANVAS_H / 2 - userCamera.cy * userCamera.scale,
        isUserDriven: true,
      };
    }
    return { scale: 1, tx: 0, ty: 0, isUserDriven: false };
  }, [userCamera]);

  const popLevel = useCallback(() => {
    setUserCamera(null);
    setFocusPath((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const navigateMilestone = useCallback(
    (milestoneId: string) => {
      if (!focusedCompany || !focusedGoal || !focusedProject) return;
      setUserCamera(null);
      setFocusPath([
        focusedCompany.id,
        focusedGoal.bucketKey,
        focusedProject.id,
        milestoneId,
      ]);
    },
    [focusedCompany, focusedGoal, focusedProject]
  );

  const fitToAll = useCallback(() => {
    setUserCamera(null);
    setFocusPath([]);
  }, []);

  // Sidebar: clicking "Atlas" while already on `/atlas` should return to the
  // L0 companies view (Link alone does not remount, so client state would stick).
  useEffect(() => {
    const onReset = () => {
      fitToAll();
    };
    window.addEventListener(ATLAS_RESET_TO_COMPANIES_EVENT, onReset);
    return () => {
      window.removeEventListener(ATLAS_RESET_TO_COMPANIES_EVENT, onReset);
    };
  }, [fitToAll]);

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
  // Wheel-zoom + pointer-drag.
  // ---------------------------------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    moved: boolean;
    originCam: { cx: number; cy: number; scale: number };
  } | null>(null);
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
    },
    [clientToSvgWithCamera, scale, tx, ty]
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
      setClampedUserCamera({
        cx: nextCx,
        cy: nextCy,
        scale: state.originCam.scale,
      });
    },
    [setClampedUserCamera]
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
        // Empty-canvas click pops one level (intuitive "back" gesture).
        popLevel();
      }
    },
    [popLevel]
  );

  useEffect(() => {
    return () => {
      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current);
    };
  }, []);

  // When the focus path changes (any drill or pop), drop any in-flight
  // wheel-zoom smoothing AND clear hover-freeze so the new level starts
  // fresh at the canvas-fit camera.
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

  /** Clear the status popover whenever focus depth changes — drilling in/out
   *  past a goal or project would otherwise leave a popover anchored to a
   *  bubble that no longer matches the visible level. */
  useEffect(() => {
    setStatusPopover(null);
  }, [focusPath]);

  const handleGoalStatusClick = useCallback(
    (bucketKey: string, rect: { left: number; top: number; width: number; height: number }) => {
      setStatusPopover({ kind: "goal", bucketKey, anchorRect: rect });
    },
    []
  );

  const handleProjectStatusClick = useCallback(
    (
      projectId: string,
      milestoneId: string,
      rect: { left: number; top: number; width: number; height: number }
    ) => {
      setStatusPopover({ kind: "project", projectId, milestoneId, anchorRect: rect });
    },
    []
  );

  const closeStatusPopover = useCallback(() => {
    setStatusPopover(null);
  }, []);

  // React attaches wheel handlers as passive by default. Attach a native
  // non-passive wheel handler so wheel-zooming over the Atlas never scrolls
  // the page/ancestor container while still letting our camera update.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    svg.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onNativeWheel);
  }, []);

  // ---------------------------------------------------------------------
  // Keyboard navigation.
  //   Esc              → fully reset to the portfolio overview.
  //   ArrowUp          → pop one level.
  //   ArrowLeft/Right  → cycle siblings (wraps) except on milestones: first
  //                      to last in path order, no wrap.
  //   ArrowDown        → descend into the first sibling one level below.
  // ---------------------------------------------------------------------
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
          const siblings = focusedGoalProjects;
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
          const laid = positionMilestones(focusedProject, asOf);
          const idx = laid.findIndex((m) => m.id === focusedMilestoneLaid.id);
          if (idx < 0 || laid.length === 0) return;
          const nextIdx = idx + dir;
          if (nextIdx < 0 || nextIdx >= laid.length) {
            e.preventDefault();
            return;
          }
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
        if (focusPath.length === 2 && focusedCompany && focusedGoal) {
          const first = focusedGoalProjects[0];
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
          const laid = positionMilestones(focusedProject, asOf);
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
    asOf,
    companies,
    focusPath,
    focusedCompany,
    focusedGoal,
    focusedProject,
    focusedMilestoneLaid,
    focusedGoalProjects,
    inner,
    popLevel,
  ]);

  const milestonePanelProps = useMemo(() => {
    if (!focusedMilestoneLaid || !focusedProject || !focusedCompany) return null;
    const goal = focusedCompany.company.goals.find(
      (g) => g.id === focusedProject.project.goalId
    );
    const owner = peopleById.get(focusedProject.project.ownerId);
    const milestonePathOrder = positionMilestones(focusedProject, asOf).map(
      (m) => m.milestone
    );
    return {
      asOf,
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
      milestonePathOrder,
      onNavigateMilestone: navigateMilestone,
    };
  }, [
    asOf,
    focusedMilestoneLaid,
    focusedProject,
    focusedCompany,
    peopleById,
    people,
    navigateMilestone,
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
        @keyframes atlas-level-in {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        .atlas-level-in {
          animation: atlas-level-in 600ms ease both;
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

      {/* Grouping toggle — goals (L1) and projects (L2) */}
      {level === 1 || level === 2 ? (
        <div className="pointer-events-auto absolute left-1/2 top-6 z-10 -translate-x-1/2">
          <AtlasGroupingToggle
            value={grouping}
            onChange={setGrouping}
            disabled={!focusedCompany}
          />
        </div>
      ) : null}

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
          {/* Level 0 — Companies in the ether. */}
          {level === 0
            ? companies.map((company) => {
                const drift = driftDescriptorFor(company.id, 1);
                const beginOverride =
                  driftBeginOverrideSecRef.current[company.id];
                const beginForAnim =
                  beginOverride != null
                    ? `-${beginOverride.toFixed(4)}s`
                    : drift.begin;
                const hoverThis = driftHoverFreeze?.id === company.id;
                const showDriftAnim = !hoverThis;
                const driftTransform = hoverThis
                  ? `translate(${driftHoverFreeze!.tx} ${driftHoverFreeze!.ty})`
                  : undefined;

                return (
                  <g key={company.id} className="atlas-level-in">
                    <g
                      transform={driftTransform}
                      onPointerEnter={(e) => {
                        const g = e.currentTarget as SVGGElement;
                        const anim = g.querySelector("animateTransform");
                        if (!anim) return;
                        const resumeT = (
                          anim as SVGAnimationElement
                        ).getCurrentTime();
                        if (!Number.isFinite(resumeT)) return;
                        const { tx, ty } = readDriftTranslate(g);
                        setDriftHoverFreeze({
                          id: company.id,
                          tx,
                          ty,
                          resumeT,
                        });
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
                        isFocused={false}
                        isDimmed={false}
                        showLabel
                        scale={scale}
                        asOfYmd={asOfYmd}
                        onClick={() => {
                          setUserCamera(null);
                          setFocusPath([company.id]);
                        }}
                      />
                    </g>
                  </g>
                );
              })
            : null}

          {/* Level 1 — Section backgrounds (only when grouped). Drawn
              under the goals so the bubbles + their priority glows render
              on top. Single "all" section is skipped (no chrome needed
              when grouping is "goal"). */}
          {level === 1 && inner && grouping !== "goal"
            ? inner.sections.map((section) => (
                <AtlasSectionChrome key={section.key} section={section} />
              ))
            : null}

          {level === 2 && focusedGoal && grouping !== "goal"
            ? projectLayoutSections.map((section) => (
                <AtlasSectionChrome key={`p-${section.key}`} section={section} />
              ))
            : null}

          {/* Level 1 — Goals of the focused company in the ether. */}
          {level === 1 && inner
            ? inner.goals.map((goal) => {
                const owner = peopleById.get(goal.goal.ownerId);
                const projectAssignees = projectAssigneesForGoal(goal, peopleById);
                // Gentle drift — the placement pad keeps neighbors a hair
                // apart, and 0.5 amplitude (≈ 5 px max) stays inside that
                // gap so drifting bubbles never collide.
                const drift = driftDescriptorFor(
                  `${goal.id}:goal`,
                  0.5
                );
                return (
                  <g key={goal.id} className="atlas-level-in">
                    <g>
                      <animateTransform
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
                      <AtlasGoal
                        goal={goal}
                        projectAssignees={projectAssignees}
                        owner={owner}
                        grouping={grouping}
                        isFocused={false}
                        isDimmed={false}
                        showLabel
                        scale={scale}
                        asOf={asOf}
                        onClick={() => {
                          setUserCamera(null);
                          setFocusPath([
                            focusedCompany!.id,
                            goal.bucketKey,
                          ]);
                        }}
                        onStatusClick={handleGoalStatusClick}
                      />
                    </g>
                  </g>
                );
              })
            : null}

          {/* Level 2 — Projects of the focused goal in the ether. */}
          {level === 2 && focusedGoal
            ? focusedGoalProjects.map((project) => {
                const owner = peopleById.get(project.project.ownerId);
                const drift = driftDescriptorFor(
                  `${project.id}:project`,
                  0.5
                );
                return (
                  <g key={project.id} className="atlas-level-in">
                    <g>
                      <animateTransform
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
                      <AtlasProject
                        project={project}
                        owner={owner}
                        showLabel
                        isFocused={false}
                        isDimmed={false}
                        scale={scale}
                        asOfYmd={asOfYmd}
                        asOf={asOf}
                        onClick={() => {
                          setUserCamera(null);
                          setFocusPath([
                            focusedCompany!.id,
                            focusedGoal.bucketKey,
                            project.id,
                          ]);
                        }}
                        onMilestoneStatusClick={handleProjectStatusClick}
                      />
                    </g>
                  </g>
                );
              })
            : null}

          {/* Level 3+ — Milestones of the focused project along a wandering path. */}
          {level >= 3 && focusedProject
            ? renderMilestonePath({
                asOf,
                project: focusedProject,
                focusedMilestoneLaid,
                level,
                scale,
                onSelect: (milestoneId) =>
                  setFocusPath([
                    focusedCompany!.id,
                    focusedGoal!.bucketKey,
                    focusedProject.id,
                    milestoneId,
                  ]),
              })
            : null}
        </g>
      </svg>

      {/* Floating zoom controls (right edge, vertically centered). */}
      <div className="pointer-events-auto absolute right-6 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1">
        <button
          type="button"
          onClick={() =>
            zoomAroundCenter(ZOOM_BUTTON_FACTOR, { scale, tx, ty }, setClampedUserCamera)
          }
          aria-label="Zoom in"
          title="Zoom in"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800/60 bg-zinc-950/60 text-zinc-400 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:bg-zinc-950/90 hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() =>
            zoomAroundCenter(1 / ZOOM_BUTTON_FACTOR, { scale, tx, ty }, setClampedUserCamera)
          }
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

      {/* Goal status popover (L1): mirrors the Roadmap goal popover. */}
      {statusPopover?.kind === "goal" && focusedCompany
        ? (() => {
            const goal = focusedCompany.company.goals.find(
              (g) => g.id === statusPopover.bucketKey
            );
            if (!goal) return null;
            return (
              <AtlasGoalStatusPopoverHost
                goal={goal}
                people={people}
                peopleById={peopleById}
                anchorRect={statusPopover.anchorRect}
                onClose={closeStatusPopover}
                onOpenProjectInAtlas={(projectId) => {
                  closeStatusPopover();
                  setUserCamera(null);
                  setFocusPath([
                    focusedCompany.id,
                    goal.id,
                    projectId,
                  ]);
                }}
              />
            );
          })()
        : null}

      {/* Project status popover (L2): mirrors the Roadmap project Slack
          thread popover for the project's next pending milestone. Uses the
          *focused* goal as the popover's parent context so mirrored projects
          (whose `project.goalId` may live in another company) still pick up
          the right Slack channel — matches the Roadmap, where the goal
          section the row is rendered under supplies channel context. */}
      {statusPopover?.kind === "project" && focusedCompany && focusedGoal
        ? (() => {
            const laidProject = focusedGoalProjects.find(
              (p) => p.id === statusPopover.projectId
            );
            const project = laidProject?.project;
            if (!project) return null;
            const owner = peopleById.get(project.ownerId);
            return (
              <AtlasProjectStatusPopoverHost
                project={project}
                parentGoal={focusedGoal.goal}
                people={people}
                owner={owner}
                anchorRect={statusPopover.anchorRect}
                onClose={closeStatusPopover}
              />
            );
          })()
        : null}
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
  applyCamera: (next: UserCamera) => void
): void {
  const nextScale = Math.max(
    MIN_CAMERA_SCALE,
    Math.min(MAX_CAMERA_SCALE, current.scale * factor)
  );
  if (nextScale === current.scale) return;
  const centerX = (CANVAS_W / 2 - current.tx) / current.scale;
  const centerY = (CANVAS_H / 2 - current.ty) / current.scale;
  applyCamera({ cx: centerX, cy: centerY, scale: nextScale });
}

/**
 * Draw the wandering chronological path under the milestones for a focused
 * project: a smooth Catmull-Rom-derived Bézier through the milestone
 * centers, plus a TODAY marker interpolated between the earliest and
 * latest dated milestones.
 */
function renderMilestonePath(args: {
  asOf: Date;
  project: LaidProject;
  focusedMilestoneLaid: LaidMilestone | undefined;
  level: number;
  scale: number;
  onSelect: (milestoneId: string) => void;
}): React.ReactNode {
  const { asOf, project, focusedMilestoneLaid, level, scale, onSelect } = args;

  const laidMilestones = positionMilestones(project, asOf);
  const geom = getMilestonePathGeometry(project, asOf);

  const pts = geom.points;
  const arcD = pts.length >= 2 ? buildCatmullRomPath(pts) : "";

  const todayTick = (() => {
    if (geom.datedCount < 2 || !geom.firstYmd || !geom.lastYmd) return null;
    const first = calendarDaysFromTodayYmd(geom.firstYmd, asOf);
    const last = calendarDaysFromTodayYmd(geom.lastYmd, asOf);
    if (first == null || last == null) return null;
    const span = last - first;
    if (span <= 0) return null;
    const tDate = -first / span;
    if (tDate < -0.05 || tDate > 1.05) return null;
    const clamped = Math.max(0, Math.min(1, tDate));

    const tIdx = clamped * (geom.datedCount - 1);
    const iLow = Math.floor(tIdx);
    const iHigh = Math.min(geom.datedCount - 1, iLow + 1);
    const frac = tIdx - iLow;
    const a = pts[iLow]!;
    const b = pts[iHigh]!;
    const x = a.x + (b.x - a.x) * frac;
    const y = a.y + (b.y - a.y) * frac;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { tx: x, ty: y, nx, ny };
  })();

  const inv = 1 / Math.max(scale, 0.0001);

  return (
    <g className="atlas-level-in">
      {arcD ? (
        <path
          d={arcD}
          fill="none"
          stroke="#52525b"
          strokeOpacity={0.7}
          strokeWidth={1.4}
          strokeDasharray="5 6"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {todayTick ? (
        <g pointerEvents="none">
          <line
            x1={todayTick.tx - todayTick.nx * 14}
            y1={todayTick.ty - todayTick.ny * 14}
            x2={todayTick.tx + todayTick.nx * 32}
            y2={todayTick.ty + todayTick.ny * 32}
            stroke="#10b981"
            strokeOpacity={0.92}
            strokeWidth={2.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <g
            transform={`translate(${todayTick.tx} ${todayTick.ty}) scale(${inv}) translate(${-todayTick.tx} ${-todayTick.ty})`}
          >
            <rect
              x={todayTick.tx + todayTick.nx * 50 - 22}
              y={todayTick.ty + todayTick.ny * 50 - 9}
              width={44}
              height={16}
              rx={3}
              fill="#09090b"
              fillOpacity={0.9}
              stroke="#10b981"
              strokeOpacity={0.6}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={todayTick.tx + todayTick.nx * 50}
              y={todayTick.ty + todayTick.ny * 50 + 3}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
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
        return (
          <AtlasMilestone
            key={m.id}
            milestone={m}
            sequence={idx + 1}
            showLabel
            isFocused={isMFocused}
            isDimmed={isMDimmed}
            scale={scale}
            asOf={asOf}
            onClick={() => onSelect(m.id)}
          />
        );
      })}
    </g>
  );
}

/**
 * Render one grouping section (L1 goals or L2 projects) — soft tinted
 * rounded rect + header pill. Layout is computed by `atlas-layout`.
 */
function AtlasSectionChrome({ section }: { section: AtlasSection }) {
  const isEmpty = section.goalCount === 0;
  const fillOpacity = isEmpty ? 0.025 : 0.05;
  const strokeOpacity = isEmpty ? 0.18 : 0.32;

  // Header pill — small chip top-center of the section.
  const labelText = section.label;
  const countText = section.goalCount > 0 ? ` · ${section.goalCount}` : "";
  const fontSize = 10;
  const charW = fontSize * 0.62;
  const padX = 10;
  const padY = 5;
  const textW = (labelText.length + countText.length) * charW;
  const pillW = textW + padX * 2;
  const pillH = fontSize + padY * 2;
  const pillX = section.x + section.width / 2 - pillW / 2;
  const pillY = section.y + 8;

  return (
    <g pointerEvents="none">
      <rect
        x={section.x}
        y={section.y}
        width={section.width}
        height={section.height}
        rx={18}
        fill={section.color}
        fillOpacity={fillOpacity}
        stroke={section.color}
        strokeOpacity={strokeOpacity}
        strokeWidth={1}
        strokeDasharray="6 6"
        vectorEffect="non-scaling-stroke"
      />
      {labelText ? (
        <g>
          <rect
            x={pillX}
            y={pillY}
            width={pillW}
            height={pillH}
            rx={pillH / 2}
            fill="#09090b"
            fillOpacity={0.85}
            stroke={section.color}
            strokeOpacity={isEmpty ? 0.35 : 0.7}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={section.x + section.width / 2}
            y={pillY + pillH / 2 + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={fontSize}
            letterSpacing={1.5}
            fontWeight={700}
            fill={section.color}
            opacity={isEmpty ? 0.55 : 1}
          >
            {labelText}
            <tspan
              fill="#a1a1aa"
              fontWeight={500}
              letterSpacing={0.5}
            >
              {countText}
            </tspan>
          </text>
        </g>
      ) : null}
    </g>
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
