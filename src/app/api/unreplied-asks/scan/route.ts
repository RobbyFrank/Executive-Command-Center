import { revalidatePath } from "next/cache";
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
import type { UnrepliedScanProgressEvent } from "@/lib/unrepliedAsksScanTypes";
import { runUnrepliedAsksScan } from "@/server/actions/unrepliedAsks/scan";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Long-running: many Claude calls + Slack pagination. */
export const maxDuration = 300;

/**
 * Streams NDJSON progress events while running the unreplied-asks scan (same work as cron).
 * Auth: session cookie. Rate-limited like other AI-backed flows.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return new Response(
      JSON.stringify({
        error: `Too many AI requests. Try again in ${rate.retryAfterSeconds}s.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rate.retryAfterSeconds),
        },
      }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: UnrepliedScanProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      };

      try {
        const people = await getRepository().getPeople();
        let sawErrorEvent = false;
        const sendTracked = (ev: UnrepliedScanProgressEvent) => {
          if (ev.type === "error") sawErrorEvent = true;
          send(ev);
        };

        const result = await runUnrepliedAsksScan(people, {
          onProgress: sendTracked,
        });

        if (!result.ok && !sawErrorEvent) {
          send({ type: "error", message: result.error });
        } else if (result.ok) {
          revalidatePath("/unreplied");
          revalidatePath("/", "layout");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
