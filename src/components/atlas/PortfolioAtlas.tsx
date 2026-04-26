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
import { AtlasGroupingToggle } from "./AtlasGroupingToggle";
import { AtlasMilestone } from "./AtlasMilestone";
import { AtlasMilestonePanel } from "./AtlasMilestonePanel";
import { AtlasProject } from "./AtlasProject";
import { AtlasStarfield } from "./AtlasStarfield";
import {
  CANVAS_H,
  CANVAS_W,
  getMilestoneArcGeometry,
  layoutCompanies,
  layoutCompanyInner,
  positionMilestones,
} from "./atlas-layout";
import { calendarDaysFromTodayYmd } from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";
import { PROJECT_TYPE_COLOR } from "./atlas-activity";
import type {
  CameraTarget,
  GroupingKey,
  LaidCompany,
  LaidGroup,
  LaidMilestone,
  LaidProject,
} from "./atlas-types";

interface PortfolioAtlasProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
}

/**
 * Focus path: [companyId, groupKey, projectId, milestoneId]. Length = current
 * zoom level (0 = overview, 4 = milestone panel open).
 */
type FocusPath = string[];

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** All-caps goal names: word-aware wrap, up to {@link GOAL_LABEL_MAX_LINES} lines. */
const GOAL_LABEL_MAX_CHARS_PER_LINE = 26;
const GOAL_LABEL_MAX_LINES = 3;

/**
 * Word-aware wrap a goal label to at most `maxLines` lines of `maxLineLen`
 * characters each. The last line truncates with "…" if the remainder
 * doesn't fit.
 */
function splitGoalLabelName(
  upper: string,
  maxLineLen: number,
  maxLines: number = GOAL_LABEL_MAX_LINES
): string[] {
  const t = upper.trim();
  if (t.length === 0) return [""];
  const lines: string[] = [];
  let rest = t;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxLineLen) {
      lines.push(rest);
      break;
    }
    const isLast = lines.length === maxLines - 1;
    if (isLast) {
      lines.push(truncate(rest, maxLineLen));
      break;
    }
    const head = rest.slice(0, maxLineLen);
    const breakAt = Math.max(
      head.lastIndexOf(" "),
      head.lastIndexOf("/"),
      head.lastIndexOf(":")
    );
    const cut = breakAt > 2 ? breakAt : maxLineLen;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  return lines.length === 0 ? [""] : lines;
}

/**
 * Dominant project-type within a goal — used as a "category" tag above the
 * goal name. Falls back to `null` when the goal has no projects.
 */
function dominantProjectType(group: LaidGroup): string | null {
  if (group.projects.length === 0) return null;
  const counts = new Map<string, number>();
  for (const p of group.projects) {
    counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  }
  let bestType: string | null = null;
  let bestCount = 0;
  for (const [t, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestType = t;
    }
  }
  return bestType;
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
 * Build a per-company SMIL drift descriptor — an orbital wander with four
 * distinct stops so the motion never reads as back-and-forth on a single
 * axis. Each company gets unique offsets, duration (8–14s), and a negative
 * begin time so its phase is out of sync with its siblings. SMIL is used
 * (rather than CSS keyframes) because animating `transform` on SVG `<g>`
 * elements via CSS has historically been unreliable across engines —
 * `<animateTransform>` is purpose-built for SVG and works everywhere.
 */
interface DriftDescriptor {
  /** Space-separated translation values for SMIL (5 stops: 0, A, B, A', 0). */
  values: string;
  dur: string;
  begin: string;
}

function driftDescriptorFor(seed: string): DriftDescriptor {
  const ax = (seededRandom(seed, 1) * 2 - 1) * 10;
  const ay = (seededRandom(seed, 2) * 2 - 1) * 8;
  const bx = (seededRandom(seed, 5) * 2 - 1) * 8;
  const by = (seededRandom(seed, 6) * 2 - 1) * 10;
  // Small kicker stop based on A so the orbit isn't a closed rectangle.
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
 * Read the *live* translate applied to the company drift <g> (SMIL
 * `animateTransform` updates `transform.animVal` in supporting browsers).
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

/**
 * Build an SVG transform that cancels out the camera's scale around (cx, cy).
 *
 * Used to wrap text labels so they stay at a constant on-screen size
 * regardless of how deep the camera has zoomed in. Inside the returned
 * transform, positional offsets from (cx, cy) correspond 1:1 to on-screen
 * viewBox units (the outer camera `scale(s)` and this inverse `scale(1/s)`
 * cancel out). Text placed `k` units away from the center appears `k`
 * on-screen pixels away, and a `fontSize={k}` renders at `k` on-screen
 * pixels.
 */
function counterScaleTransform(cx: number, cy: number, scale: number): string {
  const inv = 1 / Math.max(scale, 0.0001);
  return `translate(${cx} ${cy}) scale(${inv}) translate(${-cx} ${-cy})`;
}

const HINTS = [
  "Click a company to zoom in",
  "Click a group to see project names",
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
const MAX_CAMERA_SCALE = 14;
/**
 * At company-only focus, wheel zoom-out pops to the portfolio when scale
 * falls below this fraction of the focus “natural” scale. Lower = user must
 * zoom out further before leaving the company view.
 */
const ZOOM_OUT_TO_PORTFOLIO_FRAC = 0.68;
/**
 * Wheel zoom uses `exp(-deltaY / WHEEL_ZOOM_SENSITIVITY)`. Larger values
 * make each scroll step change scale more gently (was 400 originally).
 */
const WHEEL_ZOOM_SENSITIVITY = 800;
/** Distance (px) of pointer movement required to treat pointerdown/up as a drag (not a click). */
const DRAG_THRESHOLD_PX = 4;

export function PortfolioAtlas({ hierarchy, people }: PortfolioAtlasProps) {
  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [grouping, setGroupingState] = useState<GroupingKey>("goal");
  const [userCamera, setUserCamera] = useState<UserCamera | null>(null);
  /**
   * True while the user is actively wheel-zooming. Adds a short CSS
   * transition on the camera transform so wheel events produce a smooth
   * chase rather than a choppy jump. Pointer-drag still wants instant
   * one-to-one camera updates, so this stays false during drag.
   */
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
  /**
   * After unhover, `begin` for the next `<animateTransform>` must match
   * `getCurrentTime()` at freeze so motion continues. Cleared when drilling
   * into a company (focus path).
   */
  const driftBeginOverrideSecRef = useRef<Record<string, number>>({});

  /**
   * Switching grouping invalidates the bucket key in `focusPath[1]` (and
   * therefore anything deeper). Drop back to the company level so the user
   * can pick a new group in the new grouping's set.
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

  const focusedGroup = useMemo<LaidGroup | undefined>(() => {
    if (!inner || !focusPath[1]) return undefined;
    return inner.groups.find((g) => g.bucketKey === focusPath[1]);
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

  // Camera target per level.
  const cameraTarget = useMemo<CameraTarget | null>(() => {
    if (focusedProject) return focusedProject;
    if (focusedGroup) return focusedGroup;
    if (focusedCompany) return focusedCompany;
    return null;
  }, [focusedCompany, focusedGroup, focusedProject]);

  /**
   * Effective camera — a free-form user camera overrides the focus-driven
   * camera while the user is actively manipulating the view (wheel/drag).
   * The transform is committed with a direct CSS transform on the inner
   * `<g>`; transitions are disabled while `userCamera` is active so
   * wheel/drag feels like direct manipulation, and re-enabled when we
   * revert to the focus-driven camera (snap animation).
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

  /**
   * Portfolio overview — clears manual pan/zoom and drill-down. Works from any
   * zoom level or focus depth.
   */
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
  if (focusedGroup && focusedCompany) {
    crumbs.push({
      label: truncate(focusedGroup.label, 28),
      onClick: () =>
        setFocusPath([focusedCompany.id, focusedGroup.bucketKey]),
      active: focusPath.length === 2,
    });
  }
  if (focusedProject && focusedCompany && focusedGroup) {
    crumbs.push({
      label: focusedProject.project.name,
      onClick: () =>
        setFocusPath([
          focusedCompany.id,
          focusedGroup.bucketKey,
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
  //
  // Wheel: scales around the cursor in SVG coordinates. Drag: pans by
  // converting pixel deltas to viewBox-space deltas via the SVG bounding
  // rect. Auto-descend: after the wheel settles (200ms debounce), if the
  // cursor is over a smaller entity that is a valid descendant in the
  // current focus path, commit that focus change and clear the user camera
  // so the focus-driven snap animation runs.
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
  /**
   * Rolling target for wheel-zoom. Each wheel event stacks its zoom on
   * the *target* (not on the currently rendered camera) so rapid events
   * accumulate correctly even though the camera lags behind via the CSS
   * transition. Cleared when the user drags, clicks, or wheel idles.
   */
  const wheelTargetRef = useRef<UserCamera | null>(null);
  const wheelIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Convert a clientX/Y point into SVG-space coords given an explicit camera
   * (scale, tx, ty). The wheel handler uses this with the rolling target
   * camera (not the currently rendered one) so cursor-anchoring stays
   * consistent under rapid zoom events.
   */
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

  /** Convert a clientX/Y point into SVG viewBox coordinates using the current camera. */
  const clientToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null =>
      clientToSvgWithCamera(clientX, clientY, scale, tx, ty),
    [clientToSvgWithCamera, scale, tx, ty]
  );

  const runAutoDescend = useCallback(() => {
    const cursor = lastCursorSvg.current;
    if (!cursor) return;
    // Only auto-descend if the user is "zoomed in enough" vs the current
    // focus's natural scale (ratio > 1.6x). Below that the user is just
    // looking around.
    const focusScale = cameraTarget
      ? Math.min(CANVAS_W, CANVAS_H) / (cameraTarget.r * 2.9)
      : 1;
    if (scale < focusScale * 1.6) return;

    // Walk the hierarchy looking for the smallest container whose disc
    // covers the cursor in SVG space AND is a child of the current focus.
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
      const hitGroup = inner.groups.find(
        (g) => dist(g.cx, g.cy, cursor.x, cursor.y) <= g.r
      );
      if (hitGroup) {
        setFocusPath([focusedCompany.id, hitGroup.bucketKey]);
        setUserCamera(null);
      }
      return;
    }

    if (
      currentLevel === 2 &&
      inner &&
      focusedCompany &&
      focusedGroup
    ) {
      const hitProject = focusedGroup.projects
        .map((p) => inner.projects.find((lp) => lp.id === p.id))
        .filter((p): p is LaidProject => Boolean(p))
        .find((p) => dist(p.cx, p.cy, cursor.x, cursor.y) <= p.r);
      if (hitProject) {
        setFocusPath([
          focusedCompany.id,
          focusedGroup.bucketKey,
          hitProject.id,
        ]);
        setUserCamera(null);
      }
      return;
    }

    if (currentLevel === 3 && focusedProject && focusedCompany && focusedGroup) {
      const laid = positionMilestones(focusedProject);
      const hitMilestone = laid.find(
        (m) => dist(m.cx, m.cy, cursor.x, cursor.y) <= m.r
      );
      if (hitMilestone) {
        setFocusPath([
          focusedCompany.id,
          focusedGroup.bucketKey,
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
    focusedGroup,
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
      // preventDefault on a React wheel event requires the listener to be
      // non-passive; the attribute-style handler is already non-passive in
      // React 18+ for wheel. Guard with stopPropagation anyway.
      e.stopPropagation();

      // Base everything on the rolling wheel target (or the current
      // effective camera if none yet). This is critical for rapid wheel
      // events: each event stacks on the target rather than the currently
      // rendered camera, so a flick of the wheel actually goes where it
      // should instead of plateauing because the rendered scale hasn't
      // caught up yet.
      const baseScale = wheelTargetRef.current?.scale ?? scale;
      const baseTx =
        wheelTargetRef.current
          ? CANVAS_W / 2 - wheelTargetRef.current.cx * wheelTargetRef.current.scale
          : tx;
      const baseTy =
        wheelTargetRef.current
          ? CANVAS_H / 2 - wheelTargetRef.current.cy * wheelTargetRef.current.scale
          : ty;

      // Cursor in SVG-space relative to the target (not the currently
      // rendered camera) so anchoring stays consistent across rapid wheel
      // events.
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
      // for this company returns to the full portfolio, matching the zoom-in
      // affordance in reverse.
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

      // Keep the cursor's SVG point under the cursor after scaling.
      // On-screen constraint: tx + scale*cursor.x stays constant →
      // tx' = tx + (scale - nextScale) * cursor.x, same for y.
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

      // Reset the wheel idle timer — when the wheel stops emitting events
      // for a beat, drop the smoothing class so subsequent drags feel
      // direct.
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
      // Ignore right-click and pointer events originating on a child
      // interactive element (bubble/button) — those should not start a pan.
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target && target !== e.currentTarget && target.closest("[data-atlas-interactive=true]")) {
        return;
      }
      // Drag must feel direct — drop any wheel-zoom smoothing first.
      if (wheelIdleTimer.current) {
        clearTimeout(wheelIdleTimer.current);
        wheelIdleTimer.current = null;
      }
      wheelTargetRef.current = null;
      if (isWheelZooming) setIsWheelZooming(false);
      // Derive the current on-screen camera center from the effective
      // transform so dragging out of a focus-driven camera continues smoothly.
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
      // Convert pixel delta to viewBox delta (accounting for aspect-ratio fit).
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
      // Panning changes (cx, cy) by -Δviewbox / scale (drag right ⇒ content
      // moves right ⇒ camera center moves left).
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
        // Treat as background click — pop one level, same as before.
        popLevel();
      }
    },
    [popLevel]
  );

  // Cleanup debounce timers on unmount.
  useEffect(() => {
    return () => {
      if (autoDescendTimer.current) clearTimeout(autoDescendTimer.current);
      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current);
    };
  }, []);

  // When the focus path changes (any click that descends/pops), drop any
  // in-flight wheel-zoom smoothing so the focus snap reads cleanly.
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

  // React attaches wheel handlers as passive by default, so we can't
  // `preventDefault` from `onWheel`. Attach a native non-passive wheel
  // handler so wheel-zooming over the Atlas never scrolls the page/
  // ancestor container while still letting our camera update.
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
  //   Esc              → pop up a level (never leaves the overview).
  //   ArrowUp          → pop one level, same as Esc.
  //   ArrowLeft/Right  → cycle siblings at the current level (wraps).
  //   ArrowDown        → descend into the first sibling one level below.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs/textareas or when a modifier is used.
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
          // Cycle companies (sorted by activity so the order is stable).
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
        if (focusPath.length === 2 && focusedCompany && focusedGroup && inner) {
          const allGroups = inner.groups;
          const idx = allGroups.findIndex(
            (g) => g.bucketKey === focusedGroup.bucketKey
          );
          if (idx < 0 || allGroups.length === 0) return;
          const nextIdx = (idx + dir + allGroups.length) % allGroups.length;
          const next = allGroups[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([focusedCompany.id, next.bucketKey]);
          return;
        }
        if (
          focusPath.length === 3 &&
          focusedCompany &&
          focusedGroup &&
          focusedProject
        ) {
          // Cycle projects within the current group.
          const siblings = focusedGroup.projects;
          const idx = siblings.findIndex((p) => p.id === focusedProject.id);
          if (idx < 0 || siblings.length === 0) return;
          const nextIdx = (idx + dir + siblings.length) % siblings.length;
          const next = siblings[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([
            focusedCompany.id,
            focusedGroup.bucketKey,
            next.id,
          ]);
          return;
        }
        if (
          focusPath.length === 4 &&
          focusedCompany &&
          focusedGroup &&
          focusedProject &&
          focusedMilestoneLaid
        ) {
          // Cycle milestones (chronological via positionMilestones).
          const laid = positionMilestones(focusedProject);
          const idx = laid.findIndex((m) => m.id === focusedMilestoneLaid.id);
          if (idx < 0 || laid.length === 0) return;
          const nextIdx = (idx + dir + laid.length) % laid.length;
          const next = laid[nextIdx]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([
            focusedCompany.id,
            focusedGroup.bucketKey,
            focusedProject.id,
            next.id,
          ]);
          return;
        }
        return;
      }
      if (e.key === "ArrowDown") {
        // Descend into the first sibling at the next level.
        if (focusPath.length === 0 && companies.length > 0) {
          const sorted = [...companies].sort((a, b) => b.activity - a.activity);
          const first = sorted[0]!;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([first.id]);
          return;
        }
        if (focusPath.length === 1 && focusedCompany && inner) {
          const first = inner.groups[0];
          if (!first) return;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([focusedCompany.id, first.bucketKey]);
          return;
        }
        if (focusPath.length === 2 && focusedCompany && focusedGroup) {
          const first = focusedGroup.projects[0];
          if (!first) return;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([focusedCompany.id, focusedGroup.bucketKey, first.id]);
          return;
        }
        if (
          focusPath.length === 3 &&
          focusedCompany &&
          focusedGroup &&
          focusedProject
        ) {
          const laid = positionMilestones(focusedProject);
          const first = laid[0];
          if (!first) return;
          e.preventDefault();
          setUserCamera(null);
          setFocusPath([
            focusedCompany.id,
            focusedGroup.bucketKey,
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
    focusedGroup,
    focusedProject,
    focusedMilestoneLaid,
    inner,
    popLevel,
  ]);

  // Milestone panel context — mirrors what `MilestoneRow` / `ProjectRow`
  // pass through on the Roadmap so the panel's Slack preview + actions have
  // identical fidelity (live thread status, AI likelihood, AI-drafted
  // ping/nudge/reply).
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
      /** Whole tracker roster — needed for Slack popover roster hints + ping/nudge/reply dialogs. */
      people,
      /** Sibling milestones — used for AI likelihood context (same as Roadmap). */
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
        /* Short transition used while wheel-zooming. Each new wheel event
           re-targets the transform; CSS interpolates from the currently
           rendered position to the new target, giving a smooth chase
           feel rather than the instant jump that produces wheel choppy. */
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
            // Stop SMIL when drilling in; on overview, freeze at hover
            // without snapping (static translate + restorable begin time).
            const drift = driftDescriptorFor(company.id);
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
                      focusedGroup,
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

      {/* Floating zoom controls (right edge, vertically centered — avoids the bottom chat FAB). */}
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
 * Render one focused company's inner scene (groups + projects + milestones).
 * Factored out to keep the main component readable.
 */
function renderCompanyInner(args: {
  company: LaidCompany;
  inner: { groups: LaidGroup[]; projects: LaidProject[] };
  peopleById: Map<string, Person>;
  focusedGroup: LaidGroup | undefined;
  focusedProject: LaidProject | undefined;
  focusedMilestoneLaid: LaidMilestone | undefined;
  level: number;
  focusPath: FocusPath;
  setFocusPath: (next: FocusPath) => void;
  /** Current camera scale — text labels counter-scale so on-screen size stays constant. */
  scale: number;
}) {
  const {
    company,
    inner,
    peopleById,
    focusedGroup,
    focusedProject,
    focusedMilestoneLaid,
    level,
    focusPath,
    setFocusPath,
    scale,
  } = args;

  const showGroupLabels = level === 1;

  const focusLogoPath = company.company.logoPath?.trim() ?? "";
  const focusCenterLogoR = company.r * 0.24;

  return (
    <g>
      {level >= 1 && focusLogoPath ? (
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
            opacity={0.38}
          />
        </g>
      ) : null}

      {inner.groups.map((group) => {
        const isGroupFocused = focusedGroup?.bucketKey === group.bucketKey;
        const isGroupDimmed = Boolean(focusedGroup) && !isGroupFocused;
        const isEmpty = group.projectCount === 0;
        const clickable = level === 1 && !isGroupFocused;

        // Label placement: push outward along the ray from the company
        // center through the group center. This guarantees each goal's
        // label sits along its own unique radial direction, eliminating
        // the stacking that happened when two groups shared a y band.
        const dxRay = group.cx - company.cx;
        const dyRay = group.cy - company.cy;
        const rayLen = Math.hypot(dxRay, dyRay) || 1;
        const nx = dxRay / rayLen;
        const ny = dyRay / rayLen;
        // Offsets in on-screen pixels (counter-scaled group below).
        const labelDist = group.r * scale + 16;
        const labelX = group.cx + nx * labelDist;
        const labelY = group.cy + ny * labelDist;
        // Align text to the ray direction: left rays anchor end, right
        // rays anchor start, vertical rays stay centered.
        const anchor: "start" | "middle" | "end" =
          Math.abs(nx) < 0.35
            ? "middle"
            : nx > 0
              ? "start"
              : "end";
        const nameLines = splitGoalLabelName(
          group.label.toUpperCase().trim(),
          GOAL_LABEL_MAX_CHARS_PER_LINE
        );
        // Project count rides on its own line (same style as title).
        const titleLines: string[] = [...nameLines];
        if (!isEmpty) {
          titleLines.push(` · ${group.projectCount}`);
        }
        const lineHeight = 12;
        const titleNLines = titleLines.length;

        // Type chip — dominant ProjectType for non-empty goals; subtle "—"
        // chip for empty ones so the row reads consistently across goals.
        const goalType = dominantProjectType(group);
        const chipLabel = goalType ? goalType.toUpperCase() : null;
        const chipColor = goalType
          ? (PROJECT_TYPE_COLOR[goalType] ?? group.color)
          : group.color;
        const chipFontSize = 8;
        const chipPadX = 6;
        const chipPadY = 3;
        const chipCharW = chipFontSize * 0.62;
        const chipTextW = chipLabel ? chipLabel.length * chipCharW : 0;
        const chipW = chipLabel ? chipTextW + chipPadX * 2 : 0;
        const chipH = chipLabel ? chipFontSize + chipPadY * 2 : 0;
        const chipGap = chipLabel ? 6 : 0;

        // Vertical layout: chip then title, centered around `labelY`.
        const blockH = (chipLabel ? chipH + chipGap : 0) + titleNLines * lineHeight;
        const blockTop = labelY - blockH / 2;
        const chipCenterY = chipLabel ? blockTop + chipH / 2 : 0;
        const titleFirstY = chipLabel
          ? blockTop + chipH + chipGap + lineHeight * 0.5
          : titleNLines > 1
            ? blockTop + lineHeight * 0.5
            : labelY;
        // Chip x: align to the same anchor as the title text.
        const chipX =
          anchor === "start"
            ? labelX
            : anchor === "end"
              ? labelX - chipW
              : labelX - chipW / 2;

        return (
          <g
            key={group.id}
            className="atlas-fade"
            data-atlas-interactive={clickable ? "true" : undefined}
            style={{
              opacity: isGroupDimmed ? 0.1 : 1,
              cursor: clickable ? "pointer" : "default",
            }}
            onClick={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              setFocusPath([company.id, group.bucketKey]);
            }}
          >
            <circle
              cx={group.cx}
              cy={group.cy}
              r={group.r}
              fill={group.color}
              fillOpacity={0.04}
              stroke={group.color}
              strokeOpacity={0.35}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <g
              style={{ pointerEvents: "none", opacity: showGroupLabels ? 1 : 0 }}
              className="atlas-fade"
              transform={counterScaleTransform(group.cx, group.cy, scale)}
            >
              {chipLabel ? (
                <g>
                  <rect
                    x={chipX}
                    y={chipCenterY - chipH / 2}
                    width={chipW}
                    height={chipH}
                    rx={chipH / 2}
                    fill={chipColor}
                    fillOpacity={0.18}
                    stroke={chipColor}
                    strokeOpacity={0.7}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={chipX + chipW / 2}
                    y={chipCenterY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={chipFontSize}
                    fill={chipColor}
                    letterSpacing={1.4}
                    fontWeight={600}
                  >
                    {chipLabel}
                  </text>
                </g>
              ) : null}
              <text
                x={labelX}
                y={titleFirstY}
                textAnchor={anchor}
                dominantBaseline={titleNLines > 1 || chipLabel ? "alphabetic" : "middle"}
                fontSize={10}
                fill={group.color}
                letterSpacing={1.1}
                fontWeight={500}
              >
                {titleNLines > 1 || chipLabel
                  ? titleLines.map((line, i) => (
                      <tspan
                        key={i}
                        x={labelX}
                        dy={i === 0 ? 0 : lineHeight}
                      >
                        {line}
                      </tspan>
                    ))
                  : titleLines[0]}
              </text>
            </g>
          </g>
        );
      })}

      {inner.projects.map((project) => {
        const owner = peopleById.get(project.project.ownerId);
        const inFocusedGroup =
          focusedGroup?.projects.some((p) => p.id === project.id) ?? false;
        const isProjectFocused = focusedProject?.id === project.id;

        // Projects in other groups are hidden once a group is focused.
        if (level >= 2 && !inFocusedGroup) return null;

        const isProjectDimmed = level >= 3 && !isProjectFocused;
        // Label strategy:
        //   level 1 (whole company)   → no project text labels (would collide
        //                                since projects sit tightly on a small
        //                                ring inside each group). Project
        //                                circles still render with an owner
        //                                avatar and progress ring as compact
        //                                visual identifiers.
        //   level 2 (group focused)   → show labels for the ≤5 projects in
        //                                the focused group — there's room.
        //   level 3+ (project focused)→ label hidden by the camera zoom; the
        //                                breadcrumb + milestones provide
        //                                context instead.
        const showProjectLabel = level === 2;
        // Whether to render the compact avatar-only marker (level 1 only).
        const showProjectAvatarOnly = level === 1;

        return (
          <g key={project.id}>
            <AtlasProject
              project={project}
              owner={owner}
              showLabel={showProjectLabel}
              showAvatarOnly={showProjectAvatarOnly}
              isFocused={isProjectFocused}
              isDimmed={isProjectDimmed}
              scale={scale}
              onClick={() => {
                // Auto-descend through the group when clicking a project at level 1,
                // otherwise keep the current group focus.
                const groupKey = level < 2 ? project.bucketKey : focusPath[1]!;
                setFocusPath([company.id, groupKey, project.id]);
              }}
            />

            {isProjectFocused && level >= 3
              ? renderMilestoneArc({
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
      })}
    </g>
  );
}

/**
 * Draw the chronological milestone arc for a focused project:
 * a subtle connector path under the milestones plus a "TODAY" tick
 * interpolated between the earliest and latest target dates.
 *
 * Milestones themselves are positioned via `positionMilestones` (which sorts
 * chronologically) and rendered with `AtlasMilestone`. The arc/today tick
 * live in this parent so the geometry helper is shared (no duplicated
 * constants) and so the decoration can cheaply be hidden with a single
 * toggle at deeper levels if we ever want to.
 */
function renderMilestoneArc(args: {
  project: LaidProject;
  focusedMilestoneLaid: LaidMilestone | undefined;
  level: number;
  scale: number;
  onSelect: (milestoneId: string) => void;
}): React.ReactNode {
  const { project, focusedMilestoneLaid, level, scale, onSelect } = args;

  const laidMilestones = positionMilestones(project);
  const geom = getMilestoneArcGeometry(project);

  // Subtle dashed arc connecting the first and last milestone. SVG `path`
  // arc uses `A rx ry x-axis-rotation large-arc-flag sweep-flag x y`.
  const startX = geom.cx + Math.cos(geom.startAngle) * geom.r;
  const startY = geom.cy + Math.sin(geom.startAngle) * geom.r;
  const endX = geom.cx + Math.cos(geom.endAngle) * geom.r;
  const endY = geom.cy + Math.sin(geom.endAngle) * geom.r;
  // Sweep flag 0 = counter-clockwise in SVG coords (which is left→right
  // across the bottom, because angle decreases from 160° to 20°).
  const arcD = `M ${startX} ${startY} A ${geom.r} ${geom.r} 0 0 0 ${endX} ${endY}`;

  // Today marker position — only meaningful with ≥2 dated milestones that
  // span today. Maps today's date into the [firstYmd, lastYmd] range linearly.
  const todayTick = (() => {
    if (geom.datedCount < 2 || !geom.firstYmd || !geom.lastYmd) return null;
    const first = calendarDaysFromTodayYmd(geom.firstYmd);
    const last = calendarDaysFromTodayYmd(geom.lastYmd);
    if (first == null || last == null) return null;
    // first/last are "days from today to that date". We want t =
    // (0 - first) / (last - first) = -first / (last - first).
    const span = last - first;
    if (span <= 0) return null;
    const t = -first / span;
    if (t < -0.05 || t > 1.05) return null; // off-scale — don't draw
    const clampedT = Math.max(0, Math.min(1, t));
    const angle =
      geom.startAngle + (geom.endAngle - geom.startAngle) * clampedT;
    const tx = geom.cx + Math.cos(angle) * geom.r;
    const ty = geom.cy + Math.sin(angle) * geom.r;
    // Outward normal for the tick mark (radial from project center).
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return { tx, ty, nx, ny };
  })();

  // On-screen pixel helper — offsets used for the TODAY label below the tick
  // need to be constant regardless of camera zoom. Inside a counter-scaled
  // <g>, 1 SVG unit equals 1 on-screen pixel.
  const inv = 1 / Math.max(scale, 0.0001);

  return (
    <>
      {/* Connector arc — soft guide line under the milestones. */}
      <path
        d={arcD}
        fill="none"
        stroke="#3f3f46"
        strokeOpacity={0.55}
        strokeWidth={1}
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />

      {/* TODAY tick + label (only when today falls between first/last).
          Pushed further out along the radial normal than the milestone
          label band and painted with a subtle backdrop so it reads
          cleanly even if a milestone's date line happens to sit nearby. */}
      {todayTick ? (
        <g pointerEvents="none">
          <line
            x1={todayTick.tx - todayTick.nx * project.r * 0.03}
            y1={todayTick.ty - todayTick.ny * project.r * 0.03}
            x2={todayTick.tx + todayTick.nx * project.r * 0.1}
            y2={todayTick.ty + todayTick.ny * project.r * 0.1}
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
              x={todayTick.tx + todayTick.nx * 26 - 18}
              y={todayTick.ty + todayTick.ny * 26 - 7}
              width={36}
              height={12}
              rx={2}
              fill="#09090b"
              fillOpacity={0.75}
            />
            <text
              x={todayTick.tx + todayTick.nx * 26}
              y={todayTick.ty + todayTick.ny * 26 + 2}
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
        // Alternate the name-label side by arc index parity so adjacent
        // milestones' name blocks sit on opposite sides of the arc.
        const labelSide: "above" | "below" = idx % 2 === 0 ? "above" : "below";
        return (
          <AtlasMilestone
            key={m.id}
            milestone={m}
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
