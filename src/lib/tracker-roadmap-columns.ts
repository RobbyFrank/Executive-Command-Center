/**
 * Horizontal layout for Roadmap `ProjectRow` / `TrackerColumnHeaders` must stay in sync.
 *
 * Used as **`left`** on the absolutely positioned Slack preview in `MilestoneRow` so the
 * status dot lines up with the **horizon chip** (e.g. `8D`) in the project row Next
 * milestone column — same as `ProjectRow`’s `px-1.5` inset inside that cell.
 *
 * Math: column start `(1.5rem + 360px + 55.85rem) − 2rem` + chip padding `0.375rem` (`px-1.5`).
 */
export const TRACKER_ROADMAP_NEXT_MS_COLUMN_PL_FROM_MILESTONE_ROW =
  "calc(360px + 55.35rem + 0.375rem)";
