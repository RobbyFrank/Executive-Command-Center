import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  buildMilestoneThreadContextBlock,
  buildMilestoneThreadReviseUserPayload,
  MILESTONE_THREAD_REVISE_SYSTEM_PROMPT,
} from "@/server/slackMilestoneThreadDraftContext";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let milestoneId = "";
  let currentDraft = "";
  let feedback = "";
  try {
    const body = (await req.json()) as {
      milestoneId?: unknown;
      currentDraft?: unknown;
      feedback?: unknown;
    };
    milestoneId =
      typeof body?.milestoneId === "string" ? body.milestoneId : "";
    currentDraft =
      typeof body?.currentDraft === "string" ? body.currentDraft : "";
    feedback = typeof body?.feedback === "string" ? body.feedback : "";
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = milestoneId.trim();
  if (!id) {
    return Response.json({ error: "Missing milestoneId." }, { status: 400 });
  }
  const fb = feedback.trim();
  if (!fb) {
    return Response.json({ error: "Feedback is empty." }, { status: 400 });
  }

  const ctx = await buildMilestoneThreadContextBlock(id);
  if (!ctx.ok) {
    return Response.json({ error: ctx.error }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set." },
      { status: 500 }
    );
  }

  const userPayload = buildMilestoneThreadReviseUserPayload(
    ctx.userBlock,
    currentDraft,
    fb
  );

  const anthropic = new Anthropic({ apiKey });
  const stream = anthropic.messages.stream({
    model: getAnthropicModel(),
    max_tokens: 1024,
    system: MILESTONE_THREAD_REVISE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPayload }],
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
