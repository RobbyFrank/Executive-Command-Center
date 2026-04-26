import type { SlackSuggestionRecord } from "@/lib/schemas/tracker";

export type SuggestionFilterId =
  | "all"
  | "new"
  | "edits"
  | "status"
  | "dates"
  | "owner";

export function matchesSuggestionFilter(
  rec: SlackSuggestionRecord,
  f: SuggestionFilterId
): boolean {
  const k = rec.payload.kind;
  if (f === "all") return true;
  if (f === "new") {
    return (
      k === "newGoalWithProjects" ||
      k === "newProjectOnExistingGoal" ||
      k === "addMilestoneToExistingProject"
    );
  }
  if (f === "edits") {
    return k === "editGoal" || k === "editProject" || k === "editMilestone";
  }
  if (f === "status") {
    return (
      k === "editProject" &&
      rec.payload.patch.status !== undefined
    );
  }
  if (f === "dates") {
    if (k === "addMilestoneToExistingProject") return true;
    if (k === "editMilestone")
      return (
        rec.payload.patch.targetDate !== undefined ||
        rec.payload.patch.name !== undefined
      );
    return false;
  }
  if (f === "owner") {
    return (
      (k === "editGoal" &&
        rec.payload.patch.ownerPersonId !== undefined) ||
      (k === "editProject" &&
        rec.payload.patch.assigneePersonId !== undefined)
    );
  }
  return true;
}
