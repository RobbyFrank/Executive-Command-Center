import {
  RECOMMENDER_SYSTEM,
  loadPilotRecommendationContext,
  finalizePilotRecommendationFromRawText,
  firstPilotProjectIdForBuddies,
} from "@/server/actions/onboarding/recommendPilotProject";
import { recommendOnboardingBuddies } from "@/server/actions/onboarding/recommendBuddies";
import { claudePlainTextStream } from "@/server/actions/slack/thread-ai-shared";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { getSession } from "@/server/auth";
import {
  ONBOARDING_RECOMMEND_STATUS_PREFIX,
  ONBOARDING_RECOMMEND_STREAM_DONE,
} from "@/lib/onboarding-recommend-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return aiRateLimitExceededResponse(rate.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const b = (body ?? {}) as {
    personId?: unknown;
    founderContext?: unknown;
  };
  const personId = typeof b.personId === "string" ? b.personId.trim() : "";
  const founderContext =
    typeof b.founderContext === "string" ? b.founderContext : undefined;

  if (!personId) {
    return new Response(JSON.stringify({ error: "personId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      /** Writes a status line that the client shows before Claude starts streaming. */
      function sendStatus(text: string) {
        controller.enqueue(
          encoder.encode(`${ONBOARDING_RECOMMEND_STATUS_PREFIX}${text}\n`)
        );
      }

      function sendFooter(payload: unknown) {
        controller.enqueue(
          encoder.encode(
            `${ONBOARDING_RECOMMEND_STREAM_DONE}${JSON.stringify(payload)}`
          )
        );
      }

      try {
        const loaded = await loadPilotRecommendationContext(personId, {
          onProgress: sendStatus,
          founderContext,
        });
        if (!loaded.ok) {
          sendFooter({ ok: false, error: loaded.error });
          controller.close();
          return;
        }

        sendStatus("Asking Claude for pilot-project suggestions…");

        let full = "";
        for await (const chunk of claudePlainTextStream(
          RECOMMENDER_SYSTEM,
          loaded.ctx.userBlock,
          { maxTokens: 2048 }
        )) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        const fin = finalizePilotRecommendationFromRawText(loaded.ctx, full);
        if (!fin.ok) {
          sendFooter({ ok: false, error: fin.error });
          controller.close();
          return;
        }

        sendStatus("Suggesting onboarding partners (second AI call)…");
        const buddyResult = await recommendOnboardingBuddies({
          personId,
          pilotProjectId:
            firstPilotProjectIdForBuddies(fin.recommendation) ?? undefined,
          founderContext,
        });

        sendFooter({
          ok: true,
          recommendation: fin.recommendation,
          buddies: buddyResult.ok ? buddyResult.recommendation : null,
          buddiesError: buddyResult.ok ? undefined : buddyResult.error,
        });
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          sendFooter({ ok: false, error: msg });
        } catch {
          /* stream may be closed */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      /** Prevent intermediaries from buffering until EOF (nginx, Vercel edge). */
      "X-Accel-Buffering": "no",
    },
  });
}
