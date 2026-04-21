import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import type { Milestone, TrackerData } from "@/lib/types/tracker";
import { getRepository } from "@/server/repository";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import {
  GOAL_AI_PROPOSAL_FIELDS_BLOCK,
  PROJECT_AI_PROPOSAL_FIELDS_BLOCK,
} from "@/lib/ai-create-prompt";

function formatMilestones(ms: Milestone[]): string {
  if (ms.length === 0) return "(No milestones.)";
  return ms
    .map(
      (m) =>
        `  - ${m.name} [${m.status}]${m.targetDate ? ` due ${m.targetDate}` : ""}`,
    )
    .join("\n");
}

function buildGoalUpdateContext(data: TrackerData, goalId: string): string {
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) return "(Goal not found.)";

  const company = data.companies.find((c) => c.id === goal.companyId);
  const ownerName = goal.ownerId
    ? (data.people.find((p) => p.id === goal.ownerId)?.name ?? "")
    : "";

  const projectsUnderGoal = data.projects.filter((p) => p.goalId === goalId);

  const lines: string[] = [];
  lines.push("=== ENTITY BEING UPDATED: GOAL ===");
  lines.push(`Goal title (read-only): ${goal.description}`);
  lines.push(`Priority: ${goal.priority} | Status: ${goal.status}`);
  if (ownerName) lines.push(`Owner: ${ownerName}`);
  if (company) {
    lines.push(`Company: ${company.name} (${company.shortName})`);
  }
  lines.push("");
  lines.push("Projects under this goal (for context — do not edit these via JSON):");
  if (projectsUnderGoal.length === 0) {
    lines.push("  (none)");
  } else {
    for (const p of projectsUnderGoal) {
      const milestones = data.milestones.filter((m) => m.projectId === p.id);
      lines.push(`- Project: ${p.name} [${p.status}]`);
      lines.push(formatMilestones(milestones));
    }
  }
  return lines.join("\n");
}

function buildProjectUpdateContext(
  data: TrackerData,
  projectId: string,
): string {
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return "(Project not found.)";

  const goal = data.goals.find((g) => g.id === project.goalId);
  const company = goal
    ? data.companies.find((c) => c.id === goal.companyId)
    : undefined;

  const milestones = data.milestones.filter((m) => m.projectId === projectId);

  const lines: string[] = [];
  lines.push("=== ENTITY BEING UPDATED: PROJECT ===");
  lines.push(`Project name (read-only): ${project.name}`);
  lines.push(`Priority: ${project.priority} | Status: ${project.status}`);
  if (goal) {
    lines.push(`Parent goal title: ${goal.description}`);
  }
  if (company) {
    lines.push(`Company: ${company.name} (${company.shortName})`);
  }
  lines.push("");
  lines.push("Milestones (for context):");
  lines.push(formatMilestones(milestones));

  return lines.join("\n");
}

const GOAL_UPDATE_JSON_FIELDS = `
The JSON object MUST contain exactly these keys (same shape as "Draft a new goal with AI"):
${GOAL_AI_PROPOSAL_FIELDS_BLOCK}
`.trim();

const PROJECT_UPDATE_JSON_FIELDS = `
The JSON object MUST contain exactly these keys (same shape as "Draft a new project with AI"):
${PROJECT_AI_PROPOSAL_FIELDS_BLOCK}

For REVISING an existing project: include every milestone from CURRENT FIELD VALUES in \`milestones\` unless the user explicitly asks to add, remove, or reorder them. You may have fewer than 3 or more than 6 milestones when that matches reality. Preserve \`targetDate\` values unless the user asks to change dates.
`.trim();

function buildGoalUpdateSystemPrompt(
  trackerJson: string,
  entityContextBlock: string,
  currentFieldsJson: string,
): string {
  return `You are a concise executive writing assistant that helps REVISE existing goal text fields in a portfolio tracker.

Today's date is ${new Date().toISOString().slice(0, 10)}.

${entityContextBlock}

CURRENT FIELD VALUES (baseline when the user opened this dialog — repeat unchanged keys verbatim unless the user asks to change them in this session):
${currentFieldsJson}

TASK — do NOT run an interview. The client loaded the dialog with the goal already shown as-is; every call to you is a REVISION request:
- Treat every user message as revision feedback on the goal in CURRENT FIELD VALUES. Apply the requested change and output an updated proposal (short lead-in sentence + fenced JSON).
- Preserve unchanged fields verbatim from CURRENT FIELD VALUES (description, priority, measurableTarget, whyItMatters, currentValue). Only modify what the user asked to change plus tightly related dependencies.
- Do NOT ask clarifying questions unless the user's request is genuinely impossible to apply — in that case ask ONE short question and stop.
- Do NOT output a proposal that simply echoes CURRENT FIELD VALUES unchanged; the user always asked for something specific.

STYLE RULES — match the tone of existing goals in the tracker data below:
- Concise, actionable, readable. No filler or marketing language.

FINAL OUTPUT RULES:
- Write a short sentence like "Here's the updated copy:" followed by a fenced JSON block.
- The JSON block MUST be valid JSON wrapped in \`\`\`json ... \`\`\` fences.
- ${GOAL_UPDATE_JSON_FIELDS}
- Include ALL keys every time. For fields that should stay unchanged, repeat the current text verbatim from CURRENT FIELD VALUES.
- Do NOT include any other keys (no id, status, milestones, etc.).

FULL TRACKER DATA (for style and cross-references):
${trackerJson}`;
}

function buildProjectUpdateSystemPrompt(
  trackerJson: string,
  entityContextBlock: string,
  currentFieldsJson: string,
): string {
  return `You are a concise executive writing assistant that helps REVISE an existing project in a portfolio tracker — the same JSON proposal workflow as "Draft a new project with AI", but applied to a project that already exists.

Today's date is ${new Date().toISOString().slice(0, 10)}.

${entityContextBlock}

CURRENT FIELD VALUES (baseline when the user opened this dialog — repeat unchanged keys verbatim unless the user asks to change them in this session):
${currentFieldsJson}

TASK — do NOT run an interview. The client loaded the dialog with the project already shown as-is; every call to you is a REVISION request:
- Treat every user message as revision feedback on the project in CURRENT FIELD VALUES. Apply the requested change and output an updated proposal (short lead-in sentence + fenced JSON).
- Preserve unchanged fields verbatim from CURRENT FIELD VALUES (priority, complexity, milestone names and targetDates, description, definitionOfDone, name). Only modify what the user asked to change plus tightly related dependencies.
- Do NOT ask clarifying questions unless the user's request is genuinely impossible to apply — in that case ask ONE short question and stop.
- Do NOT output a proposal that simply echoes CURRENT FIELD VALUES unchanged; the user always asked for something specific.

STYLE RULES — match the tone of existing projects in the tracker data below:
- Concise, actionable, readable. No filler or marketing language.

FINAL OUTPUT RULES:
- The JSON block MUST be valid JSON wrapped in \`\`\`json ... \`\`\` fences.
- ${PROJECT_UPDATE_JSON_FIELDS}
- Do NOT include id, goalId, status, ownerId, or other database fields.

FULL TRACKER DATA (for style and cross-references):
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

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return aiRateLimitExceededResponse(rate.retryAfterSeconds);
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
    goalId?: unknown;
    projectId?: unknown;
    currentFields?: unknown;
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

  if (type === "goal" && typeof raw.goalId !== "string") {
    return Response.json({ error: "goalId is required for goal updates" }, { status: 400 });
  }
  if (type === "project" && typeof raw.projectId !== "string") {
    return Response.json(
      { error: "projectId is required for project updates" },
      { status: 400 },
    );
  }

  const currentFields =
    raw.currentFields && typeof raw.currentFields === "object"
      ? (raw.currentFields as Record<string, unknown>)
      : {};

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
  const data = redactTrackerForAi(await repo.load());

  const entityContextBlock =
    type === "goal"
      ? buildGoalUpdateContext(data, raw.goalId as string)
      : buildProjectUpdateContext(data, raw.projectId as string);

  const currentFieldsJson = JSON.stringify(currentFields, null, 2);

  const systemPrompt =
    type === "goal"
      ? buildGoalUpdateSystemPrompt(
          JSON.stringify(data),
          entityContextBlock,
          currentFieldsJson,
        )
      : buildProjectUpdateSystemPrompt(
          JSON.stringify(data),
          entityContextBlock,
          currentFieldsJson,
        );

  const anthropic = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [...history];
  if (message) {
    messages.push({ role: "user", content: message });
  }

  if (messages.length === 0) {
    // Defense in depth — the client never auto-calls this route anymore, but
    // if somehow it does we return the current values as-is.
    messages.push({
      role: "user",
      content:
        type === "goal"
          ? "Output the goal JSON matching CURRENT FIELD VALUES exactly (no questions, no changes)."
          : "Output the full project proposal JSON matching CURRENT FIELD VALUES exactly (no questions, no changes).",
    });
  }

  const stream = anthropic.messages.stream({
    model: getAnthropicModel(),
    max_tokens: 4096,
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
