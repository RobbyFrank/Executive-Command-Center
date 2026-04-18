import type { GoalWithProjects } from "@/lib/types/tracker";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

/**
 * Latest (maximum calendar) milestone `targetDate` across all projects in the goal.
 * Empty string when no milestone has a valid dated target.
 */
export function goalLatestMilestoneDueDateYmd(goal: GoalWithProjects): string {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const p of goal.projects) {
    for (const m of p.milestones) {
      const raw = m.targetDate?.trim() ?? "";
      if (!raw) continue;
      const d = parseCalendarDateString(raw);
      if (!d) continue;
      const t = d.getTime();
      if (t > bestTime) {
        bestTime = t;
        best = raw;
      }
    }
  }
  return best ?? "";
}
