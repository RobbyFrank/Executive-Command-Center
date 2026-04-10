/**
 * Approximate heights for Roadmap label rows (matches `py-2` + single-line labels).
 * Used to stack sticky `top` offsets before ResizeObserver measurements settle.
 */
export const TRACKER_GOALS_COLUMN_HEADER_HEIGHT_PX = 40;
export const TRACKER_PROJECTS_COLUMN_HEADER_HEIGHT_PX = 40;

/** Until `RoadmapStickyToolbar` reports height (avoids a flash of wrong offset). */
export const ROADMAP_TOOLBAR_STICKY_FALLBACK_PX = 140;

/** Goal header row (`py-2` + one line) — fallback before ResizeObserver. */
export const TRACKER_GOAL_HEADER_ROW_FALLBACK_PX = 44;
