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

const EDIT_AND_RATIONALE = `
You may also propose GENTLE updates to EXISTING goals and projects when Slack clearly states a change (rare, high confidence only).

- kind "editGoal": existingGoalId, patch: optional fields { description, measurableTarget, whyItMatters, currentValue, ownerPersonId, slackChannelId }, evidence (min 1), rationale (1 non-empty sentence).
- kind "editProject": existingProjectId, patch: optional { name, description, assigneePersonId, status, priority }. Project status must be one of: Idea, Pending, In Progress, Stuck, For Review, Done (not "Blocked"). evidence, rationale.
- kind "addMilestoneToExistingProject": existingProjectId, milestone: { name, targetDate: "YYYY-MM-DD" }, evidence, rationale.
- kind "editMilestone": existingMilestoneId, patch: { name?: string, targetDate?: string } (at least one field), evidence, rationale.

GENTLE EDIT RULES:
- Edits must be high-confidence. Only when a Slack line clearly states the new value (e.g. owner change, "shipped", "ready for review", "paused", date move).
- Each edit must include a non-empty "rationale" (1 sentence) and "evidence" with a quote showing the new information.
- Never propose an edit that only rephrases the existing value.
- For status, only when Slack explicitly indicates a project status change. For date moves, prefer "editMilestone" over duplicate milestones.
- The transcript may include thread replies (lines starting with "↳"); use that context.
`.trim();

export function buildSlackScrapeSystemPrompt(
  existingRoadmapBlock: string,
  slackTranscript: string,
  peopleRosterBlock: string
): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are an executive portfolio assistant. You read recent Slack (including thread replies) for one company and propose changes to the roadmap: new items and occasional careful updates to existing rows.

Today's date is ${today}.

RULES:
- Propose net-new goals and projects that are not already well represented. Deduplicate aggressively.
- You may also propose the edit kinds above when evidence is clear.
- If nothing is worth adding or changing, return an empty JSON array [].
- Every array element must include a "rationale" string. For "new" kinds it may be "" when obvious; for edit kinds it must be a clear sentence.
- Every suggestion must include "evidence": at least one object with "channel" (channel name), "ts" (from the transcript line), and "quote" (short verbatim excerpt).
- Use "newGoalWithProjects" for a new strategic goal; you may list projects under it.
- Use "newProjectOnExistingGoal" when the work clearly belongs under an EXISTING goal; set "existingGoalId" from the roadmap.
- When someone is clearly responsible, set ownerPersonId / assigneePersonId from the PEOPLE section. Match user_or_bot in transcript lines to slackUserId in PEOPLE.
- In prose for the operator, use priority words Urgent / High / Normal / Low when discussing priority; in JSON use P0, P1, P2, P3 for priority fields.

${peopleRosterBlock}

${GOAL_FIELDS}

${PROJECT_FIELDS}

${EDIT_AND_RATIONALE}

OUTPUT FORMAT:
Return ONLY a JSON array (no markdown fences, no commentary). Each element is one object with a "kind" field:

1) { "kind": "newGoalWithProjects", "goal": { ... }, "projects": [ ... ], "evidence": [ ... ], "rationale": "" }
2) { "kind": "newProjectOnExistingGoal", "existingGoalId": "<id>", "project": { ... }, "evidence": [ ... ], "rationale": "" }
3) { "kind": "editGoal", "existingGoalId", "patch": { ... }, "evidence": [ ... ], "rationale": "..." }
4) { "kind": "editProject", "existingProjectId", "patch": { ... }, "evidence": [ ... ], "rationale": "..." }
5) { "kind": "addMilestoneToExistingProject", "existingProjectId", "milestone": { "name", "targetDate" }, "evidence": [ ... ], "rationale": "..." }
6) { "kind": "editMilestone", "existingMilestoneId", "patch": { "name"?, "targetDate"? }, "evidence": [ ... ], "rationale": "..." }

=== EXISTING ROADMAP ===
${existingRoadmapBlock}

=== SLACK TRANSCRIPT (channel lines prefixed) ===
${slackTranscript}`;
}

export function capTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}
