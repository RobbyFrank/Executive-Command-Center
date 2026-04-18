import { getNextPendingMilestone } from "@/lib/next-milestone";
import type { GoalWithProjects, Milestone } from "@/lib/types/tracker";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

function milestoneNeedsDueDate(m: Milestone): boolean {
  const raw = m.targetDate?.trim() ?? "";
  return !raw || parseCalendarDateString(raw) === null;
}

/**
 * Milestone to attach when the user sets a due date from the goal row shortcut (calendar icon).
 * Prefers each project’s next pending milestone that still needs a date; otherwise any milestone
 * in list order that lacks a valid target date.
 */
export function milestoneForGoalDueDateShortcut(
  goal: GoalWithProjects
): Milestone | null {
  for (const p of goal.projects) {
    const next = getNextPendingMilestone(p.milestones);
    if (!next) continue;
    if (milestoneNeedsDueDate(next)) return next;
  }
  for (const p of goal.projects) {
    for (const m of p.milestones) {
      if (milestoneNeedsDueDate(m)) return m;
    }
  }
  return null;
}

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
