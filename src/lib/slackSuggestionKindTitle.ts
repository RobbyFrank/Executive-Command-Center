import type { Person } from "@/lib/types/tracker";
import type { SlackSuggestionRecord } from "@/lib/schemas/tracker";

function personName(people: Person[], id: string): string {
  if (!id.trim()) return "—";
  return people.find((p) => p.id === id)?.name ?? id;
}

export function slackSuggestionKindTitle(
  rec: SlackSuggestionRecord,
  people: Person[]
): string {
  const p = rec.payload;
  switch (p.kind) {
    case "newGoalWithProjects": {
      const n = p.goal.description.slice(0, 80);
      return `New goal: ${n}${p.goal.description.length > 80 ? "…" : ""}`;
    }
    case "newProjectOnExistingGoal":
      return `New project: ${p.project.name}`;
    case "editGoal": {
      const parts: string[] = [];
      if (p.patch.description !== undefined) parts.push("title");
      if (p.patch.ownerPersonId)
        parts.push(`owner → ${personName(people, p.patch.ownerPersonId)}`);
      if (p.patch.slackChannelId) parts.push("Slack channel");
      if (p.patch.measurableTarget !== undefined) parts.push("target");
      return `Update goal: ${parts.join(", ") || "fields"}`;
    }
    case "editProject": {
      const q: string[] = [];
      if (p.patch.name !== undefined) q.push("name");
      if (p.patch.status) q.push(`status → ${p.patch.status}`);
      if (p.patch.priority) q.push("priority");
      if (p.patch.assigneePersonId)
        q.push(`assignee → ${personName(people, p.patch.assigneePersonId)}`);
      return `Update project: ${q.join(", ") || "fields"}`;
    }
    case "addMilestoneToExistingProject":
      return `Add milestone: ${p.milestone.name} (${p.milestone.targetDate})`;
    case "editMilestone":
      return `Update milestone: ${[p.patch.name, p.patch.targetDate].filter(Boolean).join(" · ")}`;
    default: {
      const _e: never = p;
      return String(_e);
    }
  }
}
