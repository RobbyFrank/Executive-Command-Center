import { NextResponse } from "next/server";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import type { SlackScanStreamPayload } from "@/lib/slack-scrape-stream-types";
import { runSlackRoadmapSyncForCompany } from "@/server/actions/slackRoadmapSync/run";
import {
  buildPendingRecordsFromFreshOnly,
  reconcileAndReplaceFromFresh,
} from "@/server/actions/slackRoadmapSync/pipeline";
import { mutateSlackSuggestions } from "@/server/repository/slack-suggestions-storage";
import type { SlackSuggestionRecord, SlackSuggestionsData } from "@/lib/schemas/tracker";
import { getRepository } from "@/server/repository";
import { updateTag } from "next/cache";
import { ECC_SLACK_SUGGESTIONS_TAG } from "@/lib/cache-tags";
import { fetchSlackChannels } from "@/lib/slack";
import type { TrackerData } from "@/lib/types/tracker";

function buildChannelNameById(
  data: TrackerData,
  companyId: string,
  listChannels: { id: string; name: string }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const ch of listChannels) {
    map.set(ch.id, ch.name);
  }
  for (const g of data.goals) {
    if (g.companyId !== companyId) continue;
    const cid = (g.slackChannelId ?? "").trim();
    if (cid && !map.has(cid)) {
      map.set(cid, g.slackChannel.trim() || cid);
    }
  }
  return map;
}

function replacePending(
  companyId: string,
  nextPending: SlackSuggestionRecord[]
) {
  return (d: SlackSuggestionsData) => {
    d.items = d.items.filter(
      (x) => !(x.companyId === companyId && x.status === "pending")
    );
    d.items.push(...nextPending);
  };
}

type Row = {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "failed";
  detail?: string;
  messageCount?: number;
};

function snapshotRows(rows: Row[]) {
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    ...(e.messageCount !== undefined
      ? { messageCount: e.messageCount }
      : {}),
  }));
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as {
    companyId?: unknown;
    channelIds?: unknown;
    days?: unknown;
    includeThreads?: unknown;
  };
  const companyId = typeof b.companyId === "string" ? b.companyId.trim() : "";
  const channelIds = [
    ...new Set(
      Array.isArray(b.channelIds)
        ? b.channelIds
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    ),
  ];
  const daysRaw = typeof b.days === "number" ? b.days : Number(b.days);
  const days = Number.isFinite(daysRaw)
    ? Math.min(90, Math.max(1, Math.floor(daysRaw)))
    : 14;
  const includeThreads = b.includeThreads === false ? false : true;

  if (!companyId || channelIds.length === 0) {
    return NextResponse.json(
      { error: "companyId and non-empty channelIds are required" },
      { status: 400 }
    );
  }

  const repo = getRepository();
  const data = await repo.load();
  if (!data.companies.some((c) => c.id === companyId)) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (p: SlackScanStreamPayload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(p)}\n`));
      };

      let completed = 0;

      try {
        const list = await fetchSlackChannels();
        if (!list.ok) {
          write({ type: "error", message: list.error });
          return;
        }
        const channelNameById = buildChannelNameById(
          data,
          companyId,
          list.channels
        );
        const rows: Row[] = channelIds.map((id) => ({
          id,
          name: channelNameById.get(id) ?? id,
          status: "queued" as const,
        }));

        write({
          type: "progress",
          phase: "history",
          entries: snapshotRows(rows),
          completed: 0,
          total: channelIds.length,
        });

        const result = await runSlackRoadmapSyncForCompany({
          companyId,
          channelIds,
          days,
          includeThreads,
          onModelTextChunk: (d) => {
            if (d) write({ type: "progress", phase: "model", chunk: d });
          },
          onChannelStart: (info) => {
            const idx = rows.findIndex((r) => r.id === info.channelId);
            if (idx < 0) return;
            rows[idx]!.name = info.name;
            rows[idx]!.status = "running";
            write({
              type: "progress",
              phase: "history",
              entries: snapshotRows(rows),
              completed,
              total: channelIds.length,
            });
          },
          onChannelDone: (info) => {
            const idx = rows.findIndex((r) => r.id === info.channelId);
            if (idx < 0) return;
            if (info.ok) {
              rows[idx]!.status = "done";
              rows[idx]!.messageCount = info.messageCount;
            } else {
              rows[idx]!.status = "failed";
              rows[idx]!.detail = info.error;
            }
            completed += 1;
            write({
              type: "progress",
              phase: "history",
              entries: snapshotRows(rows),
              completed,
              total: channelIds.length,
            });
          },
          trackerData: data,
        });

        for (const r of rows) {
          if (r.status === "running") r.status = "done";
        }
        if (rows.length > 0) {
          write({
            type: "progress",
            phase: "history",
            entries: snapshotRows(rows),
            completed: channelIds.length,
            total: channelIds.length,
          });
        }

        write({
          type: "progress",
          phase: "model",
          message: "Merging with your review queue…",
        });

        const { suggestions, rejected } = result;
        let pendingForCompany: SlackSuggestionRecord[] | undefined;
        let reconcileFailed = false;
        const recRes = await reconcileAndReplaceFromFresh(companyId, suggestions);
        if (recRes.ok) {
          pendingForCompany = recRes.pending;
        } else {
          reconcileFailed = true;
          const fallback = buildPendingRecordsFromFreshOnly(companyId, suggestions);
          try {
            await mutateSlackSuggestions(replacePending(companyId, fallback));
            pendingForCompany = fallback;
            updateTag(ECC_SLACK_SUGGESTIONS_TAG);
          } catch {
            /* ignore */
          }
        }

        write({
          type: "done",
          suggestions,
          rejected,
          pendingForCompany,
          reconcileFailed,
        });
      } catch (e) {
        write({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
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
