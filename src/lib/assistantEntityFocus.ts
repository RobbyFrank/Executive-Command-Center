import type { TrackerData } from "@/lib/types/tracker";

function formatMilestonesForFocus(
  data: TrackerData,
  projectId: string,
): string {
  const ms = data.milestones.filter((m) => m.projectId === projectId);
  if (ms.length === 0) return "  (no milestones)";
  return ms
    .map(
      (m) =>
        `  - ${m.name} [${m.status}]${m.targetDate ? ` ${m.targetDate}` : ""}`,
    )
    .join("\n");
}

/**
 * Rich context for the assistant when the user focuses discussion on one entity.
 */
export function buildEntityFocusBlock(
  data: TrackerData,
  entity: {
    type: "company" | "goal" | "project" | "milestone";
    id: string;
    label: string;
  },
): string {
  const lines: string[] = [];
  lines.push(
    `FOCUSED ENTITY: ${entity.type.toUpperCase()} — "${entity.label}" (id: ${entity.id})`,
  );
  lines.push("");

  if (entity.type === "company") {
    const c = data.companies.find((x) => x.id === entity.id);
    if (!c) {
      lines.push("(Company record not found in data.)");
      return lines.join("\n");
    }
    lines.push(`Name: ${c.name}`);
    lines.push(`Short name: ${c.shortName}`);
    if (c.revenue > 0) lines.push(`MRR (USD thousands): ${c.revenue}`);
    if (c.website.trim()) lines.push(`Website: ${c.website}`);
    if (c.developmentStartDate.trim())
      lines.push(`Development start: ${c.developmentStartDate}`);
    if (c.launchDate.trim()) lines.push(`Launch: ${c.launchDate}`);
    if (c.description.trim()) lines.push(`Description: ${c.description}`);

    const goals = data.goals.filter((g) => g.companyId === c.id);
    lines.push("");
    lines.push(`Goals (${goals.length}):`);
    if (goals.length === 0) {
      lines.push("  (none)");
    } else {
      for (const g of goals) {
        const owner = g.ownerId
          ? data.people.find((p) => p.id === g.ownerId)?.name
          : "";
        lines.push(
          `- ${g.description} [${g.status}] P${g.priority}${owner ? ` — ${owner}` : ""}`,
        );
        const projects = data.projects.filter((p) => p.goalId === g.id);
        if (projects.length > 0) {
          lines.push(`  Projects: ${projects.map((p) => p.name).join("; ")}`);
        }
      }
    }
    return lines.join("\n");
  }

  if (entity.type === "goal") {
    const g = data.goals.find((x) => x.id === entity.id);
    if (!g) {
      lines.push("(Goal record not found in data.)");
      return lines.join("\n");
    }
    const company = data.companies.find((c) => c.id === g.companyId);
    const owner = g.ownerId
      ? data.people.find((p) => p.id === g.ownerId)?.name
      : "";
    lines.push(`Title: ${g.description}`);
    if (g.measurableTarget.trim())
      lines.push(`Measurable target / description: ${g.measurableTarget}`);
    if (g.whyItMatters.trim())
      lines.push(`Why it matters: ${g.whyItMatters}`);
    if (g.currentValue.trim())
      lines.push(`Current value: ${g.currentValue}`);
    lines.push(`Priority: ${g.priority} | Status: ${g.status}`);
    if (company) lines.push(`Company: ${company.name} (${company.shortName})`);
    if (owner) lines.push(`Owner: ${owner}`);

    const projects = data.projects.filter((p) => p.goalId === g.id);
    lines.push("");
    lines.push("Projects under this goal:");
    if (projects.length === 0) {
      lines.push("  (none)");
    } else {
      for (const p of projects) {
        lines.push(`- ${p.name} [${p.status}]`);
        lines.push(formatMilestonesForFocus(data, p.id));
      }
    }
    return lines.join("\n");
  }

  if (entity.type === "project") {
    const proj = data.projects.find((x) => x.id === entity.id);
    if (!proj) {
      lines.push("(Project record not found in data.)");
      return lines.join("\n");
    }
    const goal = data.goals.find((g) => g.id === proj.goalId);
    const company = goal
      ? data.companies.find((c) => c.id === goal.companyId)
      : undefined;
    lines.push(`Name: ${proj.name}`);
    if (proj.description.trim())
      lines.push(`Description: ${proj.description}`);
    if (proj.definitionOfDone.trim())
      lines.push(`Done when: ${proj.definitionOfDone}`);
    lines.push(`Priority: ${proj.priority} | Status: ${proj.status}`);
    if (goal) lines.push(`Parent goal: ${goal.description}`);
    if (company) lines.push(`Company: ${company.name} (${company.shortName})`);

    lines.push("");
    lines.push("Milestones:");
    lines.push(formatMilestonesForFocus(data, proj.id));
    return lines.join("\n");
  }

  const ms = data.milestones.find((x) => x.id === entity.id);
  if (!ms) {
    lines.push("(Milestone record not found in data.)");
    return lines.join("\n");
  }
  const proj = data.projects.find((p) => p.id === ms.projectId);
  const goal = proj
    ? data.goals.find((g) => g.id === proj.goalId)
    : undefined;
  const company = goal
    ? data.companies.find((c) => c.id === goal.companyId)
    : undefined;

  lines.push(`Name: ${ms.name}`);
  lines.push(`Status: ${ms.status}${ms.targetDate ? ` | Target: ${ms.targetDate}` : ""}`);
  if (ms.slackUrl.trim()) lines.push(`Slack: ${ms.slackUrl}`);
  if (proj) lines.push(`Project: ${proj.name}`);
  if (goal) lines.push(`Goal: ${goal.description}`);
  if (company) lines.push(`Company: ${company.name} (${company.shortName})`);

  return lines.join("\n");
}
