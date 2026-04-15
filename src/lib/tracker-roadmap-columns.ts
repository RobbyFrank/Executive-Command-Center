/**
 * Horizontal layout for Roadmap `ProjectRow` / `TrackerColumnHeaders` must stay in sync.
 *
 * Used as **`left`** on the absolutely positioned Slack preview / “Start thread” chip in
 * `MilestoneRow` — approximately aligned with the **Progress** column on the project row
 * (not Next milestone). Tuned by subtracting Progress→Due→Next span from the old Next-MS calc.
 */
export const TRACKER_ROADMAP_NEXT_MS_COLUMN_PL_FROM_MILESTONE_ROW =
  "calc(360px + 38.35rem + 0.375rem + 65px)";

/** Goal / project title column — matches {@link GoalsColumnHeaders} / {@link ProjectsColumnHeaders}. */
export const ROADMAP_TITLE_COL_CLASS = "w-[360px] shrink-0 min-w-0";
