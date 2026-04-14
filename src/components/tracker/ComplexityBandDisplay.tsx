"use client";

import { parseScoreBand, scoreBandLabel, scoreBandLabelShort } from "@/lib/tracker-score-bands";
import { cn } from "@/lib/utils";

function fillClass(n: number): string {
  if (n <= 2) return "bg-zinc-500/45";
  if (n === 3) return "bg-violet-500/40";
  if (n === 4) return "bg-violet-500/55";
  return "bg-fuchsia-500/45";
}

function labelClass(n: number): string {
  if (n <= 2) return "text-zinc-400";
  if (n === 3) return "text-violet-200/90";
  if (n === 4) return "text-violet-100/95";
  return "text-fuchsia-100/95";
}

/**
 * Collapsed complexity readout for project rows: thin bar + band label (same pattern as cost of delay on goals).
 * Used with `InlineEditCell` `formatDisplay` (invisible native select overlay).
 */
export function complexityFormatDisplay(value: string) {
  const n = parseScoreBand(value);
  const pct = (n / 5) * 100;
  const labelFull = scoreBandLabel(n);
  const label = scoreBandLabelShort(n);
  return (
    <span className="flex min-w-0 w-full items-center gap-1.5" title={labelFull}>
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
          "min-w-0 flex-1 truncate text-left text-xs font-medium leading-tight",
          labelClass(n)
        )}
      >
        {label}
      </span>
    </span>
  );
}
