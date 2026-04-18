/**
 * Horizontal layout for Roadmap `ProjectRow` / `TrackerColumnHeaders` must stay in sync.
 *
 * Used as **`left`** on the absolutely positioned Slack preview / “Start thread” chip in
 * `MilestoneRow` — the left edge sits just inside the Status column's right edge (where the
 * first post-Status project cell begins). After the Due-date / Progress swap this is the
 * **Due date** column; the chip's wide max-width still extends across Progress and into
 * Next milestone, so the inline thread preview remains visually anchored in the same spot.
 * Tuned by subtracting the post-Status column span from the old Next-MS calc.
 */
export const TRACKER_ROADMAP_NEXT_MS_COLUMN_PL_FROM_MILESTONE_ROW =
  "calc(360px + 38.35rem + 0.375rem + 65px)";

/** Goal / project title column — matches {@link GoalsColumnHeaders} / {@link ProjectsColumnHeaders}. */
export const ROADMAP_TITLE_COL_CLASS = "w-[360px] shrink-0 min-w-0";
