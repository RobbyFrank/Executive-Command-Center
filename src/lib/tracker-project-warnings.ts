import type {
  GoalWithProjects,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";
import { clampAutonomy, isFounderPerson } from "@/lib/autonomyRoster";
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
  const isUnassigned = !project.ownerId;

  const raw = project.targetDate?.trim() ?? "";
  const missingTargetDate =
    !raw || parseCalendarDateString(raw) === null;

  const hasMilestoneMissingDate = project.milestones.some(
    (ms) => ms.status !== "Done" && !ms.targetDate?.trim()
  );

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
  if (hasMilestoneMissingDate)
    list.push({
      label: "Milestone undated",
      title: "One or more active milestones have no target date",
    });
  if (missingTargetDate)
    list.push({
      label: "No due date",
      title: "No target date — set one in the Date column",
    });
  if (isUnassigned)
    list.push({ label: "Unassigned", title: "No owner assigned" });
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
   * When false, only goal-level chips are returned (unassigned, no projects).
   * Per-project issues are omitted — use on an expanded Roadmap goal row where
   * project rows show their own warnings.
   * @default true
   */
  includeProjectWarnings?: boolean;
};

/**
 * Goal header warning chips — same rules as Roadmap `GoalSection` (per-project
 * issues rolled up; multi-project goals prefix with project name) when
 * `includeProjectWarnings` is true.
 */
export function getGoalHeaderWarnings(
  goal: GoalWithProjects,
  people: Person[],
  options?: GetGoalHeaderWarningsOptions
): TrackerWarning[] {
  const includeProjectWarnings = options?.includeProjectWarnings !== false;

  const goalUnassigned: TrackerWarning | null = !goal.ownerId
    ? {
        label: "No goal DRI",
        title: "Assign a directly responsible individual (DRI) for this goal",
      }
    : null;

  if (goal.projects.length === 0) {
    if (!goalUnassigned) {
      return [
        {
          label: "No projects",
          title: "No projects yet — add a project to deliver this goal",
        },
      ];
    }
    return [
      {
        label: "No projects",
        title: "No projects yet — add a project to deliver this goal",
      },
      goalUnassigned,
    ];
  }

  if (!includeProjectWarnings) {
    return goalUnassigned ? [goalUnassigned] : [];
  }

  const multi = goal.projects.length > 1;
  const list: TrackerWarning[] = [];
  if (goalUnassigned) list.push(goalUnassigned);
  for (const p of goal.projects) {
    const pw = getTrackerProjectWarnings(p, goal.costOfDelay, people);
    for (const w of pw) {
      if (goalUnassigned && w.label === "Unassigned") continue;
      list.push({
        label: multi ? `${p.name}: ${w.label}` : w.label,
        title: w.title,
      });
    }
  }
  return list;
}
