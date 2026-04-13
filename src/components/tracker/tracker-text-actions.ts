/**
 * Shared classes for inline roadmap actions (end of helper copy or compact footer).
 * Underline + slightly brighter text so they read as links, not body text.
 */

/** After paragraph copy (“…this goal.” / “…this company.”) */
export const TRACKER_INLINE_TEXT_ACTION =
  "inline align-baseline border-0 bg-transparent p-0 font-medium text-zinc-300 underline underline-offset-[3px] decoration-zinc-500/65 hover:text-zinc-100 hover:decoration-zinc-300/75 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-sm";

/** Hover row under a goal (Add project / Add goal) */
export const TRACKER_FOOTER_TEXT_ACTION =
  "inline border-0 bg-transparent p-0 text-xs font-medium text-zinc-400 underline underline-offset-2 decoration-zinc-600/55 hover:text-zinc-200 hover:decoration-zinc-400/70 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-sm";

/** Resting opacity for empty-state helper copy — reused by the company “Add goal” footer row when goals exist */
export const TRACKER_EMPTY_HINT_REST_OPACITY_CLASS = "opacity-[0.52]";

/** Shared base for roadmap empty-state helper lines (no goals / projects / milestones yet). */
const TRACKER_EMPTY_HINT_COPY_BASE = `text-sm leading-relaxed [text-wrap:pretty] text-zinc-500 transition-opacity duration-150 ${TRACKER_EMPTY_HINT_REST_OPACITY_CLASS} focus-within:opacity-100`;

/**
 * Copy shown under a goal (no projects yet, or a project’s no-milestones line).
 * Brightens when the goal block is hovered — not per project row.
 */
export const TRACKER_EMPTY_HINT_COPY_GOAL_CLASS = `${TRACKER_EMPTY_HINT_COPY_BASE} group-hover/goal:opacity-100`;

/** No goals under a company — only this company block’s hover/focus brightens the hint. */
export const TRACKER_EMPTY_HINT_COPY_COMPANY_CLASS = `${TRACKER_EMPTY_HINT_COPY_BASE} group-hover/company:opacity-100`;

/**
 * Company footer (“Add goal” + AI) when the company already has goals — same resting opacity as
 * the “No goals yet…” empty hint; brightens with company hover/focus like that hint.
 */
export const TRACKER_COMPANY_ADD_GOAL_ROW_VISIBILITY_CLASS = `${TRACKER_EMPTY_HINT_REST_OPACITY_CLASS} transition-opacity duration-150 group-hover/company:opacity-100 group-focus-within/company:opacity-100 focus-within:opacity-100`;
