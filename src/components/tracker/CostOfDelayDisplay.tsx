"use client";

import { parseScoreBand, scoreBandLabel } from "@/lib/tracker-score-bands";
import { cn } from "@/lib/utils";

function fillClass(n: number): string {
  if (n <= 2) return "bg-zinc-500/45";
  if (n === 3) return "bg-sky-500/35";
  if (n === 4) return "bg-amber-500/45";
  return "bg-amber-400/50";
}

function labelClass(n: number): string {
  if (n <= 2) return "text-zinc-400";
  if (n === 3) return "text-zinc-200";
  if (n === 4) return "text-amber-200/90";
  return "text-amber-100/95";
}

/**
 * Collapsed cost-of-delay readout for goal rows: thin urgency bar + band label.
 * Used with `InlineEditCell` `formatDisplay` (invisible native select overlay).
 */
export function costOfDelayFormatDisplay(value: string) {
  const n = parseScoreBand(value);
  const pct = (n / 5) * 100;
  const label = scoreBandLabel(n);
  return (
    <span className="flex min-w-0 w-full items-center gap-1.5">
      <span
        className="relative h-1 w-9 shrink-0 overflow-hidden rounded-full bg-zinc-800/90"
        aria-hidden
      >
        <span
          className={cn(
            "absolute left-0 top-0 h-full rounded-full transition-[width] duration-200",
            fillClass(n)
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left text-xs font-medium tabular-nums leading-tight",
          labelClass(n)
        )}
      >
        {label}
      </span>
    </span>
  );
}
