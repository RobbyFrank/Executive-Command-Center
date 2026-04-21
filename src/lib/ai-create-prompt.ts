import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import type { Company, Goal, TrackerData } from "@/lib/types/tracker";
import { getRepository } from "@/server/repository";
import { redactTrackerForAi } from "@/lib/tracker-redact";

function formatCompanyDetail(c: Company): string {
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

function formatGoalDetail(g: Goal, goalOwnerName: string): string {
  const lines: string[] = [];
  lines.push(`GOAL: ${g.description}`);
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

export function buildParentContextBlock(
  type: "goal" | "project",
  data: TrackerData,
  companyId: string | undefined,
  goalId: string | undefined,
): string {
  if (type === "goal") {
    if (!companyId) return "(No company id was provided.)";
    const company = data.companies.find((c) => c.id === companyId);
    if (!company) return "(Company not found in tracker data.)";
    return formatCompanyDetail(company);
  }

  if (!goalId) return "(No goal id was provided.)";
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) return "(Goal not found in tracker data.)";

  const company = data.companies.find((c) => c.id === goal.companyId);
  const goalOwnerName = goal.ownerId
    ? (data.people.find((p) => p.id === goal.ownerId)?.name ?? "")
    : "";

  const companyBlock = company
    ? formatCompanyDetail(company)
    : "(Parent company record not found.)";
  const goalBlock = formatGoalDetail(goal, goalOwnerName);
  return `${companyBlock}\n\n${goalBlock}`;
}

/** Shared with `POST /api/ai-update` for goal revisions — same JSON shape as create. */
export const GOAL_AI_PROPOSAL_FIELDS_BLOCK = `
Goal fields you must populate:
- description: The goal name/title. Short, outcome-oriented. e.g. "Reduce churn to <3% monthly"
- priority: One of P0, P1, P2, P3 (P0 = highest)
- measurableTarget: A concise description of the measurable outcome or success criteria
- whyItMatters: Why achieving this goal matters (business impact, strategic value)
- currentValue: Where things stand right now relative to the goal
`.trim();

const GOAL_FIELDS_DESCRIPTION = GOAL_AI_PROPOSAL_FIELDS_BLOCK;

/** Shared with `POST /api/ai-update` for project revisions — same JSON shape as create. */
export const PROJECT_AI_PROPOSAL_FIELDS_BLOCK = `
Project fields you must populate:
- name: The project name. Short, action-oriented. e.g. "Onboarding flow redesign"
- priority: One of P0, P1, P2, P3 (P0 = highest)
- description: What this project delivers (scope and outcome in 1-2 sentences)
- definitionOfDone: Concrete criteria to know the project is complete
- complexityScore: 1-5 integer (1 = trivial, 5 = very complex)
- milestones: An array of 3-6 milestones that break the project into concrete, sequential deliverables. Each milestone is an object with:
  - name: Short deliverable name, e.g. "API endpoints implemented"
  - targetDate: ISO date string (YYYY-MM-DD). Space milestones realistically from today, accounting for the project complexity.
`.trim();

const PROJECT_FIELDS_DESCRIPTION = PROJECT_AI_PROPOSAL_FIELDS_BLOCK;

export type AutoMode = "none" | "ideas" | "expand";

export function buildSystemPrompt(
  type: "goal" | "project",
  trackerJson: string,
  entityName: string,
  parentContextBlock: string,
  autoMode: AutoMode,
) {
  const fieldsBlock =
    type === "goal" ? GOAL_FIELDS_DESCRIPTION : PROJECT_FIELDS_DESCRIPTION;
  const parentLabel = type === "goal" ? "company" : "goal";
  const primarySubjectHint =
    type === "goal"
      ? "Align the new goal with this company's strategy and context. The same fields may appear again in the full JSON below."
      : "Align the new project with this company and parent goal. The same fields may appear again in the full JSON below.";

  let interactionRules: string;
  if (autoMode === "expand") {
    interactionRules = `EXPAND MODE (skip all questions, produce the full proposal):
The user previously saw a shortlist of ideas and has now picked one. Their latest message tells you which idea they chose.
Do NOT ask any questions. Do NOT offer alternatives. Do NOT repeat the shortlist.
Expand the chosen idea into a full ${type} proposal, inferring any missing details from PRIMARY SUBJECT and EXISTING TRACKER DATA.
Your whole response is: one short lead-in sentence (e.g. "Here's what I've got:") + the fenced JSON block from FINAL OUTPUT RULES. Nothing else.`;
  } else if (autoMode === "ideas") {
    interactionRules = `IDEAS MODE (skip all questions, brainstorm a shortlist):
The user has asked you to "think for them" and suggest a shortlist of rough ${type} ideas they can pick from.
Do NOT ask any questions. Do NOT produce a full proposal yet.
Silently reason about the biggest unmet opportunities and risks for this ${parentLabel},
using PRIMARY SUBJECT and the EXISTING TRACKER DATA (revenue, launch stage, existing goals${
      type === "project" ? "/projects" : ""
    }, status, known gaps, recent progress).

Output 5-8 distinct rough directions. Cover a mix of angles. Each idea should plausibly be the best one, so do not pad with filler.

FINAL OUTPUT (ideas only):
Write one short lead-in sentence like "Here are a few directions, pick whichever fits best:" followed by a single fenced JSON block of this exact shape:

\`\`\`json
{
  "ideas": [
    {
      "title": "Short ${type} title, 3-8 words",
      "category": "growth",
      "rationale": "One sentence on why this matters now, 12-25 words."
    }
    // …5-8 total
  ]
}
\`\`\`

Category rules: pick exactly ONE from this fixed set and use the lowercase slug:
  - "growth"      (new users, acquisition, top-of-funnel, marketing, partnerships)
  - "revenue"     (monetization, pricing, upsell, expansion, sales motion)
  - "retention"   (churn, reactivation, loyalty, engagement depth)
  - "product"     (new features, UX, activation, onboarding)
  - "quality"     (reliability, bugs, tech debt, performance)
  - "ops"         (internal tooling, process, hiring, cost control, automation)
  - "strategy"    (strategic bets, positioning, new markets, pivots)
  - "risk"        (de-risking, compliance, security, continuity)
  - "experiment"  (a scoped test to learn, not yet committed to shipping)
If no category fits cleanly, use "product". Do not invent new categories.
Try to cover a range of categories across the shortlist, not just one.

Title rules: outcome-oriented${
      type === "goal"
        ? ' (e.g. "Cut support response time in half")'
        : ' (e.g. "Ship weekly changelog automation")'
    }. No priorities, no dates, no metrics in the title.
Rationale rules: one sentence, specific to this ${parentLabel}, no buzzwords. Never use em dashes.
Do NOT output any other field names. Do NOT include the full proposal schema in this response (that comes later when the user picks one).`;
  } else {
    interactionRules = `CONVERSATION RULES:
Ask 2-3 questions, one at a time. Each question is ONE casual sentence, 8-15 words.
Sound like a busy colleague in Slack, not an analyst writing a brief.

How to be specific WITHOUT being verbose: mention the company or goal name naturally,
then ask one open-ended thing. Do NOT recite numbers, metrics, priorities, or dates
from PRIMARY SUBJECT. Do NOT offer multiple-choice lists ("X, Y, Z, or something else?").
Use PRIMARY SUBJECT silently to shape the final JSON, not to show off context in questions.

GOOD first-question examples (goal):
  "What part of {company} are you trying to move the needle on?"
  "What's the outcome you want for {company} here?"
GOOD first-question examples (project):
  "What should this project deliver for the {goal title} goal?"
  "What does done look like for this one?"
BAD (too generic): "What's the goal about?"
BAD (stat dump): "With 21% churn and $10M exit target, what area are you focused on?"
BAD (laundry list): "Is this about retention, growth, ops, or something else?"

Follow-ups: same brevity. Ask only what you still need from prior answers.
After 2-3 exchanges, output your final proposal.`;
  }

  return `You are a concise executive writing assistant that helps create ${type}s for a portfolio tracker.

CONTEXT: The user is adding a new ${type} under the ${parentLabel} "${entityName}".
Today's date is ${new Date().toISOString().slice(0, 10)}.

PRIMARY SUBJECT (read first, weight heavily):
${parentContextBlock}

${primarySubjectHint}

STYLE RULES: study the existing tracker data below and match its tone exactly.
Concise, actionable, readable. No filler, no buzzwords, no marketing language.
Use the same sentence structure, abbreviation style, and level of specificity you see in existing goals and projects.
Never use em dashes. Use commas, periods, or parentheses instead.

${interactionRules}

REVISION RULES (after a proposal exists):
If your previous assistant message already included a fenced JSON proposal and the user sends new feedback, treat it as a revision request.
Do not restart the interview or re-ask questions you already answered unless their feedback is ambiguous or impossible to apply.
Prefer a brief acknowledgment (optional), then output an updated proposal using the same FINAL OUTPUT RULES (lead-in + \`\`\`json ... \`\`\`).
Implement their requested changes faithfully (tone, priority, milestones, wording, dates, scope).

FINAL OUTPUT RULES:
When ready, write a short sentence like "Here's what I've got:" followed by a fenced JSON block.
The JSON block MUST be valid JSON wrapped in \`\`\`json ... \`\`\` fences.
${fieldsBlock}
Do NOT include any fields beyond those listed above.
Do NOT include id, status, or other metadata (those are set automatically). Exception: milestone targetDate is required.

EXISTING TRACKER DATA (use this to match writing style and understand context):
${trackerJson}`;
}

export function resolveAiCreateEntityName(
  type: "goal" | "project",
  data: TrackerData,
  companyId: string | undefined,
  goalId: string | undefined,
): string {
  let entityName = "Unknown";
  if (type === "goal" && companyId) {
    const company = data.companies.find((c) => c.id === companyId);
    entityName = company?.name ?? "Unknown company";
  } else if (type === "project" && goalId) {
    const goal = data.goals.find((g) => g.id === goalId);
    if (goal) {
      const company = data.companies.find((c) => c.id === goal.companyId);
      entityName = `${goal.description}` + (company ? ` (${company.name})` : "");
    }
  }
  return entityName;
}

export function buildIdeasBrainstormUserMessage(type: "goal" | "project"): string {
  return `Think for me. Based on the PRIMARY SUBJECT and existing tracker data, give me 5-8 rough directions for a new ${type}. Follow IDEAS MODE exactly: a short lead-in + the \`\`\`json\n{ "ideas": [...] }\n\`\`\` block. No full proposal yet.`;
}

/**
 * Non-streaming completion for the initial "ideas" brainstorm (used by cache + fallback).
 */
export async function completeInitialIdeasShortlistText(
  type: "goal" | "project",
  companyId: string | undefined,
  goalId: string | undefined,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const repo = getRepository();
  const data = redactTrackerForAi(await repo.load());
  const entityName = resolveAiCreateEntityName(type, data, companyId, goalId);
  const parentContextBlock = buildParentContextBlock(
    type,
    data,
    companyId,
    goalId,
  );
  const systemPrompt = buildSystemPrompt(
    type,
    JSON.stringify(data),
    entityName,
    parentContextBlock,
    "ideas",
  );

  const anthropic = new Anthropic({ apiKey });
  const res = await anthropic.messages.create({
    model: getAnthropicModel(),
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: "user", content: buildIdeasBrainstormUserMessage(type) },
    ],
  });
  const block = res.content[0];
  if (block?.type !== "text") {
    throw new Error("Unexpected response from the AI model.");
  }
  return block.text;
}
