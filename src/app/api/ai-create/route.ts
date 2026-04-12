import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import { getRepository } from "@/server/repository";

const GOAL_FIELDS_DESCRIPTION = `
Goal fields you must populate:
- description: The goal name/title. Short, outcome-oriented. e.g. "Reduce churn to <3% monthly"
- priority: One of P0, P1, P2, P3 (P0 = highest)
- measurableTarget: A concise description of the measurable outcome or success criteria
- whyItMatters: Why achieving this goal matters — business impact, strategic value
- currentValue: Where things stand right now relative to the goal
`.trim();

const PROJECT_FIELDS_DESCRIPTION = `
Project fields you must populate:
- name: The project name. Short, action-oriented. e.g. "Onboarding flow redesign"
- priority: One of P0, P1, P2, P3 (P0 = highest)
- description: What this project delivers — scope and outcome in 1-2 sentences
- definitionOfDone: Concrete criteria to know the project is complete
- complexityScore: 1-5 integer (1 = trivial, 5 = very complex)
`.trim();

function buildSystemPrompt(
  type: "goal" | "project",
  trackerJson: string,
  entityName: string,
) {
  const fieldsBlock =
    type === "goal" ? GOAL_FIELDS_DESCRIPTION : PROJECT_FIELDS_DESCRIPTION;
  const parentLabel = type === "goal" ? "company" : "goal";

  return `You are a concise executive writing assistant that helps create ${type}s for a portfolio tracker.

CONTEXT: The user is adding a new ${type} under the ${parentLabel} "${entityName}".

STYLE RULES — study the existing tracker data below and match its tone exactly:
- Concise, actionable, readable. No filler, no buzzwords, no marketing language.
- Use the same sentence structure, abbreviation style, and level of specificity you see in existing goals and projects.
- The more data exists, the more precisely you should mirror its conventions.

CONVERSATION RULES:
- Ask exactly 2-3 short questions, ONE at a time. Each question should be 1-2 sentences max.
- Your first question should ask what the user is trying to achieve.
- Each follow-up should build on prior answers and fill in remaining gaps.
- After you have enough information (2-3 exchanges), output your final proposal.

FINAL OUTPUT RULES:
- When ready, write a short sentence like "Here's what I've got:" followed by a fenced JSON block.
- The JSON block MUST be valid JSON wrapped in \`\`\`json ... \`\`\` fences.
- ${fieldsBlock}
- Do NOT include any fields beyond those listed above.
- Do NOT include id, status, dates, or other metadata — those are set automatically.

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

  const systemPrompt = buildSystemPrompt(
    type,
    JSON.stringify(data),
    entityName,
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
