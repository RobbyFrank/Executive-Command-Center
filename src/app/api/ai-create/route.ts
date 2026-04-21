import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  type AutoMode,
  buildIdeasBrainstormUserMessage,
  buildParentContextBlock,
  buildSystemPrompt,
  resolveAiCreateEntityName,
} from "@/lib/ai-create-prompt";
import { getCachedInitialIdeasShortlist } from "@/lib/ai-create-ideas-cache";
import { getRepository } from "@/server/repository";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";

function streamPlainTextResponse(fullText: string): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(fullText));
      controller.close();
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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
    companyId?: unknown;
    goalId?: unknown;
    message?: unknown;
    history?: unknown;
    autoPropose?: unknown;
    autoMode?: unknown;
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
  let autoMode: AutoMode = "none";
  if (raw.autoMode === "ideas" || raw.autoPropose === true) autoMode = "ideas";
  else if (raw.autoMode === "expand") autoMode = "expand";

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

  const companyId =
    typeof raw.companyId === "string" ? raw.companyId : undefined;
  const goalId = typeof raw.goalId === "string" ? raw.goalId : undefined;

  const cacheableInitialIdeas =
    autoMode === "ideas" &&
    message === "" &&
    history.length === 0 &&
    ((type === "goal" && companyId !== undefined) ||
      (type === "project" && goalId !== undefined));

  if (cacheableInitialIdeas) {
    try {
      const fullText = await getCachedInitialIdeasShortlist(
        type,
        companyId,
        goalId,
      );
      return streamPlainTextResponse(fullText);
    } catch (e) {
      console.error("[ai-create] cached ideas brainstorm failed", e);
      return Response.json(
        { error: "AI request failed. Try again in a moment." },
        { status: 502 },
      );
    }
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
    autoMode,
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
        autoMode === "ideas"
          ? buildIdeasBrainstormUserMessage(type)
          : `I want to add a new ${type}. Ask me your first question.`,
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
