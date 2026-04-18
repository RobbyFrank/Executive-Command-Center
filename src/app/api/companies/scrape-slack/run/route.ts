import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { getAnthropicModel } from "@/lib/anthropicModel";
import type { SlackScanStreamPayload } from "@/lib/slack-scrape-stream-types";
import {
  SlackScrapeSuggestionSchema,
  type SlackScrapeSuggestion,
} from "@/lib/schemas/tracker";
import {
  fetchSlackChannelHistory,
  fetchSlackChannels,
  type SlackChannel,
  type SlackChannelHistoryMessage,
} from "@/lib/slack";
import {
  buildExistingRoadmapBlock,
  buildSlackScrapeSystemPrompt,
  capTranscript,
} from "@/lib/slackScrapePrompt";
import { getRepository } from "@/server/repository";
import type { TrackerData } from "@/lib/types/tracker";

const MAX_TRANSCRIPT_CHARS = 120_000;

function slackOldestTsFromDaysAgo(days: number): string {
  const sec = Math.floor(Date.now() / 1000 - days * 86400);
  return `${sec}.000000`;
}

function formatMessagesForChannel(
  channelName: string,
  messages: SlackChannelHistoryMessage[]
): string {
  const lines: string[] = [];
  lines.push(`=== #${channelName} ===`);
  for (const m of messages) {
    const text = (m.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const who = m.user ?? m.bot_id ?? "?";
    lines.push(`[${m.ts}] user_or_bot=${who} ${text}`);
  }
  lines.push("");
  return lines.join("\n");
}

function extractJsonArray(raw: string): unknown {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fence ? fence[1]!.trim() : t;
  return JSON.parse(jsonStr) as unknown;
}

function buildChannelNameById(
  data: TrackerData,
  companyId: string,
  listChannels: SlackChannel[]
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

  const oldestTs = slackOldestTsFromDaysAgo(days);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (p: SlackScanStreamPayload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(p)}\n`));
      };

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

        type Row = {
          id: string;
          name: string;
          status: "queued" | "running" | "done" | "failed";
          detail?: string;
          messageCount?: number;
        };

        const rows: Row[] = channelIds.map((id) => ({
          id,
          name: channelNameById.get(id) ?? id,
          status: "queued",
        }));

        const snapshot = () =>
          rows.map((e) => ({
            id: e.id,
            name: e.name,
            status: e.status,
            ...(e.detail !== undefined ? { detail: e.detail } : {}),
            ...(e.messageCount !== undefined
              ? { messageCount: e.messageCount }
              : {}),
          }));

        write({
          type: "progress",
          phase: "history",
          entries: snapshot(),
          completed: 0,
          total: channelIds.length,
        });

        const transcriptParts: string[] = [];

        for (let i = 0; i < channelIds.length; i++) {
          const channelId = channelIds[i]!;
          rows[i]!.status = "running";
          write({
            type: "progress",
            phase: "history",
            entries: snapshot(),
            completed: i,
            total: channelIds.length,
          });

          const hist = await fetchSlackChannelHistory(channelId, {
            oldestTs,
            limitPerPage: 200,
            maxMessages: 500,
          });

          if (!hist.ok) {
            rows[i]!.status = "failed";
            rows[i]!.detail = hist.error;
            write({
              type: "progress",
              phase: "history",
              entries: snapshot(),
              completed: i + 1,
              total: channelIds.length,
            });
            continue;
          }

          rows[i]!.status = "done";
          rows[i]!.messageCount = hist.messages.length;
          const name = channelNameById.get(channelId) ?? channelId;
          transcriptParts.push(formatMessagesForChannel(name, hist.messages));
          write({
            type: "progress",
            phase: "history",
            entries: snapshot(),
            completed: i + 1,
            total: channelIds.length,
          });
        }

        if (transcriptParts.length === 0) {
          write({
            type: "error",
            message:
              "Could not load message history from any channel. Check Slack token scopes and channel access.",
          });
          return;
        }

        let slackTranscript = transcriptParts.join("\n");
        slackTranscript = capTranscript(slackTranscript, MAX_TRANSCRIPT_CHARS);

        write({
          type: "progress",
          phase: "model",
          message: "Analyzing conversations…",
        });

        const existingBlock = buildExistingRoadmapBlock(data, companyId);
        const systemPrompt = buildSlackScrapeSystemPrompt(
          existingBlock,
          slackTranscript
        );

        const anthropic = new Anthropic({ apiKey });
        const modelStream = anthropic.messages.stream({
          model: getAnthropicModel(),
          max_tokens: 8192,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content:
                "Analyze the Slack transcript and return ONLY the JSON array of suggestions as specified.",
            },
          ],
        });

        modelStream.on("text", (textDelta: string) => {
          if (!textDelta) return;
          write({ type: "progress", phase: "model", chunk: textDelta });
        });

        const finalMessage = await modelStream.finalMessage();
        const block = finalMessage.content[0];
        const textOut = block?.type === "text" ? block.text : "";

        let parsed: unknown;
        try {
          parsed = extractJsonArray(textOut);
        } catch {
          write({ type: "error", message: "Model did not return valid JSON" });
          return;
        }

        if (!Array.isArray(parsed)) {
          write({ type: "error", message: "Model JSON must be an array" });
          return;
        }

        const suggestions: SlackScrapeSuggestion[] = [];
        let rejected = 0;

        const goalIdsForCompany = new Set(
          data.goals.filter((g) => g.companyId === companyId).map((g) => g.id)
        );

        for (const item of parsed) {
          const r = SlackScrapeSuggestionSchema.safeParse(item);
          if (!r.success) {
            rejected += 1;
            continue;
          }
          const s = r.data;
          if (s.kind === "newProjectOnExistingGoal") {
            if (!goalIdsForCompany.has(s.existingGoalId)) {
              rejected += 1;
              continue;
            }
          }
          suggestions.push(s);
        }

        write({ type: "done", suggestions, rejected });
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
