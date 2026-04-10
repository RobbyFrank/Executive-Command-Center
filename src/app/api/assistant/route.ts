import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import { getRepository } from "@/server/repository";

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 }
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
    question?: unknown;
    history?: unknown;
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
  const data = await repo.load();

  const systemPrompt = `You are an executive analyst assistant for the MLabs portfolio strategic tracker. Answer questions using ONLY the JSON data below. Be concise, direct, and actionable. If something is not in the data, say you do not have that information.

Hierarchy: Company → Goal → Project → Milestone. People can own goals/projects and appear on the team roster.

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
