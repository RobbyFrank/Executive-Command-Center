import type {
  GoalWithProjects,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";
import { clampAutonomy, isFounderPerson } from "@/lib/autonomyRoster";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

export type TrackerWarning = { label: string; title: string };

/** Same rules as the project row warning chips — one entry per applicable issue. */
export function getTrackerProjectWarnings(
  project: ProjectWithMilestones,
  goalCostOfDelay: number | undefined,
  people: Person[]
): TrackerWarning[] {
  const list: TrackerWarning[] = [];
  const cod = goalCostOfDelay ?? 0;
  const ownerPerson = people.find((p) => p.id === project.ownerId);

  const raw = project.targetDate?.trim() ?? "";
  const missingTargetDate =
    !raw || parseCalendarDateString(raw) === null;

  const nextOpen = getNextPendingMilestone(project.milestones);
  const nextMilestoneMissingDate =
    nextOpen !== undefined && !nextOpen.targetDate?.trim();

  const highCodLowAutonomy =
    cod >= 4 &&
    ownerPerson &&
    !isFounderPerson(ownerPerson) &&
    clampAutonomy(ownerPerson.autonomyScore) < 4;

  if (project.milestones.length === 0)
    list.push({
      label: "No milestones",
      title: "No milestones yet — add checkpoints to track delivery",
    });
  if (nextMilestoneMissingDate)
    list.push({
      label: "Next milestone undated",
      title:
        "The next open milestone (first not done) has no target date — set it on that row",
    });
  if (missingTargetDate)
    list.push({
      label: "No due date",
      title:
        "No milestone target dates — set a target date on at least one milestone for this project",
    });
  if (highCodLowAutonomy)
    list.push({
      label: "Low autonomy / high CoD",
      title:
        "Owner autonomy is under 4 on a goal with high cost of delay — consider reassigning or increasing oversight",
    });
  return list;
}

export type GetGoalHeaderWarningsOptions = {
  /**
   * When false, no goal-header chips are returned — per-project issues stay on each `ProjectRow`
   * (Roadmap `GoalSection` passes false). When true, project warnings are rolled onto the goal
   * (multi-project goals prefix with project name).
   * @default true
   */
  includeProjectWarnings?: boolean;
};

/**
 * Goal header warning chips. Roadmap uses `includeProjectWarnings: false` so project
 * warnings appear only on project rows; set true to roll up project issues onto the goal.
 * Unassigned goal DRI is not surfaced here — the owner control already shows unassigned.
 */
export function getGoalHeaderWarnings(
  goal: GoalWithProjects,
  people: Person[],
  options?: GetGoalHeaderWarningsOptions
): TrackerWarning[] {
  const includeProjectWarnings = options?.includeProjectWarnings !== false;

  if (goal.projects.length === 0) {
    /** Goal row shows a “No projects” badge in {@link GoalSection}; no rollup warnings. */
    return [];
  }

  if (!includeProjectWarnings) {
    return [];
  }

  const multi = goal.projects.length > 1;
  const list: TrackerWarning[] = [];
  for (const p of goal.projects) {
    const pw = getTrackerProjectWarnings(p, goal.costOfDelay, people);
    for (const w of pw) {
      list.push({
        label: multi ? `${p.name}: ${w.label}` : w.label,
        title: w.title,
      });
    }
  }
  return list;
}
