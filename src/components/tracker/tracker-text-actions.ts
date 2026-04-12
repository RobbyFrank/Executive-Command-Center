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
