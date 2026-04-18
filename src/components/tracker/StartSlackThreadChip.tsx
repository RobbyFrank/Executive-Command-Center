"use client";

import type { MouseEvent } from "react";
import { Plus } from "lucide-react";
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
 * Slack + **+** icon button — draft or paste a thread URL (collapsed project **Next milestone**
 * column and expanded milestone rows). Tooltip via `title`; accessible name via `ariaLabel`.
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
        "group/start-slack inline-flex h-7 min-w-[2.125rem] shrink-0 items-center justify-center gap-px rounded-md px-0.5 text-zinc-600 transition-colors duration-150",
        "hover:bg-zinc-800/80 hover:text-emerald-300",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        menuOpen && "bg-zinc-800/80 text-emerald-300",
        className,
      )}
    >
      <span className="inline-flex items-center gap-px" aria-hidden>
        <SlackLogo
          className={cn(
            "h-3.5 w-3.5 opacity-90 saturate-[0.65] transition-[filter,opacity] duration-150",
            "group-hover/start-slack:saturate-100 group-hover/start-slack:opacity-100",
            menuOpen && "saturate-100 opacity-100",
          )}
        />
        <Plus
          className={cn(
            "h-3 w-3 shrink-0 stroke-[2.75] text-zinc-500 transition-colors group-hover/start-slack:text-emerald-300/95",
            menuOpen && "text-emerald-300/95",
          )}
          aria-hidden
        />
      </span>
    </button>
  );
}
