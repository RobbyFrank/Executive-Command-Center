"use client";

import { createPortal } from "react-dom";
import {
  formatRelativeCalendarDate,
} from "@/lib/relativeCalendarDate";
import type { Milestone } from "@/lib/types/tracker";

/**
 * Small fixed tooltip by a milestone pip on the project bubble (L2). Shows
 * name, status, and due / relative date.
 */
export function AtlasMilestonePipTip({
  milestone,
  asOfYmd,
  asOf,
  anchorRect,
}: {
  milestone: Milestone;
  /** Server “today” (YYYY-MM-DD) — same as the rest of the Atlas. */
  asOfYmd: string;
  asOf: Date;
  anchorRect: { left: number; top: number; width: number; height: number };
}) {
  if (typeof document === "undefined") return null;

  const cx = anchorRect.left + anchorRect.width / 2;
  const top = anchorRect.top;
  const hasDate = milestone.targetDate.trim().length > 0;
  const overdue =
    milestone.status !== "Done" &&
    hasDate &&
    milestone.targetDate < asOfYmd;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] w-[min(16rem,calc(100vw-1rem)))] rounded-md border border-zinc-600/80 bg-zinc-950/95 px-2.5 py-2 text-xs text-zinc-100 shadow-lg backdrop-blur-sm"
      style={{
        left: cx,
        top: top,
        transform: "translate(-50%, calc(-100% - 6px))",
      }}
      role="tooltip"
    >
      <p className="line-clamp-2 font-medium leading-snug text-zinc-50">
        {milestone.name}
      </p>
      <p className="mt-1 text-zinc-400">
        <span className="text-zinc-300">{milestone.status}</span>
        {hasDate ? (
          <span className={overdue ? "text-rose-300" : "text-zinc-500"}>
            {` — ${milestone.targetDate} (${formatRelativeCalendarDate(
              milestone.targetDate,
              asOf
            )})`}
          </span>
        ) : (
          <span> — no target date</span>
        )}
      </p>
    </div>,
    document.body
  );
}
