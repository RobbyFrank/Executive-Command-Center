import { randomUUID } from "node:crypto";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { logSlackRoadmapSync } from "@/lib/slackRoadmapSyncLog";
import type {
  SlackScanAllStage,
  SlackScanAllStreamPayload,
} from "@/lib/slack-scrape-stream-types";
import { runSlackSyncPipelineForCompany } from "@/server/actions/slackRoadmapSync/pipeline";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Long-running: many Slack pages + Anthropic calls per company. */
export const maxDuration = 800;

/**
 * Streams NDJSON progress while running the same Slack roadmap pipeline as the daily cron
 * (`runSlackSyncPipelineForCompany`) for **every** company sequentially — or, when an optional
 * `companyIds` filter is sent, only those companies (in roster order). Surfaced from the global
 * review queue so users can refresh suggestions on demand without triggering the cron.
 *
 * Auth: session cookie. Rate-limited like other AI-backed flows.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return aiRateLimitExceededResponse(rate.retryAfterSeconds);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }
  const filterIds = (() => {
    const raw = (body as { companyIds?: unknown }).companyIds;
    if (!Array.isArray(raw)) return null;
    const ids = raw
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  })();

  const data = await getRepository().load();
  const companies = data.companies
    .filter((c) => (filterIds ? filterIds.has(c.id) : true))
    .map((c) => ({ id: c.id, name: c.name }));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (p: SlackScanAllStreamPayload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(p)}\n`));
      };

      const results: Array<{
        companyId: string;
        companyName: string;
        ok: boolean;
        pendingCount?: number;
        error?: string;
      }> = [];
      let okCount = 0;
      let failCount = 0;

      let currentStage: SlackScanAllStage = "starting";
      let channelTotal = 0;
      let channelDone = 0;
      let channelFailed = 0;
      let channelCurrent: string | undefined;

      const emit = (i: number, current: typeof companies[number] | null) => {
        write({
          type: "progress",
          phase: "company",
          total: companies.length,
          completed: i,
          currentCompanyId: current?.id,
          currentCompanyName: current?.name,
          currentStage: current ? currentStage : undefined,
          channels: current
            ? {
                total: channelTotal,
                done: channelDone,
                failed: channelFailed,
                current: channelCurrent,
              }
            : undefined,
          okCount,
          failCount,
          results,
        });
      };

      const batchId = randomUUID();
      try {
        logSlackRoadmapSync("info", {
          event: "api_sync_all_start",
          logTrigger: "api-sync-all",
          batchId,
          companyCount: companies.length,
          /** True when the request body included a `companyIds` array filter. */
          companyFilterApplied: filterIds != null,
        });
        for (let i = 0; i < companies.length; i += 1) {
          if (req.signal.aborted) break;
          const c = companies[i]!;
          currentStage = "starting";
          channelTotal = 0;
          channelDone = 0;
          channelFailed = 0;
          channelCurrent = undefined;
          emit(i, c);

          const r = await runSlackSyncPipelineForCompany(c.id, {
            days: 2,
            includeThreads: true,
            signal: req.signal,
            correlationId: randomUUID(),
            logTrigger: "api-sync-all",
            batchId,
            onStage: (s) => {
              currentStage = s;
              emit(i, c);
            },
            onChannelTotal: (n) => {
              channelTotal = n;
              emit(i, c);
            },
            onChannelStart: (info) => {
              channelCurrent = info.name;
              emit(i, c);
            },
            onChannelDone: (info) => {
              channelCurrent = undefined;
              if (info.ok) channelDone += 1;
              else channelFailed += 1;
              emit(i, c);
            },
          });

          if (r.ok) {
            okCount += 1;
            results.push({
              companyId: c.id,
              companyName: c.name,
              ok: true,
              pendingCount: r.pending.length,
            });
          } else {
            failCount += 1;
            results.push({
              companyId: c.id,
              companyName: c.name,
              ok: false,
              error: r.error,
            });
          }

          emit(i + 1, null);
        }

        logSlackRoadmapSync("info", {
          event: "api_sync_all_done",
          logTrigger: "api-sync-all",
          batchId,
          companyCount: companies.length,
          okCount,
          failCount,
        });
        write({
          type: "done",
          total: companies.length,
          okCount,
          failCount,
          results,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? e.stack : undefined;
        logSlackRoadmapSync("error", {
          event: "api_sync_all_fatal",
          logTrigger: "api-sync-all",
          batchId,
          error: message,
          stack,
        });
        write({
          type: "error",
          message,
        });
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
