import type { SlackSuggestionRecord, SlackScrapeSuggestion } from "@/lib/schemas/tracker";
import type { TrackerData } from "@/lib/types/tracker";

function goalIdsForCompany(
  data: TrackerData,
  companyId: string
): Set<string> {
  return new Set(
    data.goals.filter((g) => g.companyId === companyId).map((g) => g.id)
  );
}

/**
 * True if the payload references a goal/project/milestone that no longer exists
 * in the tracker (or is the wrong company).
 */
export function isScrapeSuggestionOrphaned(
  data: TrackerData,
  companyId: string,
  s: SlackScrapeSuggestion
): boolean {
  return !isScrapeSuggestionValidForCompany(data, companyId, s);
}

export function isScrapeSuggestionValidForCompany(
  data: TrackerData,
  companyId: string,
  s: SlackScrapeSuggestion
): boolean {
  const goalIds = goalIdsForCompany(data, companyId);
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const msById = new Map(data.milestones.map((m) => [m.id, m]));

  if (s.kind === "newGoalWithProjects") {
    return true;
  }
  if (s.kind === "newProjectOnExistingGoal") {
    return goalIds.has(s.existingGoalId);
  }
  if (s.kind === "editGoal") {
    return goalIds.has(s.existingGoalId);
  }
  if (s.kind === "editProject") {
    const p = projectById.get(s.existingProjectId);
    return Boolean(p && goalIds.has(p.goalId));
  }
  if (s.kind === "addMilestoneToExistingProject") {
    const p = projectById.get(s.existingProjectId);
    return Boolean(p && goalIds.has(p.goalId));
  }
  if (s.kind === "editMilestone") {
    const m = msById.get(s.existingMilestoneId);
    if (!m) return false;
    const p = projectById.get(m.projectId);
    return Boolean(p && goalIds.has(p.goalId));
  }
  return true;
}

export function isPendingRecordOrphaned(
  data: TrackerData,
  rec: SlackSuggestionRecord
): boolean {
  if (rec.status !== "pending") return false;
  return isScrapeSuggestionOrphaned(data, rec.companyId, rec.payload);
}

/**
 * If every field in the edit patch already matches the tracker, the suggestion is redundant.
 */
export function isFullyAppliedEdit(
  data: TrackerData,
  rec: SlackSuggestionRecord
): boolean {
  const p = rec.payload;
  if (p.kind === "editGoal") {
    const g = data.goals.find((x) => x.id === p.existingGoalId);
    if (!g) return true;
    const pat = p.patch;
    for (const [k, v] of Object.entries(pat)) {
      if (v === undefined) continue;
      if (k === "description" && g.description !== v) return false;
      if (k === "measurableTarget" && (g.measurableTarget ?? "") !== v) return false;
      if (k === "whyItMatters" && (g.whyItMatters ?? "") !== v) return false;
      if (k === "currentValue" && (g.currentValue ?? "") !== v) return false;
      if (k === "ownerPersonId" && (g.ownerId ?? "") !== v) return false;
      if (k === "slackChannelId" && (g.slackChannelId ?? "") !== (v as string)) return false;
    }
    return true;
  }
  if (p.kind === "editProject") {
    const proj = data.projects.find((x) => x.id === p.existingProjectId);
    if (!proj) return true;
    const pat = p.patch;
    for (const [k, v] of Object.entries(pat)) {
      if (v === undefined) continue;
      if (k === "name" && proj.name !== v) return false;
      if (k === "description" && (proj.description ?? "") !== v) return false;
      if (k === "status" && proj.status !== v) return false;
      if (k === "priority" && proj.priority !== v) return false;
      if (k === "assigneePersonId") {
        const a = (proj.assigneeIds ?? [])[0] ?? "";
        if (a !== (v as string)) return false;
      }
    }
    return true;
  }
  if (p.kind === "editMilestone") {
    const m = data.milestones.find((x) => x.id === p.existingMilestoneId);
    if (!m) return true;
    const pat = p.patch;
    for (const [k, v] of Object.entries(pat)) {
      if (v === undefined) continue;
      if (k === "name" && m.name !== v) return false;
      if (k === "targetDate" && (m.targetDate ?? "") !== (v as string)) return false;
    }
    return true;
  }
  return false;
}
