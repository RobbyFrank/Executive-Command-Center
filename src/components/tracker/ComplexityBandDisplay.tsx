"use client";

import { Check } from "lucide-react";
import {
  parseScoreBand,
  scoreBandLabel,
  scoreBandLabelShort,
} from "@/lib/tracker-score-bands";
import { cn } from "@/lib/utils";
import type { OverlaySelectFormatContext } from "./overlaySelectTypes";

const BAR_HEIGHTS_PX = [5, 9, 13] as const;

function labelClass(n: number): string {
  if (n <= 2) return "text-zinc-400";
  if (n === 3) return "text-violet-200/90";
  if (n === 4) return "text-violet-100/95";
  return "text-fuchsia-100/95";
}

/** Whether bar `idx` (0 = shortest) is filled for complexity 1–5. */
function barFilled(n: number, idx: number): boolean {
  if (n <= 1) return false;
  if (n === 2) return idx === 0;
  if (n === 3) return idx <= 1;
  return true;
}

function barFillClass(n: number, idx: number): string {
  if (!barFilled(n, idx)) return "";
  if (n === 2) return "bg-zinc-500/75";
  if (n === 3) return idx === 0 ? "bg-zinc-400/85" : "bg-violet-500/60";
  if (n === 4) return "bg-violet-500/75";
  return "bg-fuchsia-400/90";
}

/**
 * Three ascending bars (signal-strength style): unfilled = outline, filled = solid.
 * Matches 1–5 by how many bars activate (1→none … 4–5→all three, with stronger hues at top).
 */
export function ComplexitySignalIcon({ level }: { level: number }) {
  const n = Math.min(5, Math.max(1, Math.round(level)));
  return (
    <span
      className="inline-flex h-[13px] shrink-0 items-end gap-[3px]"
      aria-hidden
    >
      {BAR_HEIGHTS_PX.map((h, idx) => {
        const filled = barFilled(n, idx);
        return (
          <span
            key={idx}
            className={cn(
              "w-[3px] shrink-0 rounded-[1px]",
              filled
                ? barFillClass(n, idx)
                : "border border-zinc-500/55 bg-transparent"
            )}
            style={{ height: h }}
          />
        );
      })}
    </span>
  );
}

/**
 * Collapsed complexity readout: signal bars + short label (same pattern as priority: icon + text).
 */
export function complexityFormatDisplay(
  value: string,
  ctx?: OverlaySelectFormatContext
) {
  const n = parseScoreBand(value);
  const labelFull = scoreBandLabel(n);

  if (ctx?.role === "trigger") {
    return (
      <span className="flex w-full items-center justify-center" title={labelFull}>
        <ComplexitySignalIcon level={n} />
      </span>
    );
  }

  const label = scoreBandLabelShort(n);
  const showCheck = ctx?.role === "option" && ctx.isSelected;
  return (
    <span className="flex min-w-0 w-full items-center justify-between gap-2" title={labelFull}>
      <span className="flex min-w-0 items-center gap-2">
        <ComplexitySignalIcon level={n} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm font-medium leading-tight",
            labelClass(n)
          )}
        >
          {label}
        </span>
      </span>
      {showCheck ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-violet-400"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : null}
    </span>
  );
}
