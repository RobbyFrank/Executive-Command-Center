import type { ProjectWithMilestones } from "@/lib/types/tracker";

/**
 * Sequential pipeline: dependency-ordered projects. Returns completed work
 * (100% progress) plus the first incomplete project — later stages are omitted
 * until the current step finishes.
 */
export function getSequentialQueueProjects(
  projects: ProjectWithMilestones[]
): ProjectWithMilestones[] {
  const firstIncomplete = projects.findIndex((p) => p.progress < 100);
  if (firstIncomplete === -1) return projects;
  return projects.slice(0, firstIncomplete + 1);
}
