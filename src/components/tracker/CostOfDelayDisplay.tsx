"use client";

import { parseScoreBand, scoreBandLabel, scoreBandLabelShort } from "@/lib/tracker-score-bands";
import { cn } from "@/lib/utils";
import type { OverlaySelectFormatContext } from "./overlaySelectTypes";

function fillClass(n: number): string {
  if (n <= 2) return "bg-zinc-500/45";
  if (n === 3) return "bg-sky-500/35";
  if (n === 4) return "bg-amber-500/45";
  return "bg-amber-400/50";
}

function strokeColor(n: number): string {
  if (n <= 2) return "stroke-zinc-500";
  if (n === 3) return "stroke-zinc-300";
  if (n === 4) return "stroke-amber-400/90";
  return "stroke-amber-300";
}

function warnFill(n: number): string {
  if (n <= 2) return "fill-zinc-600";
  if (n === 3) return "fill-zinc-400";
  if (n === 4) return "fill-amber-500/80";
  return "fill-amber-400";
}

function labelClass(n: number): string {
  if (n <= 2) return "text-zinc-400";
  if (n === 3) return "text-zinc-200";
  if (n === 4) return "text-amber-200/90";
  return "text-amber-100/95";
}

/**
 * Clock with warning triangle + urgency bar underneath.
 * The clock hand rotates further and the bar fills more at higher levels.
 */
function CostOfDelayIcon({ level }: { level: number }) {
  const pct = (level / 5) * 100;
  const hourAngle = (level / 5) * 300 + 30;
  const minuteAngle = (level / 5) * 180 + 90;

  return (
    <span className="inline-flex flex-col items-center gap-[2px]" aria-hidden>
      <svg
        viewBox="0 0 20 20"
        className="h-[18px] w-[18px] shrink-0"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Clock ring */}
        <circle
          cx="10"
          cy="10"
          r="8"
          className={cn("fill-none", strokeColor(level))}
          strokeWidth="1.5"
        />
        {/* Hour tick marks at 12, 3, 6, 9 */}
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1="10"
            y1="3.2"
            x2="10"
            y2="4.4"
            className={strokeColor(level)}
            strokeWidth="1.2"
            strokeLinecap="round"
            transform={`rotate(${deg} 10 10)`}
          />
        ))}
        {/* Minute hand (shorter) */}
        <line
          x1="10"
          y1="10"
          x2="10"
          y2="5.8"
          className={strokeColor(level)}
          strokeWidth="1.2"
          strokeLinecap="round"
          transform={`rotate(${minuteAngle} 10 10)`}
        />
        {/* Hour hand */}
        <line
          x1="10"
          y1="10"
          x2="10"
          y2="6.8"
          className={strokeColor(level)}
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${hourAngle} 10 10)`}
        />
        {/* Center dot */}
        <circle cx="10" cy="10" r="1" className={cn(strokeColor(level))} fill="currentColor" strokeWidth="0" />
        {/* Warning triangle (top-left) — only at 3+ */}
        {level >= 3 && (
          <path
            d="M3.2 0.6 L6.2 0.6 L4.7 3.8 Z"
            className={warnFill(level)}
            stroke="none"
          />
        )}
      </svg>
      {/* Urgency bar */}
      <span className="relative h-[2.5px] w-[18px] overflow-hidden rounded-full bg-zinc-800/90">
        <span
          className={cn(
            "absolute left-0 top-0 h-full rounded-full transition-[width] duration-200",
            fillClass(level)
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

function CostOfDelayBarIcon({ level }: { level: number }) {
  const pct = (level / 5) * 100;
  return (
    <span
      className="relative h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-800/90"
      aria-hidden
    >
      <span
        className={cn(
          "absolute left-0 top-0 h-full rounded-full transition-[width] duration-200",
          fillClass(level)
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * Collapsed cost-of-delay readout for goal rows: thin urgency bar + band label.
 * Used with `InlineEditCell` `formatDisplay` (invisible native select overlay).
 */
export function costOfDelayFormatDisplay(
  value: string,
  ctx?: OverlaySelectFormatContext
) {
  const n = parseScoreBand(value);
  const labelFull = scoreBandLabel(n);

  if (ctx?.role === "trigger") {
    return (
      <span className="flex w-full items-center justify-center" title={labelFull}>
        <CostOfDelayIcon level={n} />
      </span>
    );
  }

  const label = scoreBandLabelShort(n);
  return (
    <span className="flex min-w-0 w-full items-center gap-1.5" title={labelFull}>
      <CostOfDelayBarIcon level={n} />
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
