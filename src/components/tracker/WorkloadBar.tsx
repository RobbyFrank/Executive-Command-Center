"use client";

import { cn } from "@/lib/utils";

export interface WorkloadBarProps {
  totalProjects: number;
  p0Projects: number;
  p1Projects: number;
  /** Max total projects among people on the team (for comparing load at a glance). */
  maxAcrossTeam: number;
  className?: string;
}

/**
 * Stacked bar: width reflects load vs the busiest teammate; segments show P0 / P1 / other priorities.
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

  const label = `${totalProjects} project${totalProjects === 1 ? "" : "s"}${totalProjects > 0 ? ` (${p0Projects} P0, ${p1Projects} P1, ${other} other)` : ""}`;

  if (totalProjects === 0) {
    return (
      <div
        className={cn("flex items-center gap-2 min-w-[200px]", className)}
        title="No owned projects"
      >
        <div
          className="h-5 flex-1 min-w-[120px] rounded-full bg-zinc-800/80 ring-1 ring-zinc-700/40 flex items-center justify-center"
          role="img"
          aria-label="No owned projects"
        >
          <span className="text-[10px] text-zinc-600 tabular-nums">0</span>
        </div>
      </div>
    );
  }

  const p0Flex = p0Projects > 0 ? p0Projects : 0;
  const p1Flex = p1Projects > 0 ? p1Projects : 0;
  const oFlex = other > 0 ? other : 0;

  return (
    <div
      className={cn("flex items-center gap-2 min-w-[200px]", className)}
      title={label}
    >
      <div
        className="h-5 flex-1 min-w-[120px] flex rounded-full overflow-hidden ring-1 ring-zinc-700/50 bg-zinc-800/90"
        role="img"
        aria-label={label}
      >
        <div
          className="flex h-full min-w-0 overflow-hidden rounded-l-full shrink-0"
          style={{ flex: `0 0 ${fillPct}%` }}
        >
          {p0Projects > 0 ? (
            <div
              className="h-full bg-red-500/85 min-w-[3px] first:rounded-l-full"
              style={{ flex: p0Flex }}
            />
          ) : null}
          {p1Projects > 0 ? (
            <div
              className="h-full bg-orange-500/80 min-w-[3px]"
              style={{ flex: p1Flex }}
            />
          ) : null}
          {other > 0 ? (
            <div
              className={cn(
                "h-full bg-sky-600/70 min-w-[3px]",
                p0Projects === 0 && p1Projects === 0 && "rounded-l-full",
                "last:rounded-r-full"
              )}
              style={{ flex: oFlex }}
            />
          ) : null}
        </div>
        {fillPct < 100 ? (
          <div
            className="flex-1 min-w-0 bg-zinc-800/50"
            aria-hidden
          />
        ) : null}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-zinc-300 w-8 text-right">
        {totalProjects}
      </span>
    </div>
  );
}
