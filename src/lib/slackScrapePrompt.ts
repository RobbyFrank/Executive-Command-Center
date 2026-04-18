import type { Company, Goal, Person, Project, TrackerData } from "@/lib/types/tracker";

export function formatCompanyDetail(c: Company): string {
  const lines: string[] = [];
  lines.push(`COMPANY: ${c.name} (${c.shortName})`);
  const desc = c.description.trim();
  if (desc) lines.push(`Description: ${desc}`);
  const website = c.website.trim();
  if (website) lines.push(`Website: ${website}`);
  if (c.revenue > 0) {
    lines.push(`MRR (thousands USD): ${c.revenue}`);
  }
  const launch = c.launchDate.trim();
  if (launch) lines.push(`Launch date: ${launch}`);
  const devStart = c.developmentStartDate.trim();
  if (devStart) lines.push(`Development start: ${devStart}`);
  return lines.join("\n");
}

export function formatGoalDetail(g: Goal, goalOwnerName: string): string {
  const lines: string[] = [];
  lines.push(`GOAL id=${g.id}: ${g.description}`);
  const mt = g.measurableTarget.trim();
  if (mt) lines.push(`Measurable target: ${mt}`);
  const wim = g.whyItMatters.trim();
  if (wim) lines.push(`Why it matters: ${wim}`);
  const cv = g.currentValue.trim();
  if (cv) lines.push(`Current state: ${cv}`);
  lines.push(`Priority: ${g.priority}`);
  lines.push(`Status: ${g.status}`);
  if (goalOwnerName) lines.push(`Goal owner: ${goalOwnerName}`);
  return lines.join("\n");
}

function formatProjectLine(p: Project): string {
  return `- PROJECT id=${p.id}: ${p.name} [${p.status}] ${p.description.trim().slice(0, 200)}`;
}

export function buildExistingRoadmapBlock(
  data: TrackerData,
  companyId: string
): string {
  const company = data.companies.find((c) => c.id === companyId);
  if (!company) return "(Company not found.)";

  const lines: string[] = [];
  lines.push("=== EXISTING GOALS AND PROJECTS FOR THIS COMPANY (do not duplicate) ===");
  lines.push(formatCompanyDetail(company));
  lines.push("");

  const goals = data.goals.filter((g) => g.companyId === companyId);
  if (goals.length === 0) {
    lines.push("(No goals yet.)");
    return lines.join("\n");
  }

  for (const g of goals) {
    const ownerName = g.ownerId
      ? (data.people.find((p) => p.id === g.ownerId)?.name ?? "")
      : "";
    lines.push(formatGoalDetail(g, ownerName));
    const projects = data.projects.filter((p) => p.goalId === g.id);
    if (projects.length === 0) {
      lines.push("  (No projects under this goal.)");
    } else {
      for (const p of projects) {
        lines.push(`  ${formatProjectLine(p)}`);
        const ms = data.milestones.filter((m) => m.projectId === p.id);
        if (ms.length > 0) {
          lines.push(
            `    Milestones: ${ms.map((m) => m.name).join("; ")}`
          );
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** People roster so the model can output ownerPersonId / assigneePersonId (matches Team Slack user IDs). */
export function buildPeopleRosterBlock(people: Person[]): string {
  if (people.length === 0) {
    return "=== PEOPLE (roster empty) ===\n(none)";
  }
  const lines: string[] = [
    "=== PEOPLE (Slack transcript lines use user_or_bot=<Slack user id>; match to slackUserId when assigning owners) ===",
  ];
  for (const p of people) {
    const slack = (p.slackHandle ?? "").trim();
    lines.push(
      slack
        ? `- personId="${p.id}" name=${JSON.stringify(p.name)} slackUserId=${slack}`
        : `- personId="${p.id}" name=${JSON.stringify(p.name)} slackUserId=(not set in roster)`
    );
  }
  return lines.join("\n");
}

const GOAL_FIELDS = `
For kind "newGoalWithProjects", "goal" must include:
- description: short outcome-oriented title
- measurableTarget, whyItMatters, currentValue: strings (may be empty)
- impactScore: 1-5 integer
- priority: P0, P1, P2, or P3
- status: one of: In Progress, Not Started, Planning, Blocked, Ongoing, Demand Testing, Evaluating, Idea
- ownerPersonId: string — set to the tracker personId from the PEOPLE section when the message clearly assigns or @mentions an owner; otherwise use an empty string ""
`.trim();

const PROJECT_FIELDS = `
For each project in "projects" (under a new goal) or "project" (under existing goal):
- name, description, definitionOfDone, priority (P0-P3), complexityScore (1-5), type (Engineering, Product, Sales, Strategic, Operations, Hiring, Marketing)
- milestones: array of { "name": string, "targetDate": "YYYY-MM-DD" } with 0-6 items
- assigneePersonId: string — primary assignee personId from PEOPLE when the work is clearly owned or @mentioned; otherwise ""
`.trim();

export function buildSlackScrapeSystemPrompt(
  existingRoadmapBlock: string,
  slackTranscript: string,
  peopleRosterBlock: string
): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are an executive portfolio assistant. You read recent Slack messages for one company and propose NEW tracker items that are not already captured in the roadmap.

Today's date is ${today}.

RULES:
- Only propose goals and projects that are clearly implied by the Slack messages and are NOT already represented in the existing roadmap below. Deduplicate aggressively.
- If nothing new should be added, return an empty JSON array [].
- Every suggestion MUST include "evidence": at least one object with "channel" (channel name), "ts" (Slack message ts from the transcript line), and "quote" (short verbatim excerpt).
- Use kind "newGoalWithProjects" when the work fits a new strategic goal for the company; you may attach multiple proposed projects under that goal.
- Use kind "newProjectOnExistingGoal" when the work clearly belongs under an EXISTING goal; set "existingGoalId" to the goal id from the roadmap section (the id=... value).
- Prefer "newProjectOnExistingGoal" when a matching goal already exists.
- Do not propose edits to existing rows; only new goals and new projects.
- Top-level Slack messages only were provided; do not assume thread context you cannot see.
- When someone is clearly responsible (@mention, "X will own", assigned in text), set ownerPersonId on new goals and assigneePersonId on each project using personId values from the PEOPLE section. Match transcript user_or_bot ids to slackUserId.

${peopleRosterBlock}

${GOAL_FIELDS}

${PROJECT_FIELDS}

OUTPUT FORMAT:
Return ONLY a JSON array (no markdown fences, no commentary). Each element is one object with a "kind" field:

1) { "kind": "newGoalWithProjects", "goal": { ... }, "projects": [ ... ], "evidence": [ ... ] }
2) { "kind": "newProjectOnExistingGoal", "existingGoalId": "<id>", "project": { ... }, "evidence": [ ... ] }

=== EXISTING ROADMAP ===
${existingRoadmapBlock}

=== SLACK TRANSCRIPT (channel lines prefixed) ===
${slackTranscript}`;
}

export function capTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}
