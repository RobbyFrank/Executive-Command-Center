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

/**
 * Icon + label for subtle add rows — same typography and hover as project milestone footer
 * “+ Add milestone” (normal weight, zinc-600 → zinc-400 on button hover only).
 */
export const TRACKER_ADD_ROW_ACTION_BUTTON_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-0 text-xs text-zinc-600 transition-colors hover:text-zinc-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50";

/** Resting opacity for empty-state helper copy */
export const TRACKER_EMPTY_HINT_REST_OPACITY_CLASS = "opacity-[0.52]";

/** Shared base for roadmap empty-state helper lines (no goals / projects / milestones yet). */
const TRACKER_EMPTY_HINT_COPY_BASE = `text-sm leading-relaxed [text-wrap:pretty] text-zinc-500 transition-opacity duration-150 ${TRACKER_EMPTY_HINT_REST_OPACITY_CLASS} focus-within:opacity-100`;

/**
 * Copy shown under a goal (no projects yet, or a project’s no-milestones line).
 * Brightens when the goal block is hovered — not per project row.
 */
export const TRACKER_EMPTY_HINT_COPY_GOAL_CLASS = `${TRACKER_EMPTY_HINT_COPY_BASE} group-hover/goal:opacity-100`;
