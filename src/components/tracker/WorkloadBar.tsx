"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flag } from "lucide-react";
import type { Priority } from "@/lib/types/tracker";
import {
  PRIORITY_MENU_LABEL,
  priorityFlagIconClass,
  prioritySelectTextClass,
} from "@/lib/prioritySort";
import { cn } from "@/lib/utils";

function WorkloadSegment({
  flexGrow,
  count,
  className: segmentClass,
  roundLeft,
  roundRight,
}: {
  flexGrow: number;
  count: number;
  className: string;
  roundLeft?: boolean;
  roundRight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden",
        roundLeft && "rounded-l-full",
        roundRight && "rounded-r-full",
        segmentClass
      )}
      style={{ flex: flexGrow }}
    >
      <span
        className="pointer-events-none select-none px-0.5 text-center text-[10px] font-semibold tabular-nums leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]"
        aria-hidden
      >
        {count}
      </span>
    </div>
  );
}

export interface WorkloadBarProps {
  totalProjects: number;
  p0Projects: number;
  p1Projects: number;
  /** Max total projects among people on the team (for comparing load at a glance). */
  maxAcrossTeam: number;
  className?: string;
}

/** One roadmap-style row in the workload hover tooltip (Flag + menu label + count). */
function WorkloadTooltipPriorityRow({
  priority,
  count,
  extraFlag,
  label,
}: {
  priority: Priority;
  count: number;
  /** Second flag for combined Normal + Low bucket (matches blue bar segment = P2 + P3). */
  extraFlag?: Priority;
  /** Defaults to {@link PRIORITY_MENU_LABEL} for `priority`. */
  label?: string;
}) {
  const text = label ?? PRIORITY_MENU_LABEL[priority];
  return (
    <div className="flex items-center justify-between gap-6 tabular-nums">
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[11px] font-medium",
          extraFlag ? "text-zinc-200" : prioritySelectTextClass(priority)
        )}
      >
        <span className="flex shrink-0 items-center">
          <Flag
            className={cn("h-3.5 w-3.5", priorityFlagIconClass(priority))}
            strokeWidth={2}
            aria-hidden
          />
          {extraFlag ? (
            <Flag
              className={cn(
                "-ml-1 h-3.5 w-3.5",
                priorityFlagIconClass(extraFlag)
              )}
              strokeWidth={2}
              aria-hidden
            />
          ) : null}
        </span>
        <span className="min-w-0 truncate">{text}</span>
      </span>
      <span className="shrink-0 tabular-nums text-zinc-100">{count}</span>
    </div>
  );
}

/**
 * Portaled, cursor-following tooltip — used instead of the browser's native `title`
 * which the roster bar couldn't reliably surface on hover.
 */
function WorkloadHoverTooltip({
  totalProjects,
  p0Projects,
  p1Projects,
  other,
  anchorRef,
}: {
  totalProjects: number;
  p0Projects: number;
  p1Projects: number;
  other: number;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const onEnter = () => setVisible(true);
    const onLeave = () => setVisible(false);
    const onMove = (e: MouseEvent) => {
      setPos({ top: e.clientY + 14, left: e.clientX + 14 });
    };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("mousemove", onMove);
    };
  }, [anchorRef]);

  if (!mounted || !visible) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[2000] min-w-[11rem] rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg shadow-black/40 backdrop-blur-sm"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="flex items-center gap-1.5 tabular-nums">
        <span className="font-semibold">Total:</span>
        <span>{totalProjects}</span>
      </div>
      {totalProjects > 0 ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {p0Projects > 0 ? (
            <WorkloadTooltipPriorityRow priority="P0" count={p0Projects} />
          ) : null}
          {p1Projects > 0 ? (
            <WorkloadTooltipPriorityRow priority="P1" count={p1Projects} />
          ) : null}
          {other > 0 ? (
            <WorkloadTooltipPriorityRow
              priority="P2"
              extraFlag="P3"
              count={other}
              label={`${PRIORITY_MENU_LABEL.P2} & ${PRIORITY_MENU_LABEL.P3}`}
            />
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body
  );
}

/**
 * Stacked bar: width reflects load vs the busiest teammate; segments match roadmap priority colors.
 * Hover shows a portaled tooltip (roadmap Flag icons + Urgent / High / Normal & Low labels).
 */
export function WorkloadBar({
  totalProjects,
  p0Projects,
  p1Projects,
  maxAcrossTeam,
  className,
}: WorkloadBarProps) {
  const other = Math.max(0, totalProjects - p0Projects - p1Projects);
  const denom = Math.max(maxAcrossTeam, 1);
  const fillPct =
    totalProjects === 0 ? 0 : Math.min(100, (totalProjects / denom) * 100);

  const ariaLabel = (() => {
    if (totalProjects === 0) return "0 projects";
    const bits: string[] = [];
    if (p0Projects > 0) bits.push(`${p0Projects} ${PRIORITY_MENU_LABEL.P0}`);
    if (p1Projects > 0) bits.push(`${p1Projects} ${PRIORITY_MENU_LABEL.P1}`);
    if (other > 0) {
      bits.push(
        `${other} ${PRIORITY_MENU_LABEL.P2} and ${PRIORITY_MENU_LABEL.P3}`
      );
    }
    return `${totalProjects} project${totalProjects === 1 ? "" : "s"}: ${bits.join(", ")}`;
  })();

  const rootRef = useRef<HTMLDivElement>(null);

  if (totalProjects === 0) {
    return (
      <div
        ref={rootRef}
        className={cn(
          "relative h-5 min-w-[120px] w-full max-w-[200px] cursor-default",
          className
        )}
        role="img"
        aria-label={ariaLabel}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full bg-zinc-800/80 ring-1 ring-zinc-700/40">
          <span className="text-[10px] text-zinc-600 tabular-nums">0</span>
        </div>
        <WorkloadHoverTooltip
          totalProjects={totalProjects}
          p0Projects={p0Projects}
          p1Projects={p1Projects}
          other={other}
          anchorRef={rootRef}
        />
      </div>
    );
  }

  const p0Flex = p0Projects > 0 ? p0Projects : 0;
  const p1Flex = p1Projects > 0 ? p1Projects : 0;
  const oFlex = other > 0 ? other : 0;
  /** Only when the colored stack spans the full track — right cap matches the pill. */
  const capRight = fillPct >= 99.5;

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative h-5 min-w-[120px] w-full max-w-[200px] cursor-default",
        className
      )}
      role="img"
      aria-label={ariaLabel}
    >
      <div className="flex h-full w-full overflow-hidden rounded-full bg-zinc-800/90 ring-1 ring-zinc-700/50">
        <div
          className="flex h-full min-w-0 shrink-0 overflow-hidden rounded-l-full pointer-events-none"
          style={{ flex: `0 0 ${fillPct}%` }}
        >
          {p0Projects > 0 ? (
            <WorkloadSegment
              flexGrow={p0Flex}
              count={p0Projects}
              className="bg-red-500/85 min-w-[3px]"
              roundLeft
              roundRight={p1Projects === 0 && other === 0 && capRight}
            />
          ) : null}
          {p1Projects > 0 ? (
            <WorkloadSegment
              flexGrow={p1Flex}
              count={p1Projects}
              className="bg-orange-500/80 min-w-[3px]"
              roundLeft={p0Projects === 0}
              roundRight={other === 0 && capRight}
            />
          ) : null}
          {other > 0 ? (
            <WorkloadSegment
              flexGrow={oFlex}
              count={other}
              className="bg-sky-600/70 min-w-[3px]"
              roundLeft={p0Projects === 0 && p1Projects === 0}
              roundRight={capRight}
            />
          ) : null}
        </div>
        {fillPct < 100 ? (
          <div
            className="min-w-0 flex-1 bg-zinc-800/50 pointer-events-none"
            aria-hidden
          />
        ) : null}
      </div>
      <WorkloadHoverTooltip
        totalProjects={totalProjects}
        p0Projects={p0Projects}
        p1Projects={p1Projects}
        other={other}
        anchorRef={rootRef}
      />
    </div>
  );
}
