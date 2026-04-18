import { runCompanyDescriptionPipeline } from "@/server/companyDescriptionFromWebsites";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return aiRateLimitExceededResponse(rate.retryAfterSeconds);
  }

  const encoder = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        send({ type: "error", message: "Invalid JSON body" });
        controller.close();
        return;
      }

      const url =
        body &&
        typeof body === "object" &&
        body !== null &&
        "url" in body &&
        typeof (body as { url: unknown }).url === "string"
          ? (body as { url: string }).url
          : "";

      try {
        await runCompanyDescriptionPipeline(url, signal, send);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: msg || "Unexpected error" });
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
