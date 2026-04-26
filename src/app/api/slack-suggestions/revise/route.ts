import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { buildExistingRoadmapBlock } from "@/lib/slackScrapePrompt";
import { getRepository } from "@/server/repository";
import { readSlackSuggestions } from "@/server/repository/slack-suggestions-storage";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import { getSession } from "@/server/auth";
import type { SlackScrapeSuggestion } from "@/lib/schemas/tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildReviseSystemPrompt(args: {
  companyName: string;
  roadmapBlock: string;
  trackerJson: string;
  payloadJson: string;
  evidenceLines: string;
  kind: SlackScrapeSuggestion["kind"];
}): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are an executive portfolio assistant. The operator is revising a **pending Slack-derived roadmap suggestion** before approving it.

Today's date is ${today}.

COMPANY: ${args.companyName}

The suggestion kind MUST stay exactly: "${args.kind}". Do not change the "kind" field.

CURRENT SUGGESTION (JSON — revise fields as requested; keep evidence accurate and at least one evidence item):
${args.payloadJson}

SLACK EVIDENCE (verbatim quotes the suggestion is based on — preserve or tighten; do not invent quotes):
${args.evidenceLines}

EXISTING ROADMAP FOR THIS COMPANY (avoid duplicates; align tone):
${args.roadmapBlock}

FULL TRACKER (redacted, for style and cross-references):
${args.trackerJson}

TASK:
- Apply the user's revision request to the suggestion JSON only.
- Output a short lead-in sentence, then a single fenced JSON block: \`\`\`json ... \`\`\`
- The JSON must be one valid SlackScrapeSuggestion object with the SAME "kind" as above, matching the schema the scraper uses (same keys as CURRENT SUGGESTION).
- For edit kinds, "rationale" must remain a non-empty string.
- Keep "evidence" as an array with at least one item; each item needs channel, ts, and quote.

Do not ask clarifying questions unless the request is impossible — then one short question only.`;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

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
    suggestionId?: unknown;
    message?: unknown;
    history?: unknown;
  };

  const suggestionId =
    typeof raw.suggestionId === "string" ? raw.suggestionId.trim() : "";
  if (!suggestionId) {
    return Response.json({ error: "suggestionId is required" }, { status: 400 });
  }

  const message = typeof raw.message === "string" ? raw.message.trim() : "";
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

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const doc = await readSlackSuggestions();
  const rec = doc.items.find((i) => i.id === suggestionId);
  if (!rec || rec.status !== "pending") {
    return Response.json(
      { error: "Suggestion not found or not pending" },
      { status: 404 }
    );
  }

  const repo = getRepository();
  const data = redactTrackerForAi(await repo.load());
  const company = data.companies.find((c) => c.id === rec.companyId);
  const companyName = company?.name ?? rec.companyId;

  const roadmapBlock = buildExistingRoadmapBlock(data, rec.companyId);
  const payloadJson = JSON.stringify(rec.payload, null, 2);
  const evidenceLines = rec.payload.evidence
    .map(
      (e, i) =>
        `${i + 1}. #${e.channel} ts=${e.ts}\n   ${e.quote}`
    )
    .join("\n\n");

  const systemPrompt = buildReviseSystemPrompt({
    companyName,
    roadmapBlock,
    trackerJson: JSON.stringify(data),
    payloadJson,
    evidenceLines,
    kind: rec.payload.kind,
  });

  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: message },
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
