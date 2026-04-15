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
 * Slack + “Start Slack thread” — same on collapsed project row and expanded milestone row:
 * no border/fill at rest, content-width, subtle hover (aligned with `MilestoneSlackThreadInline`).
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
        "inline-flex w-fit max-w-full shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors",
        "text-zinc-200 hover:bg-zinc-800/50 hover:text-zinc-100",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40",
        className
      )}
    >
      <SlackLogo className="h-4 w-4 shrink-0 opacity-95 saturate-100" />
      <span className="shrink-0 whitespace-nowrap text-sm font-semibold leading-snug">
        Start Slack thread
      </span>
    </button>
  );
}
