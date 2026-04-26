import { createHash } from "crypto";
import type { SlackScrapeSuggestion } from "@/lib/schemas/tracker";

function shortHash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deterministic id for rejection memory and merge hints.
 * (Reconciliation may rewrite items; the model is not required to use this for collapsing.)
 */
export function computeSlackSuggestionDedupeKey(
  companyId: string,
  s: SlackScrapeSuggestion
): string {
  const cid = companyId.trim();
  switch (s.kind) {
    case "newGoalWithProjects":
      return shortHash(
        `newGoal|${cid}|${norm(s.goal.description)}`
      );
    case "newProjectOnExistingGoal":
      return shortHash(
        `newProj|${s.existingGoalId}|${norm(s.project.name)}`
      );
    case "editGoal":
      return shortHash(`editGoal|${s.existingGoalId}`);
    case "editProject":
      return shortHash(`editProj|${s.existingProjectId}`);
    case "addMilestoneToExistingProject":
      return shortHash(
        `addMile|${s.existingProjectId}|${norm(s.milestone.name)}`
      );
    case "editMilestone":
      return shortHash(`editMile|${s.existingMilestoneId}`);
    default: {
      const _exhaustive: never = s;
      return shortHash(String(_exhaustive));
    }
  }
}
