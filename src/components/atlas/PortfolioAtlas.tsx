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

/** Euclidean distance between two 2D points (used for hit-testing circles). */
function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
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
/** Distance (px) of pointer movement required to treat pointerdown/up as a drag (not a click). */
const DRAG_THRESHOLD_PX = 4;

export function PortfolioAtlas({ hierarchy, people }: PortfolioAtlasProps) {
  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [grouping, setGroupingState] = useState<GroupingKey>("goal");
  const [userCamera, setUserCamera] = useState<UserCamera | null>(null);

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

  /** Snap the camera back to the current focus (clears any user-driven pan/zoom). */
  const snapToFocus = useCallback(() => {
    setUserCamera(null);
  }, []);

  /** Full overview — clears focus path and camera override. */
  const fitToAll = useCallback(() => {
    setUserCamera(null);
    setFocusPath([]);
  }, []);

  const crumbs: AtlasCrumb[] = [
    {
      label: "Portfolio",
      onClick: () => setFocusPath([]),
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

  /** Convert a clientX/Y point into SVG viewBox coordinates using the current camera. */
  const clientToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      // viewBox units the rect covers — viewBox is always fixed at
      // CANVAS_W × CANVAS_H because `preserveAspectRatio="xMidYMid meet"`
      // (SVG default). We compute the visible viewBox region after the
      // aspect-ratio fit, then map the pixel point in.
      const vbAspect = CANVAS_W / CANVAS_H;
      const rectAspect = rect.width / rect.height;
      let visW: number;
      let visH: number;
      let offsetX: number;
      let offsetY: number;
      if (rectAspect > vbAspect) {
        // Rect is wider than the viewBox aspect — viewBox is pillarboxed.
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
      // Point in untransformed viewBox coords.
      const vbX = (px / visW) * CANVAS_W;
      const vbY = (py / visH) * CANVAS_H;
      // Undo camera transform to get the SVG-space point.
      const x = (vbX - tx) / scale;
      const y = (vbY - ty) / scale;
      return { x, y };
    },
    [scale, tx, ty]
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
        (g) =>
          g.projectCount > 0 &&
          dist(g.cx, g.cy, cursor.x, cursor.y) <= g.r
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
      const point = clientToSvg(e.clientX, e.clientY);
      if (!point) return;
      lastCursorSvg.current = point;
      const factor = Math.exp(-e.deltaY / 400);
      const nextScale = Math.max(
        MIN_CAMERA_SCALE,
        Math.min(MAX_CAMERA_SCALE, scale * factor)
      );
      if (nextScale === scale) return;
      // Keep the cursor's SVG point under the cursor after scaling.
      // On-screen constraint: tx + scale*cursor.x stays constant →
      // tx' = tx + (scale - nextScale) * cursor.x, same for y.
      // Re-derive user camera (cx, cy) from (tx, ty, nextScale):
      // cx = (CANVAS_W / 2 - tx') / nextScale.
      const newTx = tx + (scale - nextScale) * point.x;
      const newTy = ty + (scale - nextScale) * point.y;
      setUserCamera({
        cx: (CANVAS_W / 2 - newTx) / nextScale,
        cy: (CANVAS_H / 2 - newTy) / nextScale,
        scale: nextScale,
      });
      scheduleAutoDescend();
    },
    [clientToSvg, scale, scheduleAutoDescend, tx, ty]
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
    [scale, tx, ty]
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

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (autoDescendTimer.current) clearTimeout(autoDescendTimer.current);
    };
  }, []);

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
          // Cycle groups with projects (skip empty ones — nothing inside to look at).
          const populated = inner.groups.filter((g) => g.projectCount > 0);
          const idx = populated.findIndex(
            (g) => g.bucketKey === focusedGroup.bucketKey
          );
          if (idx < 0 || populated.length === 0) return;
          const nextIdx = (idx + dir + populated.length) % populated.length;
          const next = populated[nextIdx]!;
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
          const populated = inner.groups.filter((g) => g.projectCount > 0);
          const first = populated[0];
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
        .atlas-surface {
          background:
            radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.06), transparent 60%),
            radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.05), transparent 55%),
            #09090b;
        }
      `}</style>

      <div className="atlas-surface pointer-events-none absolute inset-0" />

      {/* Header (top-left) */}
      <div className="pointer-events-none absolute left-6 top-6 z-10 select-none">
        <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-500">
          Portfolio atlas
        </p>
        <h1 className="mt-0.5 text-lg italic text-zinc-100">Momentum map</h1>
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
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-500">
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
          className={isUserDriven ? undefined : "atlas-camera"}
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {companies.map((company) => {
            const isFocused = focusedCompany?.id === company.id;
            const isDimmed = Boolean(focusedCompany) && !isFocused;

            return (
              <g key={company.id}>
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

      {/* Floating zoom controls (bottom-right). */}
      <div className="pointer-events-auto absolute bottom-6 right-6 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomAroundCenter(1.3, { scale, tx, ty }, setUserCamera)}
          aria-label="Zoom in"
          title="Zoom in"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/80 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomAroundCenter(1 / 1.3, { scale, tx, ty }, setUserCamera)}
          aria-label="Zoom out"
          title="Zoom out"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/80 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={fitToAll}
          aria-label="Fit all companies"
          title="Fit all"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/80 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {isUserDriven ? (
          <button
            type="button"
            onClick={snapToFocus}
            aria-label="Snap back to focus"
            title="Snap back to focus"
            className="mt-1 inline-flex h-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/80 px-2 font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
          >
            Snap
          </button>
        ) : null}
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

  return (
    <g>
      {inner.groups.map((group) => {
        const isGroupFocused = focusedGroup?.bucketKey === group.bucketKey;
        const isGroupDimmed = Boolean(focusedGroup) && !isGroupFocused;
        const isEmpty = group.projectCount === 0;
        // Empty goals can't be drilled into — there's nothing inside.
        const clickable = level === 1 && !isGroupFocused && !isEmpty;

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
        const countSuffix = isEmpty
          ? ""
          : ` · ${group.projectCount}`;
        const rawLabel = `${truncate(group.label, 28).toUpperCase()}${countSuffix}`;

        return (
          <g
            key={group.id}
            className="atlas-fade"
            data-atlas-interactive={clickable ? "true" : undefined}
            style={{
              // Empty goals are rendered at a lower baseline opacity so the
              // eye goes to the goals with actual work in them first.
              opacity: isGroupDimmed ? 0.1 : isEmpty ? 0.45 : 1,
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
              fillOpacity={isEmpty ? 0 : 0.04}
              stroke={group.color}
              strokeOpacity={isEmpty ? 0.2 : 0.35}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <g
              style={{ pointerEvents: "none", opacity: showGroupLabels ? 1 : 0 }}
              className="atlas-fade"
              transform={counterScaleTransform(group.cx, group.cy, scale)}
            >
              <text
                x={labelX}
                y={labelY}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={10}
                fill={group.color}
                fillOpacity={isEmpty ? 0.55 : 1}
                letterSpacing={1.1}
                fontWeight={500}
              >
                {rawLabel}
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
