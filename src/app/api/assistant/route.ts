import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import { buildEntityFocusBlock } from "@/lib/assistantEntityFocus";
import {
  mentionKey,
  parseEccMentionsFromText,
} from "@/lib/assistantMentions";
import { isFounderPerson } from "@/lib/autonomyRoster";
import { getRepository } from "@/server/repository";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 }
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
    question?: unknown;
    history?: unknown;
    entityContext?: unknown;
  };

  const question =
    typeof raw.question === "string" ? raw.question.trim() : "";
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

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

  const seen = new Set<string>();
  const focusChunks: string[] = [];

  const ec = raw.entityContext;
  if (
    ec &&
    typeof ec === "object" &&
    ec !== null &&
    typeof (ec as { type?: unknown }).type === "string" &&
    typeof (ec as { id?: unknown }).id === "string" &&
    typeof (ec as { label?: unknown }).label === "string"
  ) {
    const type = (ec as { type: string }).type;
    if (
      type === "company" ||
      type === "goal" ||
      type === "project" ||
      type === "milestone"
    ) {
      const id = (ec as { id: string }).id;
      const label = (ec as { label: string }).label;
      seen.add(mentionKey(type, id));
      focusChunks.push(
        `The user opened the assistant with this roadmap item pre-selected (prioritize when relevant; full workspace JSON is still authoritative):

${buildEntityFocusBlock(data, { type: type as "company" | "goal" | "project" | "milestone", id, label })}`,
      );
    }
  }

  const inline = parseEccMentionsFromText(question);
  for (const m of inline) {
    const k = mentionKey(m.type, m.id);
    if (seen.has(k)) continue;
    seen.add(k);
    focusChunks.push(
      `The user @-tagged this item in their message:

${buildEntityFocusBlock(data, {
        type: m.type,
        id: m.id,
        label: m.label,
      })}`,
    );
  }

  let entityBlock = "";
  if (focusChunks.length > 0) {
    entityBlock = `${focusChunks.join("\n\n---\n\n")}

---

`;
  }

  const founders = data.people.filter((p) => isFounderPerson(p));
  const teamMembersOnly = data.people.filter((p) => !isFounderPerson(p));
  const rosterSemantics = `Roster semantics (follow strictly):
- Founders are NOT "team members." People marked isFounder, or legacy founder ids when isFounder is omitted (robby, nadav), are founders unless isFounder is explicitly false.
- Current founders in data: ${founders.length ? founders.map((p) => p.name).join(", ") : "(none listed)"}.
- Team members (non-founders only): ${teamMembersOnly.length ? teamMembersOnly.map((p) => p.name).join(", ") : "(none)"}.
- When the user asks about team members, headcount, rankings, or "top" people on the team, include ONLY team members (non-founders). You may mention founders separately if relevant (e.g. leadership), but do not list founders inside a "team members" answer unless the user explicitly asks for founders or the full people list.
- When naming people, write their names as plain text (do not wrap names in markdown links or URLs) so the client can show profile photos next to names.`;

  const systemPrompt = `${entityBlock}You are an executive analyst assistant for the MLabs portfolio strategic tracker. Answer questions using ONLY the JSON data below. Be concise, direct, and actionable. If something is not in the data, say you do not have that information.

Hierarchy: Company → Goal → Project → Milestone. People can own goals/projects and appear on the team roster.

${rosterSemantics}

Tracker data (companies, goals, projects, milestones, people):
${JSON.stringify(data)}`;

  const anthropic = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: question },
  ];

  const stream = anthropic.messages.stream({
    model: getAnthropicModel(),
    max_tokens: 8192,
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
