/**
 * Client-safe relative-time helpers for Slack thread freshness signals
 * (e.g. "1d ago" next to a colored status dot on collapsed goal rows).
 *
 * Mirrors {@link formatShortRelative} in `src/server/actions/slack/thread-ai-shared.ts`
 * but is a plain pure function with no server-only imports so it can be used from the
 * Roadmap UI without pulling the Anthropic SDK into the client bundle.
 */

import { readSlackThreadStatusCache } from "@/lib/slackThreadStatusCache";
import type { SlackMemberRosterHint } from "@/server/actions/slack";

export const SLACK_THREAD_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * "just now" / "`12m ago`" / "`3h ago`" / "`2d ago`" / absolute `toLocaleDateString()` for older.
 * Kept in lockstep with the server's `formatShortRelative` so goal-level freshness labels read
 * identically to milestone-row ones.
 */
export function formatShortRelativeSince(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 21) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Recomputes the cache key used by {@link useSlackThreadStatus} so callers outside of that hook
 * can read the same cache entries without rewriting the keying rule. Keep in sync with
 * `src/hooks/useSlackThreadStatus.ts` (`statusCacheKey` memo).
 */
export function slackThreadStatusCacheKey(
  slackUrl: string,
  rosterHints: SlackMemberRosterHint[]
): string {
  if (!slackUrl) return "";
  if (rosterHints.length === 0) return slackUrl;
  const sig = rosterHints
    .map((h) => h.slackUserId)
    .sort()
    .join(",");
  return `${slackUrl}::team:${sig}`;
}

export type SlackThreadFreshnessSignal = {
  /** ISO timestamp of the most recent reply across the sampled threads. */
  lastReplyAt: string;
  /** True iff **every** sampled thread is older than {@link SLACK_THREAD_STALE_MS}. */
  isStale: boolean;
  /** Threads with cached status that contributed to this signal. */
  threadsConsidered: number;
};

/**
 * Reads cached {@link SlackThreadStatusOk} entries for each URL and returns the freshest
 * "last reply" timestamp plus a collective stale flag. Returns `null` when no cached status is
 * available yet (e.g. first visit — rows are still hydrating their own thread status). Callers
 * should treat this as a best-effort hint that updates cheaply as rows hydrate.
 */
export function readSlackThreadFreshness(
  slackUrls: string[],
  rosterHints: SlackMemberRosterHint[]
): SlackThreadFreshnessSignal | null {
  let newestMs = -Infinity;
  let newestIso = "";
  let allStale = true;
  let considered = 0;

  for (const raw of slackUrls) {
    const u = raw.trim();
    if (!u) continue;
    const key = slackThreadStatusCacheKey(u, rosterHints);
    const hit = readSlackThreadStatusCache(key);
    if (!hit) continue;
    considered += 1;
    if (!hit.isStale) allStale = false;
    const ms = Date.parse(hit.lastReplyAt);
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newestIso = hit.lastReplyAt;
    }
  }

  if (considered === 0 || !newestIso) return null;
  return {
    lastReplyAt: newestIso,
    isStale: allStale,
    threadsConsidered: considered,
  };
}
