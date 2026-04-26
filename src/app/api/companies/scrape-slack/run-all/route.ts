import { randomUUID } from "node:crypto";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { logSlackRoadmapSync } from "@/lib/slackRoadmapSyncLog";
import { resolveCompanyScrapeChannels } from "@/lib/scrapeCompanyChannels";
import { fetchSlackChannels } from "@/lib/slack";
import type {
  SlackScanAllPlanCompany,
  SlackScanAllResult,
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

  // Pre-resolve channels for every company so the UI can size the progress bar
  // by total work units (channels to fetch + 1 AI call per company) instead of
  // just `companies.length`. The Slack list call is in-process cached, so each
  // pipeline run reuses this fetch.
  const channelsList = await fetchSlackChannels();
  const planEntries: SlackScanAllPlanCompany[] = companies.map((c) => {
    let channelCount = 0;
    if (channelsList.ok) {
      const company = data.companies.find((x) => x.id === c.id);
      if (company) {
        const goalsForCompany = data.goals.filter(
          (g) => g.companyId === c.id
        );
        channelCount = resolveCompanyScrapeChannels({
          company,
          goalsForCompany,
          allChannels: channelsList.channels,
        }).length;
      }
    }
    return { companyId: c.id, companyName: c.name, channelCount };
  });
  /** Each company contributes `channelCount + 1` units (one AI / finalize step). */
  const planUnitsByCompany = new Map<string, number>(
    planEntries.map((e) => [e.companyId, e.channelCount + 1])
  );
  const totalChannels = planEntries.reduce((s, e) => s + e.channelCount, 0);
  const totalUnits = totalChannels + companies.length;
  /** Cumulative units after company `i` finishes. */
  const cumulativeUnits: number[] = [];
  {
    let sum = 0;
    for (const c of companies) {
      sum += planUnitsByCompany.get(c.id) ?? 1;
      cumulativeUnits.push(sum);
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (p: SlackScanAllStreamPayload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(p)}\n`));
      };

      const results: SlackScanAllResult[] = [];
      let okCount = 0;
      let failCount = 0;
      /** Sum of finished work units across all companies (channels + AI step). */
      let unitsDone = 0;

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
          totalUnits,
          unitsDone,
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
          totalChannels,
          totalUnits,
          /** True when the request body included a `companyIds` array filter. */
          companyFilterApplied: filterIds != null,
        });
        write({
          type: "plan",
          companies: planEntries,
          totalChannels,
          totalUnits,
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
              unitsDone += 1;
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
              stats: r.stats,
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

          // Snap to plan baseline so the AI / finalize unit and any unreported
          // channel skips get accounted for, even on failure.
          const target = cumulativeUnits[i] ?? unitsDone;
          if (unitsDone < target) unitsDone = target;
          emit(i + 1, null);
        }

        logSlackRoadmapSync("info", {
          event: "api_sync_all_done",
          logTrigger: "api-sync-all",
          batchId,
          companyCount: companies.length,
          okCount,
          failCount,
          unitsDone,
          totalUnits,
        });
        write({
          type: "done",
          total: companies.length,
          totalUnits,
          unitsDone,
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
