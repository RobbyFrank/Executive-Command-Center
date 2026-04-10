import type { Milestone } from "@/lib/types/tracker";

/** Ascending by targetDate (YYYY-MM-DD); undated milestones sort last; ties by name. */
export function compareMilestonesByTargetDate(a: Milestone, b: Milestone): number {
  const ta = a.targetDate?.trim() ?? "";
  const tb = b.targetDate?.trim() ?? "";
  if (ta !== tb) {
    if (!ta) return 1;
    if (!tb) return -1;
    const c = ta.localeCompare(tb);
    if (c !== 0) return c;
  }
  return a.name.localeCompare(b.name);
}
