/**
 * Approximate heights for Roadmap label rows (matches `py-1.5` + single-line labels).
 * Used to stack sticky `top` offsets before ResizeObserver measurements settle.
 */
export const TRACKER_GOALS_COLUMN_HEADER_HEIGHT_PX = 36;
export const TRACKER_PROJECTS_COLUMN_HEADER_HEIGHT_PX = 36;

/** Until `RoadmapStickyToolbar` reports height (avoids a flash of wrong offset). */
export const ROADMAP_TOOLBAR_STICKY_FALLBACK_PX = 140;

/**
 * Space **between** the sticky filter toolbar and the sticky company row — not padding
 * inside the toolbar. See `RoadmapStickyBelowToolbarGap` in the Roadmap layout; company
 * `top` and downstream sticky offsets add this after the measured toolbar height.
 */
export const ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX = 20;

/** Goal header row (`py-1.5` + one line) — fallback before ResizeObserver. */
export const TRACKER_GOAL_HEADER_ROW_FALLBACK_PX = 38;

/**
 * Subtracted from the computed sticky `top` for goal rows so they tuck under the
 * goals column label row (constant header height can sit a few px low vs paint).
 * Increase if a hairline gap appears between the sticky labels and the goal row.
 */
export const ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX = 11;
