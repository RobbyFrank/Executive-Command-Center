import { isFounderPerson } from "@/lib/autonomyRoster";
import { businessHoursBetween } from "@/lib/businessHours";
import { trimSlackUserId } from "@/lib/loginSlackMessage";
import { collectSlackUserIdsFromMessageText } from "@/lib/slackDisplay";
import type { AskEntry } from "@/lib/schemas/unrepliedAsks";
import type { Person } from "@/lib/types/tracker";
import {
  fetchSlackThreadReplies,
  fetchSlackUserMessageHistory,
  parseSlackThreadUrl,
  type SlackUserMessageMatch,
} from "@/lib/slack";
import type { UnrepliedScanProgressEvent } from "@/lib/unrepliedAsksScanTypes";
import { getAnthropicClassifyModel } from "@/lib/anthropicModel";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import {
  clampLookbackDays,
  DEFAULT_UNREPLIED_LOOKBACK_DAYS,
  UNREPLIED_BUSINESS_HOURS_THRESHOLD,
} from "@/lib/unrepliedAsksFilters";
import {
  mutateUnrepliedAsks,
  readUnrepliedAsks,
} from "@/server/repository/unreplied-asks-storage";

export type { UnrepliedScanProgressEvent } from "@/lib/unrepliedAsksScanTypes";

type FounderPair = { personId: string; slackUserId: string };

function resolveFounderSlackId(p: Person): string {
  let id = trimSlackUserId(p.slackHandle);
  if (!id && p.id === "nadav") {
    id = trimSlackUserId(process.env.NADAV_SLACK_USER_ID);
  }
  return id;
}

function listFounderSlackPairs(people: Person[]): FounderPair[] {
  const out: FounderPair[] = [];
  for (const p of people) {
    if (!isFounderPerson(p)) continue;
    const slackUserId = resolveFounderSlackId(p);
    if (!slackUserId) continue;
    out.push({ personId: p.id, slackUserId });
  }
  const seen = new Set<string>();
  return out.filter((x) => {
    if (seen.has(x.slackUserId)) return false;
    seen.add(x.slackUserId);
    return true;
  });
}

function slackTsMs(ts: string): number {
  const sec = parseFloat(ts);
  return Number.isFinite(sec) ? Math.floor(sec * 1000) : 0;
}

/** First-ever scan for a founder backfills this many days (watermark-less case). */
export const DEFAULT_INITIAL_BACKFILL_DAYS = 30;

function toYmdUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function withinLookback(ts: string, lookbackDays: number, now: Date): boolean {
  const ms = slackTsMs(ts);
  if (!ms) return false;
  return now.getTime() - ms <= lookbackDays * 86_400_000;
}

function entryId(channelId: string, ts: string): string {
  return `${channelId.trim()}|${ts.trim()}`;
}

function mapChannelKind(kind: string): "channel" | "mpim" | null {
  if (kind === "channel" || kind === "group") return "channel";
  if (kind === "mpim") return "mpim";
  return null;
}

const CLASSIFIER_SYSTEM = `You classify one Slack message sent by a company cofounder.
Output exactly one JSON object on a single line, no markdown, no other text.
Shape: {"ask":true|false,"assigneeSlackUserId":"U0123ABCD"|null}
Rules:
- ask=true when the message asks a teammate for information, a decision, a status update, or assigns them a task (including soft asks like "can you…", "please…", "let me know…").
- ask=false for FYIs, thanks, acknowledgments, social chat, emoji-only, or pure statements with no request.
- assigneeSlackUserId: the primary teammate Slack user ID (U… form) the cofounder is addressing, from the Mentions list when obvious; null if unclear or broadcast.`;

function parseClassifierJson(raw: string): {
  ask: boolean;
  assigneeSlackUserId: string | null;
} | null {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  try {
    const obj = JSON.parse(t) as {
      ask?: unknown;
      assigneeSlackUserId?: unknown;
    };
    if (typeof obj.ask !== "boolean") return null;
    let assignee: string | null = null;
    if (typeof obj.assigneeSlackUserId === "string") {
      const u = obj.assigneeSlackUserId.trim().toUpperCase();
      if (/^[UW][A-Z0-9]{8,}$/.test(u)) assignee = u;
    }
    if (obj.assigneeSlackUserId === null) assignee = null;
    return { ask: obj.ask, assigneeSlackUserId: assignee };
  } catch {
    return null;
  }
}

async function classifyMessage(
  text: string,
  channelName: string,
  channelKind: string,
  mentionIds: string[]
): Promise<
  | { classification: "ask"; assigneeSlackUserId?: string }
  | { classification: "not_ask" }
  | { classification: "error" }
> {
  const userPayload = [
    `Channel: ${channelName || "(unknown)"} (${channelKind})`,
    `Mentions in message: ${mentionIds.length ? mentionIds.map((id) => `<@${id}>`).join(", ") : "(none)"}`,
    "",
    "Message:",
    text.trim() || "(empty)",
  ].join("\n");

  try {
    const out = await claudePlainText(CLASSIFIER_SYSTEM, userPayload, {
      model: getAnthropicClassifyModel(),
    });
    const parsed = parseClassifierJson(out);
    if (!parsed) return { classification: "error" };
    if (!parsed.ask) return { classification: "not_ask" };
    return {
      classification: "ask",
      assigneeSlackUserId: parsed.assigneeSlackUserId ?? undefined,
    };
  } catch {
    return { classification: "error" };
  }
}

/**
 * Picks out reactions on the ask message itself from the thread response, so we
 * can render teammate acknowledgments (eyes, thumbsup, etc.) on the Followups
 * row even before a text reply exists. Returns undefined when the message has
 * no reactions so we don't bloat Redis with empty arrays.
 */
function extractAskReactions(
  messages: { ts: string; reactions?: AskEntry["reactions"] }[],
  askTs: string
): AskEntry["reactions"] | undefined {
  const match = messages.find((m) => m.ts === askTs);
  if (!match?.reactions || match.reactions.length === 0) return undefined;
  return match.reactions.map((r) => ({
    name: r.name,
    count: r.count,
    users: r.users ?? [],
  }));
}

/**
 * Derives the **effective assignees** for an ask from its thread: the distinct
 * non-founder teammates in the run of messages immediately before the ask,
 * walking back until we hit a founder message or the thread start. This lets
 * the Followups UI group asks under the person (or people) the founder was
 * clearly replying to, even when the classifier couldn't pick a single
 * addressee from the ask text alone.
 *
 * Examples (oldest → newest):
 *   - `[Robby, Ghulam, Robby(ask)]` → `[Ghulam]`
 *   - `[Robby, James, Dave, Robby(ask)]` → `[Dave, James]` (most-recent first)
 *   - `[Robby(ask)]`  → `[]` (no prior context; classifier's guess is the best we have)
 *
 * Returns undefined rather than `[]` so we don't bloat Redis with empty arrays
 * for the no-prior-context case.
 */
function computeEffectiveAssignees(
  messages: { ts: string; user?: string; bot_id?: string }[],
  askTs: string,
  founders: Set<string>
): string[] | undefined {
  if (messages.length === 0) return undefined;
  const sorted = [...messages].sort(
    (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
  );
  const askIdx = sorted.findIndex((m) => m.ts === askTs);
  if (askIdx < 0) return undefined;
  const assignees: string[] = [];
  const seen = new Set<string>();
  for (let i = askIdx - 1; i >= 0; i--) {
    const m = sorted[i]!;
    if (m.bot_id) continue;
    const uid = (m.user ?? "").trim().toUpperCase();
    if (!uid) continue;
    if (founders.has(uid)) break;
    if (seen.has(uid)) continue;
    seen.add(uid);
    assignees.push(uid);
  }
  return assignees.length > 0 ? assignees : undefined;
}

/**
 * One rule for the Followups wall: an ask is "replied to" iff **any** newer
 * message exists in its thread. Who sent the newer message (teammate, founder,
 * bot, the original author) is intentionally not considered — if Slack shows
 * something newer than the ask, we trust the thread and hide the row.
 *
 * `hasExternalReply` keeps its field name for storage-compat but its meaning
 * narrows to "has any reply strictly after the ask's ts".
 */
function applyLatestTsToEntry(entry: AskEntry, latestTs: string): void {
  const askMs = slackTsMs(entry.ts);
  const latestMs = slackTsMs(latestTs);
  const newerExists = latestMs > 0 && askMs > 0 && latestMs > askMs;
  entry.lastReplyTs = latestTs || entry.lastReplyTs;
  entry.lastExternalReplyTs = newerExists ? latestTs : undefined;
  entry.hasExternalReply = newerExists;
  if (newerExists && entry.state === "open") {
    entry.state = "replied";
  }
}

function maybeSetFirstSurfaced(entry: AskEntry, now: Date): void {
  if (entry.classification !== "ask" || entry.state !== "open") return;
  if (entry.hasExternalReply) return;
  const msgAt = new Date(slackTsMs(entry.ts));
  if (Number.isNaN(msgAt.getTime())) return;
  if (businessHoursBetween(msgAt, now) < UNREPLIED_BUSINESS_HOURS_THRESHOLD) {
    return;
  }
  if (!entry.firstSurfacedAt) {
    entry.firstSurfacedAt = now.toISOString();
  }
}

/**
 * Resolves the true thread root for an ask. `search.messages` does not expose
 * `thread_ts`, but the permalink for an in-thread reply includes it as a
 * `?thread_ts=` query param, so we can recover it from the stored permalink.
 * Falls back to the ask's own ts when the permalink doesn't parse (the message
 * is either the thread root or we couldn't parse the URL).
 */
function resolveThreadTsFromPermalink(
  permalink: string,
  fallbackTs: string
): string {
  const parsed = parseSlackThreadUrl(permalink);
  return parsed?.threadTs || fallbackTs;
}

type RefreshOutcome =
  | { ok: true; entry: AskEntry }
  | { ok: false; entry: AskEntry; error: string };

async function refreshAskEntry(
  entry: AskEntry,
  founders: Set<string>,
  now: Date
): Promise<RefreshOutcome> {
  const copy: AskEntry = structuredClone(entry);
  // Self-heal: if the stored threadTs disagrees with the permalink's thread root,
  // correct it before hitting Slack. Old entries stored before the
  // "derive-threadTs-from-permalink" fix had threadTs = ts, which breaks
  // conversations.replies for messages that were actually in-thread replies.
  const correctedThreadTs = resolveThreadTsFromPermalink(
    copy.permalink,
    copy.ts
  );
  if (correctedThreadTs !== copy.threadTs) {
    copy.threadTs = correctedThreadTs;
  }
  const rep = await fetchSlackThreadReplies(copy.channelId, copy.threadTs);
  if (!rep.ok) {
    console.warn(
      `[unreplied-asks] thread refresh failed for ${copy.channelId}|${copy.ts} (threadTs=${copy.threadTs}): ${rep.error}`
    );
    maybeSetFirstSurfaced(copy, now);
    return { ok: false, entry: copy, error: rep.error };
  }
  applyLatestTsToEntry(copy, rep.latestTs);
  copy.reactions = extractAskReactions(rep.messages, copy.ts);
  copy.effectiveAssigneeSlackUserIds = computeEffectiveAssignees(
    rep.messages,
    copy.ts,
    founders
  );
  maybeSetFirstSurfaced(copy, now);
  return { ok: true, entry: copy };
}

export type RunUnrepliedAsksScanResult =
  | {
      ok: true;
      newClassified: number;
      threadRefreshes: number;
      /** How many thread-refresh calls returned a Slack error (channel_not_found, rate-limited, etc.). */
      threadErrors: number;
      founderCount: number;
    }
  | { ok: false; error: string };

type ClassifyCandidate = {
  id: string;
  personId: string;
  slackUserId: string;
  chKind: "channel" | "mpim";
  m: SlackUserMessageMatch;
};

/**
 * Incremental scan: new founder messages from search.messages → classify once →
 * thread stats for asks; refresh open asks for reply updates.
 */
export async function runUnrepliedAsksScan(
  people: Person[],
  options?: { onProgress?: (event: UnrepliedScanProgressEvent) => void }
): Promise<RunUnrepliedAsksScanResult> {
  const onProgress = options?.onProgress;

  const pairs = listFounderSlackPairs(people);
  if (pairs.length === 0) {
    return {
      ok: false,
      error:
        "No founders with Slack handles in the roster. Add slackHandle for cofounders (or NADAV_SLACK_USER_ID for Nadav).",
    };
  }

  const founderIds = new Set(pairs.map((p) => p.slackUserId));
  const now = new Date();
  const initial = await readUnrepliedAsks();
  const lookbackDays = clampLookbackDays(
    initial.lookbackDays ?? DEFAULT_UNREPLIED_LOOKBACK_DAYS
  );
  onProgress?.({ type: "init", lookbackDays });

  const founderNames = pairs.map(
    (pair) =>
      people.find((p) => p.id === pair.personId)?.name?.trim() || pair.personId
  );
  onProgress?.({ type: "founders", count: pairs.length, names: founderNames });

  const known = new Set(initial.entries.map((e) => e.id));
  const existingWatermarks: Record<string, string> = {
    ...(initial.founderWatermarks ?? {}),
  };
  const nextWatermarks: Record<string, string> = { ...existingWatermarks };
  let newClassified = 0;
  const candidates: ClassifyCandidate[] = [];

  for (let fi = 0; fi < pairs.length; fi++) {
    const { personId, slackUserId } = pairs[fi]!;
    const founderName = founderNames[fi] ?? personId;
    onProgress?.({
      type: "slack_search_start",
      founderIndex: fi + 1,
      founderTotal: pairs.length,
      founderName,
    });

    const watermarkTs = existingWatermarks[slackUserId] ?? "";
    const watermarkMs = watermarkTs ? slackTsMs(watermarkTs) : 0;

    // First-ever scan for this founder: backfill the default initial window.
    // Subsequent scans: fetch only messages newer than the stored watermark,
    // capped by `lookbackDays` so stale watermarks never cause huge re-fetches.
    const backfillDays = watermarkMs > 0
      ? Math.min(DEFAULT_INITIAL_BACKFILL_DAYS, lookbackDays)
      : DEFAULT_INITIAL_BACKFILL_DAYS;
    const afterMs = Math.max(
      watermarkMs,
      now.getTime() - backfillDays * 86_400_000
    );
    const afterYmdUtc = toYmdUtc(new Date(afterMs - 86_400_000));

    const history = await fetchSlackUserMessageHistory(slackUserId, {
      maxMessages: 200,
      maxPages: 5,
      skipOldestSweep: true,
      includeMentionSearch: false,
      afterYmdUtc,
    });
    if (!history.ok) {
      onProgress?.({ type: "error", message: history.error });
      return { ok: false, error: history.error };
    }

    let newThisFounder = 0;
    let newestTsThisFounder = watermarkTs;
    for (const m of history.messages) {
      const chKind = mapChannelKind(m.kind);
      if (!chKind) continue;
      if (m.authorSlackUserId !== slackUserId) continue;
      const msgMs = slackTsMs(m.ts);
      if (!msgMs) continue;
      // Hard filter: ts must be newer than watermark (Slack `after:` is
      // day-granular and exclusive at midnight; we want strictly-newer).
      if (msgMs <= watermarkMs) continue;
      // Also respect lookbackDays for first-ever scans (watermark == 0).
      if (!withinLookback(m.ts, lookbackDays, now)) continue;

      const id = entryId(m.channelId, m.ts);
      if (msgMs > slackTsMs(newestTsThisFounder || "0")) {
        newestTsThisFounder = m.ts;
      }
      if (known.has(id)) continue;
      known.add(id);
      candidates.push({ id, personId, slackUserId, chKind, m });
      newThisFounder += 1;
    }

    if (newestTsThisFounder && newestTsThisFounder !== watermarkTs) {
      nextWatermarks[slackUserId] = newestTsThisFounder;
    }

    onProgress?.({
      type: "slack_search_done",
      founderIndex: fi + 1,
      founderTotal: pairs.length,
      founderName,
      newMessagesThisFounder: newThisFounder,
      candidatesTotal: candidates.length,
    });
  }

  onProgress?.({ type: "classify_start", total: candidates.length });

  const classifiedAt = now.toISOString();

  function buildEntryFromClassification(
    c: ClassifyCandidate,
    classified:
      | { classification: "ask"; assigneeSlackUserId?: string }
      | { classification: "not_ask" }
      | { classification: "error" }
  ): AskEntry {
    const { m, id, personId, slackUserId, chKind } = c;
    // `search.messages` does not return `thread_ts`; derive the real thread
    // root from the permalink so in-thread replies get their parent's ts
    // (the permalink's `?thread_ts=` query param). Top-level messages still
    // resolve to themselves.
    const threadTs = resolveThreadTsFromPermalink(m.permalink, m.ts);
    const base = {
      id,
      founderSlackUserId: slackUserId,
      founderPersonId: personId,
      channelId: m.channelId,
      channelName: m.channelName,
      channelKind: chKind,
      ts: m.ts,
      threadTs,
      permalink: m.permalink,
      text: m.text,
      classifiedAt,
      hasExternalReply: false,
      state: "open" as const,
    };
    if (classified.classification === "ask") {
      return {
        ...base,
        classification: "ask",
        assigneeSlackUserId: classified.assigneeSlackUserId,
      };
    }
    return { ...base, classification: classified.classification };
  }

  // Classify in chunks of CHUNK_SIZE with CLASSIFY_CONCURRENCY parallel Claude
  // calls per chunk. After each chunk, checkpoint new classifications to Redis
  // so a crash / timeout loses at most one chunk of AI work. `known.has(id)`
  // dedupe on the next run skips already-saved ids automatically.
  const CLASSIFY_CONCURRENCY = 5;
  const CHUNK_SIZE = 25;
  let doneCount = 0;

  async function classifyChunk(chunk: ClassifyCandidate[]): Promise<AskEntry[]> {
    const chunkResults: (AskEntry | null)[] = new Array(chunk.length).fill(null);
    let chunkCursor = 0;

    async function worker(): Promise<void> {
      while (true) {
        const i = chunkCursor;
        chunkCursor += 1;
        if (i >= chunk.length) return;
        const c = chunk[i]!;
        const mentionIds = collectSlackUserIdsFromMessageText(c.m.text);
        const classified = await classifyMessage(
          c.m.text,
          c.m.channelName,
          c.m.kind,
          mentionIds
        );
        chunkResults[i] = buildEntryFromClassification(c, classified);
        doneCount += 1;
        onProgress?.({
          type: "classify_progress",
          done: doneCount,
          total: candidates.length,
        });
      }
    }

    const workerCount = Math.min(CLASSIFY_CONCURRENCY, chunk.length);
    if (workerCount > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
    return chunkResults.filter((e): e is AskEntry => e !== null);
  }

  for (let start = 0; start < candidates.length; start += CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + CHUNK_SIZE);
    const chunkEntries = await classifyChunk(chunk);
    if (chunkEntries.length === 0) continue;

    newClassified += chunkEntries.length;

    // Checkpoint: durably save this chunk's classifications before moving on.
    // Do NOT touch draft.lookbackDays here — the user may have changed it
    // mid-scan. The final persist stamps lookbackDays + lastScanAt once.
    await mutateUnrepliedAsks((draft) => {
      const map = new Map(draft.entries.map((e) => [e.id, e]));
      for (const p of chunkEntries) {
        if (!map.has(p.id)) map.set(p.id, p);
      }
      draft.entries = [...map.values()];
    });
  }

  // Thread refresh: poll every open ask within lookback on every scan.
  // Previously we gated this on "≥48 business hours old" to save API calls,
  // but that left a window where a reply could arrive, the UI would still
  // show the row until the ask crossed the threshold. Now we trust
  // `conversations.replies` for every open ask so replies always hide the
  // row on the next scan.
  const afterClassify = await readUnrepliedAsks();
  const toRefresh = afterClassify.entries.filter((e) => {
    if (e.classification !== "ask") return false;
    if (e.state !== "open") return false;
    if (!withinLookback(e.ts, lookbackDays, now)) return false;
    return true;
  });

  onProgress?.({ type: "threads_start", total: toRefresh.length });

  const THREADS_CHUNK_SIZE = 25;
  let threadsDoneCount = 0;
  let threadErrors = 0;

  for (let start = 0; start < toRefresh.length; start += THREADS_CHUNK_SIZE) {
    const chunk = toRefresh.slice(start, start + THREADS_CHUNK_SIZE);
    const refreshedChunk = new Map<string, AskEntry>();
    for (const e of chunk) {
      const outcome = await refreshAskEntry(e, founderIds, now);
      refreshedChunk.set(outcome.entry.id, outcome.entry);
      if (!outcome.ok) threadErrors += 1;
      threadsDoneCount += 1;
      onProgress?.({
        type: "threads_progress",
        done: threadsDoneCount,
        total: toRefresh.length,
      });
    }

    // Checkpoint after each chunk of thread refreshes.
    await mutateUnrepliedAsks((draft) => {
      const map = new Map(draft.entries.map((e) => [e.id, e]));
      for (const [id, ue] of refreshedChunk) {
        const prev = map.get(id);
        if (!prev || prev.state !== "open") continue;
        map.set(id, { ...ue, snoozeUntil: prev.snoozeUntil });
      }
      draft.entries = [...map.values()];
    });
  }
  const threadRefreshes = toRefresh.length;

  // Final persist: stamps lastScanAt, lookbackDays, and per-founder watermarks.
  // Entries are already saved by the per-chunk checkpoints above.
  onProgress?.({ type: "persist_start" });
  await mutateUnrepliedAsks((draft) => {
    draft.lastScanAt = now.toISOString();
    draft.lookbackDays = lookbackDays;
    // Merge watermarks: never regress (keep the max of existing vs. new).
    const merged: Record<string, string> = { ...(draft.founderWatermarks ?? {}) };
    for (const [sid, ts] of Object.entries(nextWatermarks)) {
      const prev = merged[sid] ?? "";
      if (slackTsMs(ts) > slackTsMs(prev)) merged[sid] = ts;
    }
    draft.founderWatermarks = merged;
  });
  onProgress?.({ type: "persist_done" });

  const result = {
    ok: true as const,
    newClassified,
    threadRefreshes,
    threadErrors,
    founderCount: pairs.length,
  };
  onProgress?.({
    type: "complete",
    newClassified,
    threadRefreshes,
    threadErrors,
    founderCount: pairs.length,
  });
  return result;
}
