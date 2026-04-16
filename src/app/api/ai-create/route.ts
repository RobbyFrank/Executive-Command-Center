import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import type { Company, Goal, TrackerData } from "@/lib/types/tracker";
import { getRepository } from "@/server/repository";

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

function buildParentContextBlock(
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

const GOAL_FIELDS_DESCRIPTION = `
Goal fields you must populate:
- description: The goal name/title. Short, outcome-oriented. e.g. "Reduce churn to <3% monthly"
- priority: One of P0, P1, P2, P3 (P0 = highest)
- measurableTarget: A concise description of the measurable outcome or success criteria
- whyItMatters: Why achieving this goal matters (business impact, strategic value)
- currentValue: Where things stand right now relative to the goal
`.trim();

const PROJECT_FIELDS_DESCRIPTION = `
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

function buildSystemPrompt(
  type: "goal" | "project",
  trackerJson: string,
  entityName: string,
  parentContextBlock: string,
) {
  const fieldsBlock =
    type === "goal" ? GOAL_FIELDS_DESCRIPTION : PROJECT_FIELDS_DESCRIPTION;
  const parentLabel = type === "goal" ? "company" : "goal";
  const primarySubjectHint =
    type === "goal"
      ? "Align the new goal with this company's strategy and context. The same fields may appear again in the full JSON below."
      : "Align the new project with this company and parent goal. The same fields may appear again in the full JSON below.";

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

CONVERSATION RULES:
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
After 2-3 exchanges, output your final proposal.

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

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const raw = body as {
    type?: unknown;
    companyId?: unknown;
    goalId?: unknown;
    message?: unknown;
    history?: unknown;
  };

  const type = raw.type === "goal" || raw.type === "project" ? raw.type : null;
  if (!type) {
    return Response.json(
      { error: "type must be 'goal' or 'project'" },
      { status: 400 },
    );
  }

  const message =
    typeof raw.message === "string" ? raw.message.trim() : "";

  const historyRaw = Array.isArray(raw.history) ? raw.history : [];
  const history: Anthropic.MessageParam[] = [];
  for (const item of historyRaw) {
    if (!item || typeof item !== "object") continue;
    const m = item as { role?: unknown; content?: unknown };
    if (
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string"
    ) {
      history.push({ role: m.role, content: m.content });
    }
  }

  const repo = getRepository();
  const data = await repo.load();

  let entityName = "Unknown";
  if (type === "goal" && typeof raw.companyId === "string") {
    const company = data.companies.find((c) => c.id === raw.companyId);
    entityName = company?.name ?? "Unknown company";
  } else if (type === "project" && typeof raw.goalId === "string") {
    const goal = data.goals.find((g) => g.id === raw.goalId);
    if (goal) {
      const company = data.companies.find((c) => c.id === goal.companyId);
      entityName = `${goal.description}` + (company ? ` (${company.name})` : "");
    }
  }

  const parentContextBlock = buildParentContextBlock(
    type,
    data,
    typeof raw.companyId === "string" ? raw.companyId : undefined,
    typeof raw.goalId === "string" ? raw.goalId : undefined,
  );

  const systemPrompt = buildSystemPrompt(
    type,
    JSON.stringify(data),
    entityName,
    parentContextBlock,
  );

  const anthropic = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [...history];
  if (message) {
    messages.push({ role: "user", content: message });
  }

  // On first call (no history, no message), seed with a user message so Claude asks question 1
  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: `I want to add a new ${type}. Ask me your first question.`,
    });
  }

  const stream = anthropic.messages.stream({
    model: getAnthropicModel(),
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        stream.on("text", (textDelta: string) => {
          controller.enqueue(encoder.encode(textDelta));
        });
        await stream.finalText();
        controller.close();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
