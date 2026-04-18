"use client";

import type { MouseEvent } from "react";
import { SlackLogo } from "./SlackLogo";
import { cn } from "@/lib/utils";

export interface StartSlackThreadChipProps {
  menuOpen: boolean;
  /** Opens the Draft / Add URL menu (click or context-menu). */
  onMenuTrigger: (e: MouseEvent<HTMLElement>) => void;
  ariaLabel: string;
  title?: string;
  className?: string;
}

/**
 * Slack + “Start Slack thread” — secondary CTA next to milestone content. Same chip anatomy
 * as the amber "New milestone" row (`rounded border` + `text-xs` + no underline), but neutral
 * zinc surfaces so it doesn’t read as a tinted “brand” pill. Slack glyph still blooms to full
 * color on hover/open — that’s the only strong color cue.
 *
 * Shared by collapsed project rows and expanded milestone rows.
 */
export function StartSlackThreadChip({
  menuOpen,
  onMenuTrigger,
  ariaLabel,
  title = "Next milestone has no Slack thread — draft with AI or paste a URL",
  className,
}: StartSlackThreadChipProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={(e) => {
        e.stopPropagation();
        onMenuTrigger(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenuTrigger(e);
      }}
      className={cn(
        "group/start-slack inline-flex w-fit max-w-full shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-left text-xs font-medium leading-tight transition-[color,background-color,border-color,box-shadow] duration-150",
        "border-zinc-600/50 bg-zinc-950/55 text-zinc-200 ring-1 ring-inset ring-zinc-700/40",
        "hover:border-zinc-500/60 hover:bg-zinc-800/70 hover:text-zinc-50 hover:ring-zinc-600/50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        menuOpen && "border-zinc-500/60 bg-zinc-800/70 text-zinc-50 ring-zinc-600/50",
        className
      )}
    >
      <SlackLogo
        className={cn(
          "h-3.5 w-3.5 shrink-0 opacity-90 saturate-[0.6] transition-[filter,opacity] duration-150",
          "group-hover/start-slack:saturate-100 group-hover/start-slack:opacity-100",
          "group-focus-visible/start-slack:saturate-100 group-focus-visible/start-slack:opacity-100",
          menuOpen && "saturate-100 opacity-100"
        )}
      />
      <span className="shrink-0 whitespace-nowrap">Start Slack thread</span>
    </button>
  );
}
