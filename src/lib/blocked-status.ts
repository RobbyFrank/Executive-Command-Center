import { milestoneProgressPercent } from "@/lib/milestone-progress";
import type { Milestone } from "@/lib/types/tracker";

/**
 * True when the blocking project is still incomplete: no milestones yet, or not
 * all milestones marked Done (progress &lt; 100%).
 */
export function isBlockingProjectIncomplete(
  blockingMilestones: Milestone[]
): boolean {
  if (blockingMilestones.length === 0) return true;
  return milestoneProgressPercent(blockingMilestones) < 100;
}
