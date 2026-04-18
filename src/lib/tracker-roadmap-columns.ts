/**
 * Milestone list under a project — left rail + tint so milestones read nested under the project row
 * (row content uses {@link ROADMAP_MILESTONE_GRID_PADDING_CLASS} for a deeper indent than projects).
 */
export const ROADMAP_MILESTONE_BAND_CLASS =
  "rounded-r-md border-l-[3px] border-zinc-600/60 bg-zinc-900/45";

/**
 * Inline title typography for **goal**, **project**, and **milestone** names on the Roadmap grid
 * (`InlineEditCell` `displayClassName`).
 */
export const ROADMAP_ENTITY_TITLE_DISPLAY_CLASS =
  "text-[13px] font-semibold text-zinc-100";

/** Goal header row / {@link GoalsColumnHeaders} — base grid padding. */
export const ROADMAP_GOAL_GRID_PADDING_CLASS = "pl-4 pr-3";

/**
 * Collapsed project row / {@link ProjectsColumnHeaders} — indented vs goals so the chevron +
 * project title read nested under the goal band. Must stay in sync with
 * {@link ROADMAP_GOAL_TITLE_COL_CLASS}: goal title width = 360px + (project pl − goal pl).
 */
export const ROADMAP_PROJECT_GRID_PADDING_CLASS = "pl-14 pr-3";

/**
 * Milestone rows under an expanded project — indented one more step than {@link ROADMAP_PROJECT_GRID_PADDING_CLASS}
 * so the gap Project→Milestone matches Goal→Project (each +2.5rem vs the parent row).
 */
export const ROADMAP_MILESTONE_GRID_PADDING_CLASS = "pl-24 pr-3";

/**
 * Fixed slot for the optional “Next” chip on every milestone row — reserve width even when the chip
 * is absent so milestone names (and Slack previews when present) share one vertical alignment.
 */
export const ROADMAP_MILESTONE_NEXT_CHIP_SLOT_CLASS =
  "flex w-11 shrink-0 items-center justify-start";

/**
 * When a linked Slack thread is shown, cap milestone title width so long names truncate before the
 * absolutely positioned thread strip (paired with {@link TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT}).
 */
export const ROADMAP_MILESTONE_TITLE_MAX_WHEN_SLACK_THREAD_STRIP_CLASS =
  "max-w-[calc(360px+12rem-3px)]";

/**
 * **`left`** for absolutely positioned milestone Slack UI — aligns the strip with the **goal** row
 * **Confidence** column: {@link ROADMAP_GOAL_GRID_PADDING_CLASS} + chevron + gaps + {@link ROADMAP_GOAL_TITLE_COL_CLASS}
 * + owner + priority + delay cost + gaps (`360px + 24rem` from the goal row’s flex start), minus the milestone band’s
 * **3px** border. Keep in sync with `GoalSection` column order.
 */
export const TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT =
  "calc(1rem + 360px + 24rem - 3px)";

/**
 * Project name column (360px) — {@link ProjectsColumnHeaders} and {@link ProjectRow}.
 * Owner and following columns align with {@link ROADMAP_GOAL_TITLE_COL_CLASS} on goal rows
 * because goal title is wider by the same amount as the extra project row padding.
 */
export const ROADMAP_PROJECT_TITLE_COL_CLASS = "w-[360px] shrink-0 min-w-0";

/**
 * Goal title column — wider than {@link ROADMAP_PROJECT_TITLE_COL_CLASS} by (project row
 * pl − goal row pl) so the Owner column lines up vertically across goal vs project rows.
 */
export const ROADMAP_GOAL_TITLE_COL_CLASS =
  "w-[calc(360px+2.5rem)] shrink-0 min-w-0";

/** Gap between roadmap grid cells — goals, projects, and sticky headers stay in sync. */
export const ROADMAP_GRID_GAP_CLASS = "gap-2";

/**
 * Uniform width for Priority, Delay cost, Complexity, Confidence, Slack, Status,
 * Due date, and Progress columns (Next milestone stays `w-[36rem]`).
 */
export const ROADMAP_DATA_COL_CLASS = "w-28 shrink-0 grow-0 min-w-0";

/**
 * Owner column on goal/project rows — avatar-only (`OwnerPickerCell`); much narrower than
 * {@link ROADMAP_DATA_COL_CLASS} so Priority sits next to the DRI control instead of a wide
 * empty band.
 */
export const ROADMAP_OWNER_COL_CLASS = "w-12 shrink-0 grow-0 min-w-0";

/** Next milestone column on project rows; goal rows use the same width as an empty spacer. */
export const ROADMAP_NEXT_MILESTONE_COL_CLASS =
  "w-[36rem] shrink-0 grow-0 min-w-0";
