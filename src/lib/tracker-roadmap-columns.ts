/**
 * Expanded milestone block under a project — light top rule + shelf tint only. Each project is its own
 * card (`ProjectRow`); this avoids a second “nested band” that matched the old goal-level project strip.
 * Row content still uses {@link ROADMAP_MILESTONE_GRID_PADDING_CLASS} for indent vs project rows.
 */
export const ROADMAP_MILESTONE_LIST_SHELF_CLASS =
  "border-t border-zinc-800/40 bg-zinc-950/30";

/**
 * Inline title typography for **goal**, **project**, and **milestone** names on the Roadmap grid
 * (`InlineEditCell` `displayClassName`).
 */
export const ROADMAP_ENTITY_TITLE_DISPLAY_CLASS =
  "text-[13px] font-semibold text-zinc-100";

/** Goal header row / {@link GoalsColumnHeaders} — base grid padding. */
export const ROADMAP_GOAL_GRID_PADDING_CLASS = "pl-4 pr-3";

/**
 * Collapsed project row (`ProjectRow`) — left padding is **0** because each project card sits inside a
 * wrapper indented by {@link ROADMAP_PROJECT_CARD_INDENT_PX} (so the goal→project tree spine and stub fit
 * to its left). Combined indent (`56px` wrapper + `0` row) still equals the historic project indent so
 * Owner and following columns line up with goal rows: goal title is wider by exactly that 56px gap
 * (`360px + 2.5rem` vs `360px`). Must stay in sync with {@link ROADMAP_GOAL_TITLE_COL_CLASS}.
 */
export const ROADMAP_PROJECT_GRID_PADDING_CLASS = "pl-0 pr-3";

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
 * When milestone Slack UI is absolutely positioned at {@link TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT},
 * cap the **title cell** width so names truncate before that strip. The slack `left` is measured from the
 * milestone row’s flex start; the title starts after {@link ROADMAP_MILESTONE_GRID_PADDING_CLASS} (`pl-24`),
 * the done toggle, `gap-2`, the target date (`w-28`), `gap-2`, and {@link ROADMAP_MILESTONE_NEXT_CHIP_SLOT_CLASS}
 * (`w-11`) — **17.75rem** total from row start to the title — plus a **0.5rem** gap before the strip.
 */
export const ROADMAP_MILESTONE_TITLE_MAX_WHEN_SLACK_THREAD_STRIP_CLASS =
  "max-w-[min(100%,calc(1rem+360px+24rem-3px-3.5rem-17.75rem-0.5rem))]";

/**
 * **`left`** for absolutely positioned milestone Slack UI — aligns the strip with the **goal** row
 * **Confidence** column. Distance from the **goal row's flex start** to that column:
 * {@link ROADMAP_GOAL_GRID_PADDING_CLASS} (`pl-4` = 1rem) + chevron + gaps + {@link ROADMAP_GOAL_TITLE_COL_CLASS}
 * + owner + priority + delay cost + gaps (`360px + 24rem` from the goal row's flex start), minus the project card's
 * **3px** left border. Project cards now sit indented by {@link ROADMAP_PROJECT_CARD_INDENT_PX} from that flex
 * start (so the tree spine + horizontal stub fits to their left), so milestone rows must subtract that indent
 * from the absolute `left`. Keep in sync with `GoalSection` column order.
 */
export const TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT =
  "calc(1rem + 360px + 24rem - 3px - 3.5rem)";

/**
 * Distance (px) from each goal row's flex start to the left edge of every project card under it.
 * Equals **`pl-14` = 3.5rem = 56px** so cards sit just past the goal-tree horizontal stub
 * (spine at goal chevron center + a stub of width `ROADMAP_PROJECT_CARD_INDENT_PX − 32px`).
 */
export const ROADMAP_PROJECT_CARD_INDENT_PX = 56;

/**
 * Project name column (360px) — {@link ProjectRow} (grid aligns with goal rows via width + padding).
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
 * Default width for Priority, Delay cost, Complexity, Confidence, Due date, and Progress
 * (Next milestone stays `w-[36rem]`). Goal **Slack** uses {@link ROADMAP_GOAL_SLACK_COL_CLASS}
 * (`w-max`) on the Roadmap grid.
 */
export const ROADMAP_DATA_COL_CLASS = "w-28 shrink-0 grow-0 min-w-0";

/**
 * Legacy fixed-width slot (e.g. docs / layout reference). Goal Slack on the Roadmap uses
 * {@link ROADMAP_GOAL_SLACK_COL_CLASS} so the channel name can grow with content.
 */
export const ROADMAP_SLACK_AND_PROJECT_STATUS_COL_CLASS =
  "w-30 shrink-0 grow-0 min-w-0";

/**
 * Goal row **Slack** column — width follows the channel label (no fixed max); keeps grid alignment
 * with {@link GoalsColumnHeaders}.
 */
export const ROADMAP_GOAL_SLACK_COL_CLASS = "w-max min-w-0 shrink-0";

/**
 * {@link ROADMAP_DATA_COL_CLASS} with a little right inset so centered score-band icons
 * (Delay cost on goals, Complexity on projects) sit slightly left of the column edge.
 */
export const ROADMAP_DELAY_COMPLEXITY_COL_CLASS = `${ROADMAP_DATA_COL_CLASS} pr-1.5`;

/**
 * Owner column on goal/project rows — avatar-only (`OwnerPickerCell`); much narrower than
 * {@link ROADMAP_DATA_COL_CLASS} so Priority sits next to the DRI control instead of a wide
 * empty band.
 */
export const ROADMAP_OWNER_COL_CLASS = "w-12 shrink-0 grow-0 min-w-0";

/** Next milestone column on project rows; goal rows use the same width as an empty spacer. */
export const ROADMAP_NEXT_MILESTONE_COL_CLASS =
  "w-[36rem] shrink-0 grow-0 min-w-0";

/**
 * Default (non at-risk, non-spotlight) project card shell — keep in sync with neutral branch of
 * {@link ProjectRow}.
 */
export const ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS =
  "max-w-full min-w-0 overflow-hidden rounded-md border border-zinc-800/55 bg-zinc-900/45 shadow-sm ring-1 ring-black/25 border-l-[3px] border-l-zinc-600/60 transition-colors duration-150 motion-reduce:transition-none hover:bg-zinc-900/60 hover:border-zinc-700/65";

/** Inner row fill on neutral project rows — keep in sync with {@link ProjectRow}. */
export const ROADMAP_PROJECT_INNER_ROW_NEUTRAL_CLASS = "bg-zinc-950/55";

/**
 * Goal header sticky fill — a hair lighter than the project inner row
 * ({@link ROADMAP_PROJECT_INNER_ROW_NEUTRAL_CLASS}) so hierarchy still reads, but kept
 * close to zinc-950 so the strip does not read as a bright band. Solid (no backdrop-blur).
 */
export const ROADMAP_GOAL_HEADER_SURFACE_CLASS =
  "bg-[var(--surface-group-header)]";

/** Goal header hover — slightly lighter than {@link ROADMAP_GOAL_HEADER_SURFACE_CLASS} / `--surface-group-header`. */
export const ROADMAP_GOAL_HEADER_NEUTRAL_HOVER_CLASS = "hover:bg-[#1e1e26]";

/**
 * Neutral goal block outer (no at-risk / spotlight) — shell fill aligned with
 * {@link ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS}; omits full perimeter border so stacked
 * goals keep a single divider between blocks.
 */
export const ROADMAP_GOAL_OUTER_NEUTRAL_CLASS =
  "bg-zinc-900/45 ring-1 ring-black/25 border-l-[3px] border-l-zinc-600/60";

/**
 * Roadmap company title row (sticky under toolbar) — `--surface-toolbar` with a subtle hover
 * lift so it reads like goal/project rows.
 */
export const ROADMAP_COMPANY_STICKY_HEADER_CLASS =
  "bg-[var(--surface-toolbar)] transition-colors duration-150 motion-reduce:transition-none hover:bg-[#0f0f15]";

