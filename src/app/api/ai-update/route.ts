import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import type { Milestone, TrackerData } from "@/lib/types/tracker";
import { getRepository } from "@/server/repository";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";

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
The JSON object MUST contain exactly these keys (string values, may be empty):
- measurableTarget: The measurable outcome / "Description" field in the UI
- whyItMatters: Why this goal matters
- currentValue: Current state vs the target
`.trim();

const PROJECT_UPDATE_JSON_FIELDS = `
The JSON object MUST contain exactly these keys (string values, may be empty):
- description: What the project delivers
- definitionOfDone: Done when / completion criteria
`.trim();

function buildUpdateSystemPrompt(
  type: "goal" | "project",
  trackerJson: string,
  entityContextBlock: string,
  currentFieldsJson: string,
): string {
  const fieldsBlock =
    type === "goal" ? GOAL_UPDATE_JSON_FIELDS : PROJECT_UPDATE_JSON_FIELDS;

  return `You are a concise executive writing assistant that helps UPDATE existing ${type} text fields in a portfolio tracker.

Today's date is ${new Date().toISOString().slice(0, 10)}.

${entityContextBlock}

CURRENT FIELD VALUES (these are what the user may want to revise — preserve meaning unless the conversation calls for change):
${currentFieldsJson}

TASK:
- Ask 2-3 short, smart questions ONE at a time to understand what changed (progress, strategy shift, blockers, new facts from milestones/projects).
- Each question should be 1-2 sentences max.
- Use the hierarchy context above (projects, milestones, company/goal) to ask specific questions when helpful.
- After enough information (2-3 user replies after your first question), output your final proposal.

STYLE RULES — match the tone of existing goals/projects in the tracker data below:
- Concise, actionable, readable. No filler or marketing language.

FINAL OUTPUT RULES:
- When ready, write a short sentence like "Here's the updated copy:" followed by a fenced JSON block.
- The JSON block MUST be valid JSON wrapped in \`\`\`json ... \`\`\` fences.
- ${fieldsBlock}
- Include ALL keys every time. For fields that should stay unchanged, repeat the current text verbatim from CURRENT FIELD VALUES.
- Do NOT include any other keys (no id, priority, milestones, etc.).

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

  const systemPrompt = buildUpdateSystemPrompt(
    type,
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
    messages.push({
      role: "user",
      content:
        "I want to update these fields with your help. Ask me your first question.",
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
