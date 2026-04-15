import type { ProjectWithMilestones } from "@/lib/types/tracker";

/**
 * Heuristic "zombie" project: In Progress but no milestone progress yet
 * (we don't store per-milestone completion timestamps).
 */
export function isProjectZombie(p: ProjectWithMilestones): boolean {
  return p.status === "In Progress" && p.progress <= 0;
}
