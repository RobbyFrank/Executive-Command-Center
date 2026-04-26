import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  logSlackRoadmapSync,
  logSlackRoadmapSyncLongText,
} from "@/lib/slackRoadmapSyncLog";
import type { SlackScrapeSuggestion } from "@/lib/schemas/tracker";
import { SlackScrapeSuggestionSchema } from "@/lib/schemas/tracker";
import {
  fetchSlackChannelHistory,
  fetchSlackChannels,
  type SlackChannel,
  type SlackChannelHistoryMessage,
} from "@/lib/slack";
import { buildTranscriptWithThreads } from "@/lib/slack/threadHistory";
import { enrichSlackScrapeSuggestions, mergeMessageAuthorsForChannel } from "@/lib/slackScrapeEnrich";
import {
  buildExistingRoadmapBlock,
  buildPeopleRosterBlock,
  buildSlackScrapeSystemPrompt,
  capTranscript,
} from "@/lib/slackScrapePrompt";
import type { TrackerData } from "@/lib/types/tracker";
import { isScrapeSuggestionValidForCompany } from "@/server/actions/slackRoadmapSync/validate";
import { readSlackSuggestions } from "@/server/repository/slack-suggestions-storage";

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
    const rc = m.reply_count;
    const rcHint =
      typeof rc === "number" && rc > 0 ? ` reply_count=${rc}` : "";
    lines.push(`[${m.ts}] user_or_bot=${who}${rcHint} ${text}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Best-effort recovery from common ways Claude can wander off the strict
 * "ONLY a JSON array" instruction:
 *  - wrapped in a ```json fenced block (with or without `json`)
 *  - prefixed/suffixed by prose like "Here are the suggestions: [...]"
 *  - wrapped as `{"suggestions": [...]}` or `{"items": [...]}`
 *  - apologetic empty replies ("I cannot…") → treated as "no suggestions"
 *
 * Throws with a diagnostic message (including a sample of `raw`) when
 * everything fails, so the failure surfaces in the UI's failed-list and
 * server logs instead of just "Model did not return valid JSON".
 */
function extractJsonArray(raw: string): unknown[] {
  const t = raw.trim();
  if (t.length === 0) {
    throw new Error("Model returned an empty response (0 chars).");
  }

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1]!.trim() : t;

  let parseError: unknown = null;
  try {
    const v = JSON.parse(candidate) as unknown;
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const key of ["suggestions", "items", "results", "data"]) {
        const inner = o[key];
        if (Array.isArray(inner)) return inner;
      }
    }
  } catch (e) {
    parseError = e;
  }

  const firstBracket = candidate.indexOf("[");
  const lastBracket = candidate.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const slice = candidate.slice(firstBracket, lastBracket + 1);
    try {
      const v = JSON.parse(slice) as unknown;
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through */
    }
  }

  const sample = t.length > 400 ? `${t.slice(0, 400)}…` : t;
  const reason =
    parseError instanceof Error ? parseError.message : "no JSON array found";
  throw new Error(
    `Model did not return a JSON array (${t.length} chars; ${reason}). ` +
      `Output starts with: ${JSON.stringify(sample)}`
  );
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

export type RunSlackRoadmapSyncOptions = {
  companyId: string;
  channelIds: string[];
  days: number;
  includeThreads: boolean;
  /** If set, forward Claude stream chunks (for the NDJSON route). */
  onModelTextChunk?: (t: string) => void;
  /** When each channel’s fetch starts (sequential, for progress UI). */
  onChannelStart?: (info: { channelId: string; name: string }) => void;
  /** After each channel history fetch (for NDJSON progress UI). */
  onChannelDone?: (info: {
    channelId: string;
    name: string;
    ok: boolean;
    error?: string;
    messageCount?: number;
  }) => void;
  /** Pass tracker; if omitted, loads from getRepository. */
  trackerData?: TrackerData;
  signal?: AbortSignal;
  /**
   * Correlates all log lines for this invocation in Vercel. Defaults to a new UUID.
   * Parent jobs (cron, “Sync all”) should pass one id per company.
   */
  correlationId?: string;
  /**
   * Where this run was triggered: `cron`, `api-sync-all`, `api-scrape`, or custom.
   * Included in every log line for filtering.
   */
  logTrigger?: string;
  /** When set, groups multiple companies in one Vercel request (e.g. nightly cron). */
  batchId?: string;
};

/**
 * Diagnostic counters for a single per-company run. Used by the UI to explain
 * a "0 new" outcome (e.g. transcript size vs model returning `[]`).
 */
export type SlackRoadmapSyncRunStats = {
  /** Number of channels scanned (== channelIds.length). */
  channelsScanned: number;
  /** Channels that returned at least one message. */
  channelsWithMessages: number;
  /** Sum of messages aggregated into the transcript across all channels. */
  totalMessages: number;
  /** Length of the transcript (post-cap) sent to Claude. 0 when no channels had messages. */
  transcriptChars: number;
  /** Cap applied (so the UI can show "120k / 120k cap" when truncated). */
  maxTranscriptChars: number;
  /** Length of Claude's text response. ~2 chars usually means `[]` (nothing actionable). */
  modelOutputChars: number;
  /** Number of items in the parsed JSON array (before validation). */
  parsedItemCount: number;
  /** Items dropped by schema or per-company validation. */
  schemaRejectedOrInvalidCount: number;
};

/**
 * Fetches Slack, runs Claude, validates + enriches. Does not write the suggestions queue.
 */
export async function runSlackRoadmapSyncForCompany(
  options: RunSlackRoadmapSyncOptions
): Promise<{
  suggestions: SlackScrapeSuggestion[];
  rejected: number;
  channelNameById: Map<string, string>;
  stats: SlackRoadmapSyncRunStats;
}> {
  const {
    companyId,
    channelIds,
    days,
    includeThreads,
    onModelTextChunk,
    onChannelStart,
    onChannelDone,
    signal,
  } = options;
  const correlationId = options.correlationId ?? randomUUID();
  const logTrigger = options.logTrigger ?? "run";
  const batchId = options.batchId;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const { getRepository } = await import("@/server/repository");
  const repo = getRepository();
  const data = options.trackerData ?? (await repo.load());
  if (!data.companies.some((c) => c.id === companyId)) {
    throw new Error("Company not found");
  }

  const companyName = data.companies.find((c) => c.id === companyId)?.name;

  if (channelIds.length === 0) {
    logSlackRoadmapSync("info", {
      event: "run_skip",
      reason: "no_channels",
      correlationId,
      logTrigger,
      batchId,
      companyId,
      companyName,
    });
    return {
      suggestions: [],
      rejected: 0,
      channelNameById: new Map(),
      stats: {
        channelsScanned: 0,
        channelsWithMessages: 0,
        totalMessages: 0,
        transcriptChars: 0,
        maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
        modelOutputChars: 0,
        parsedItemCount: 0,
        schemaRejectedOrInvalidCount: 0,
      },
    };
  }

  const oldestTs = slackOldestTsFromDaysAgo(
    Math.min(90, Math.max(1, Math.floor(days)))
  );

  const list = await fetchSlackChannels();
  if (!list.ok) {
    logSlackRoadmapSync("error", {
      event: "slack_channels_list_failed",
      correlationId,
      logTrigger,
      batchId,
      companyId,
      companyName,
      error: list.error,
    });
    throw new Error(list.error);
  }

  const channelNameById = buildChannelNameById(
    data,
    companyId,
    list.channels
  );

  const modelId = getAnthropicModel();
  logSlackRoadmapSync("info", {
    event: "run_start",
    correlationId,
    logTrigger,
    batchId,
    companyId,
    companyName,
    channelCount: channelIds.length,
    days: Math.min(90, Math.max(1, Math.floor(days))),
    includeThreads,
    model: modelId,
  });

  const transcriptParts: string[] = [];
  const messageAuthors = new Map<string, string>();
  let channelsWithMessages = 0;
  let totalMessages = 0;

  for (const channelId of channelIds) {
    if (signal?.aborted) throw new Error("Aborted");
    const name0 = channelNameById.get(channelId) ?? channelId;
    onChannelStart?.({ channelId, name: name0 });
    const hist = await fetchSlackChannelHistory(channelId, {
      oldestTs,
      limitPerPage: 200,
      maxMessages: 500,
    });
    if (!hist.ok) {
      logSlackRoadmapSync("warn", {
        event: "channel_history_failed",
        correlationId,
        logTrigger,
        batchId,
        companyId,
        companyName,
        channelId,
        channelName: name0,
        error: hist.error,
      });
      onChannelDone?.({
        channelId,
        name: name0,
        ok: false,
        error: hist.error,
      });
      continue;
    }
    const name = name0;
    mergeMessageAuthorsForChannel(messageAuthors, name, hist.messages);
    let block = formatMessagesForChannel(name, hist.messages);
    if (includeThreads) {
      const th = await buildTranscriptWithThreads(
        name,
        channelId,
        hist.messages,
        { maxThreads: 200, concurrency: 4 }
      );
      for (const [k, v] of th.messageAuthors) {
        messageAuthors.set(k, v);
      }
      block += th.extraLines;
    }
    transcriptParts.push(block);
    if (hist.messages.length > 0) channelsWithMessages += 1;
    totalMessages += hist.messages.length;
    logSlackRoadmapSync("info", {
      event: "channel_history_ok",
      correlationId,
      logTrigger,
      batchId,
      companyId,
      companyName,
      channelId,
      channelName: name,
      messageCount: hist.messages.length,
    });
    onChannelDone?.({
      channelId,
      name,
      ok: true,
      messageCount: hist.messages.length,
    });
  }

  if (transcriptParts.length === 0) {
    logSlackRoadmapSync("warn", {
      event: "run_skip",
      reason: "all_channel_fetches_failed",
      correlationId,
      logTrigger,
      batchId,
      companyId,
      companyName,
    });
    return {
      suggestions: [],
      rejected: 0,
      channelNameById,
      stats: {
        channelsScanned: channelIds.length,
        channelsWithMessages: 0,
        totalMessages: 0,
        transcriptChars: 0,
        maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
        modelOutputChars: 0,
        parsedItemCount: 0,
        schemaRejectedOrInvalidCount: 0,
      },
    };
  }

  let slackTranscript = transcriptParts.join("\n");
  slackTranscript = capTranscript(slackTranscript, MAX_TRANSCRIPT_CHARS);
  logSlackRoadmapSync("info", {
    event: "transcript_ready",
    correlationId,
    logTrigger,
    batchId,
    companyId,
    companyName,
    transcriptChars: slackTranscript.length,
    maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
  });

  const existingBlock = buildExistingRoadmapBlock(data, companyId);
  const peopleBlock = buildPeopleRosterBlock(data.people);
  const systemPrompt = buildSlackScrapeSystemPrompt(
    existingBlock,
    slackTranscript,
    peopleBlock
  );

  const anthropic = new Anthropic({ apiKey });
  const userMsg = {
    role: "user" as const,
    content:
      "Analyze the Slack transcript and return ONLY the JSON array of suggestions as specified.",
  };
  const modelParams = {
    model: modelId,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [userMsg],
  };

  let finalMessage: {
    id: string;
    content: Array<{ type: string; text?: string }>;
    usage: {
      input_tokens: number | null;
      output_tokens: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
    stop_reason: string | null;
  };
  if (onModelTextChunk) {
    const modelStream = anthropic.messages.stream(modelParams);
    modelStream.on("text", (d: string) => {
      if (d) onModelTextChunk(d);
    });
    finalMessage = await modelStream.finalMessage();
  } else {
    finalMessage = await anthropic.messages.create(modelParams);
  }

  const b0 = finalMessage.content[0];
  const textOut: string = b0?.type === "text" ? (b0.text ?? "") : "";
  const contentBlockTypes = finalMessage.content.map((b) => b.type);
  const textBlocks = finalMessage.content.filter((b) => b.type === "text")
    .length;
  logSlackRoadmapSync("info", {
    event: "model_response",
    correlationId,
    logTrigger,
    batchId,
    companyId,
    companyName,
    messageId: finalMessage.id,
    model: modelId,
    outputChars: textOut.length,
    textBlocks,
    contentBlockTypes,
    stopReason: finalMessage.stop_reason,
    inputTokens: finalMessage.usage?.input_tokens,
    outputTokens: finalMessage.usage?.output_tokens,
    cacheCreationInputTokens: finalMessage.usage?.cache_creation_input_tokens,
    cacheReadInputTokens: finalMessage.usage?.cache_read_input_tokens,
  });
  if (!textOut.length) {
    logSlackRoadmapSync("warn", {
      event: "model_no_text_block",
      correlationId,
      logTrigger,
      batchId,
      companyId,
      companyName,
      firstBlockType: b0?.type,
      contentBlockTypes,
    });
  }

  let parsed: unknown[] = [];
  try {
    parsed = extractJsonArray(textOut);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSlackRoadmapSync("error", {
      event: "model_json_parse_failed",
      correlationId,
      logTrigger,
      batchId,
      companyId,
      companyName,
      message: msg,
      model: modelId,
      outputChars: textOut.length,
    });
    logSlackRoadmapSyncLongText(
      "error",
      {
        event: "model_raw_output",
        correlationId,
        logTrigger,
        batchId,
        companyId,
        companyName,
      },
      textOut
    );
    throw new Error(msg);
  }

  const suggestions: SlackScrapeSuggestion[] = [];
  let rejected = 0;

  for (const item of parsed) {
    const r = SlackScrapeSuggestionSchema.safeParse(item);
    if (!r.success) {
      rejected += 1;
      continue;
    }
    const s = r.data;
    if (!isScrapeSuggestionValidForCompany(data, companyId, s)) {
      rejected += 1;
      continue;
    }
    suggestions.push(s);
  }

  enrichSlackScrapeSuggestions(suggestions, {
    people: data.people,
    channelNameById,
    messageAuthors,
  });

  logSlackRoadmapSync("info", {
    event: "run_complete",
    correlationId,
    logTrigger,
    batchId,
    companyId,
    companyName,
    parsedItemCount: parsed.length,
    acceptedCount: suggestions.length,
    schemaRejectedOrInvalidCount: rejected,
  });

  return {
    suggestions,
    rejected,
    channelNameById,
    stats: {
      channelsScanned: channelIds.length,
      channelsWithMessages,
      totalMessages,
      transcriptChars: slackTranscript.length,
      maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
      modelOutputChars: textOut.length,
      parsedItemCount: parsed.length,
      schemaRejectedOrInvalidCount: rejected,
    },
  };
}

/**
 * Rejected dedupe keys for a company (for reconciliation prompt).
 */
export async function getRejectedDedupeKeysForCompany(
  companyId: string
): Promise<Set<string>> {
  const doc = await readSlackSuggestions();
  const list = doc.rejectedKeysByCompany[companyId] ?? [];
  return new Set(list);
}
