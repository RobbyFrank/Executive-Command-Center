import type { Milestone } from "@/lib/types/tracker";

/** First milestone not marked Done, in stored list order. */
export function getNextPendingMilestone(
  milestones: Milestone[]
): Milestone | undefined {
  return milestones.find((m) => m.status !== "Done");
}
