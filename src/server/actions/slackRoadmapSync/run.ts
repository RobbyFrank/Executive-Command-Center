import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
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

  if (channelIds.length === 0) {
    return { suggestions: [], rejected: 0, channelNameById: new Map() };
  }

  const oldestTs = slackOldestTsFromDaysAgo(
    Math.min(90, Math.max(1, Math.floor(days)))
  );

  const list = await fetchSlackChannels();
  if (!list.ok) {
    throw new Error(list.error);
  }

  const channelNameById = buildChannelNameById(
    data,
    companyId,
    list.channels
  );

  const transcriptParts: string[] = [];
  const messageAuthors = new Map<string, string>();

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
    onChannelDone?.({
      channelId,
      name,
      ok: true,
      messageCount: hist.messages.length,
    });
  }

  if (transcriptParts.length === 0) {
    return { suggestions: [], rejected: 0, channelNameById };
  }

  let slackTranscript = transcriptParts.join("\n");
  slackTranscript = capTranscript(slackTranscript, MAX_TRANSCRIPT_CHARS);

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
    model: getAnthropicModel(),
    max_tokens: 8192,
    system: systemPrompt,
    messages: [userMsg],
  };

  let textOut: string;
  if (onModelTextChunk) {
    const modelStream = anthropic.messages.stream(modelParams);
    modelStream.on("text", (d: string) => {
      if (d) onModelTextChunk(d);
    });
    const finalMessage = await modelStream.finalMessage();
    const b0 = finalMessage.content[0];
    textOut = b0?.type === "text" ? b0.text : "";
  } else {
    const finalMessage = await anthropic.messages.create(modelParams);
    const b0 = finalMessage.content[0];
    textOut = b0?.type === "text" ? b0.text : "";
  }

  let parsed: unknown;
  try {
    parsed = extractJsonArray(textOut);
  } catch {
    throw new Error("Model did not return valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Model JSON must be an array");
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

  return { suggestions, rejected, channelNameById };
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
