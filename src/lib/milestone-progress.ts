import type { Milestone } from "@/lib/types/tracker";

/** Percent of milestones marked Done (0–100), same formula everywhere. */
export function milestoneProgressPercent(milestones: Milestone[]): number {
  const total = milestones.length;
  if (total === 0) return 0;
  const done = milestones.filter((m) => m.status === "Done").length;
  return Math.round((done / total) * 100);
}
