/**
 * Slack `search.messages` helpers for roster enrichment (self posts + @mentions).
 *
 * Used by the Team roster Slack enrichment pipeline (Import from Slack / Refresh all)
 * to infer **Role** + **Department** from what the person actually says in Slack, and
 * to pick up a **Join Date** from their oldest surviving message when Slack profile
 * data (`users.profile.get` `start_date` + custom fields) did not yield one.
 *
 * Requires a **user OAuth token** (xoxp-, not bot) with User Token Scope `search:read`.
 * Bot tokens cannot call `search.messages` — Slack returns `not_allowed_token_type`.
 *
 * @see https://docs.slack.dev/reference/methods/search.messages
 */
import { slackUserTokenForThreads } from "./tokens";

/**
 * Conversation kind for a single search hit, normalized from `search.messages`'s
 * `type` / `channel.*` fields:
 *  - `"channel"` — public or private channel (we keep the name in `channelName`)
 *  - `"im"` — 1:1 DM. Slack stuffs the *target user's user ID* into `channel.name`, so
 *    `channelName` is effectively useless for DM signal; callers should check `kind`.
 *  - `"mpim"` — group DM (3-8 people). `channel.name` is Slack-generated (`mpdm-…-1`).
 *  - `"group"` — legacy private group / thread (rare today).
 *
 * Knowing this lets the role/department AI distinguish "DM traffic" from "channel
 * traffic" so it doesn't misread `channel.name` for DMs as a topic hint — and so
 * DM-dominant users (e.g. brand-new hires who only message their manager) still
 * get a confident guess rather than being penalized for lacking channel-name signal.
 */
export type SlackUserMessageKind = "channel" | "im" | "mpim" | "group";

/** Minimal message shape returned by `search.messages` that we care about. */
export type SlackUserMessageMatch = {
  ts: string;
  text: string;
  channelId: string;
  /**
   * For channels / groups: the human-readable channel name (no `#`).
   * For `kind === "im"`: the **target user ID** (Slack quirk) — generally not a useful
   * topic hint; treat as opaque.
   * For `kind === "mpim"`: Slack-generated (`mpdm-…-1`); also not a topic hint.
   */
  channelName: string;
  kind: SlackUserMessageKind;
  /** Permalink to the Slack message (useful for debugging / future UI). */
  permalink: string;
  /**
   * Slack user ID of the message author (`search.messages` match `user`), uppercased.
   * Empty when Slack omitted it — treat as unknown author for join-date filtering.
   */
  authorSlackUserId: string;
};

type SearchMessagesMatch = {
  ts?: string;
  text?: string;
  user?: string;
  permalink?: string;
  /** `"message"` (channel), `"im"` (DM), `"mpim"` (group DM), `"group"` (legacy). */
  type?: string;
  channel?: {
    id?: string;
    name?: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    is_group?: boolean;
  };
};

function classifyKind(m: SearchMessagesMatch): SlackUserMessageKind {
  const t = (m.type ?? "").toLowerCase();
  if (t === "im" || m.channel?.is_im) return "im";
  if (t === "mpim" || m.channel?.is_mpim) return "mpim";
  if (t === "group" || m.channel?.is_group) return "group";
  return "channel";
}

type SearchMessagesResponse = {
  ok?: boolean;
  error?: string;
  messages?: {
    matches?: SearchMessagesMatch[];
    pagination?: {
      page?: number;
      page_count?: number;
      total_count?: number;
    };
  };
};

function compareTs(a: string, b: string): number {
  const da = parseFloat(a);
  const db = parseFloat(b);
  if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
  return a.localeCompare(b);
}

/**
 * Fetches Slack message context for roster enrichment via `search.messages`.
 *
 * **From-self query** (`from:<@USERID>`):
 *  - **desc** — recent messages by the person (role signal + recency).
 *  - **asc** — oldest self message (join-date fallback), unless `skipOldestSweep`.
 *
 * **Mention query** (`<@USERID>`) — **desc only**: teammate messages that @-mention
 * the person (welcome intros, role announcements in group DMs). Never used for join-date
 * oldest-ts (see `authorSlackUserId` filtering in `buildSlackMessageEnrichmentForUser`).
 *
 * Results are de-duplicated by `channelId|ts` and returned **ascending by `ts`**.
 */
export async function fetchSlackUserMessageHistory(
  slackUserId: string,
  options: {
    /** Soft target for the recent (desc) sweep. Default 60. Slack caps `count` at 100 per page. */
    maxMessages?: number;
    /** Max pages per sweep. Default 2. Each page is up to 100 results. */
    maxPages?: number;
    /** When true, skip the ascending (oldest) sweep — caller already has a join date. */
    skipOldestSweep?: boolean;
    /**
     * When false, skip the `<@USERID>` mention search (saves API calls when the caller
     * only needs join-date from self messages). Default true.
     */
    includeMentionSearch?: boolean;
    /**
     * When set, appends `after:YYYY-MM-DD` to every `search.messages` query. Slack
     * restricts the result set server-side. Use for watermark-based incremental
     * scans (only fetch messages newer than what we already have).
     *
     * `after:YYYY-MM-DD` is **exclusive** on Slack's side — messages at midnight
     * UTC on that date are excluded — so callers who already have a precise
     * watermark timestamp should subtract one day and additionally filter
     * in-memory by `ts > watermark`.
     */
    afterYmdUtc?: string;
  } = {}
): Promise<
  | { ok: true; messages: SlackUserMessageMatch[] }
  | { ok: false; error: string; missingScope?: boolean }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scope search:read.",
    };
  }

  const uid = slackUserId.trim().toUpperCase();
  if (!uid) {
    return { ok: false, error: "Slack user id is empty." };
  }

  const maxMessages = Math.min(Math.max(1, options.maxMessages ?? 60), 200);
  const maxPages = Math.min(Math.max(1, options.maxPages ?? 2), 5);
  const perPage = Math.min(maxMessages, 100);
  const afterClause =
    options.afterYmdUtc && /^\d{4}-\d{2}-\d{2}$/.test(options.afterYmdUtc)
      ? ` after:${options.afterYmdUtc}`
      : "";
  const queryFromSelf = `from:<@${uid}>${afterClause}`;
  const queryMentions = `<@${uid}>${afterClause}`;

  const seenKeys = new Set<string>();
  const collected: SlackUserMessageMatch[] = [];

  function dedupeKey(channelId: string, ts: string): string {
    return `${channelId || "_"}|${ts}`;
  }

  /**
   * Run one paginated sweep in a given sort direction. Each sweep is capped by its own
   * `sweepBudget` so a single direction doesn't consume the whole result set — this is
   * important because we always want some oldest-message signal in there for the
   * join-date fallback, not just the newest chatter.
   */
  async function sweep(
    query: string,
    sortDir: "asc" | "desc",
    sweepBudget: number,
    /** When Slack omits `user`, treat the hit as authored by this person (for `from:` queries). */
    assumeAuthorIfMissing?: string
  ): Promise<
    | { ok: true }
    | { ok: false; error: string; missingScope?: boolean }
  > {
    let addedThisSweep = 0;
    for (let page = 1; page <= maxPages; page++) {
      if (addedThisSweep >= sweepBudget) return { ok: true };

      const params = new URLSearchParams();
      params.set("query", query);
      params.set("count", String(perPage));
      params.set("sort", "timestamp");
      params.set("sort_dir", sortDir);
      params.set("page", String(page));

      const res = await fetch(
        `https://slack.com/api/search.messages?${params.toString()}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      if (!res.ok) {
        return {
          ok: false,
          error: `Slack search.messages request failed (${res.status}).`,
        };
      }

      const data = (await res.json()) as SearchMessagesResponse;
      if (!data.ok) {
        const err = data.error ?? "unknown_error";
        console.warn(
          `[slack-search] ${uid}: search.messages returned not ok — error="${err}" q=${query.slice(0, 24)}… sort=${sortDir} page=${page}`
        );
        if (err === "missing_scope") {
          return {
            ok: false,
            missingScope: true,
            error:
              "Slack search.messages is missing User Token Scope search:read. Add it and reinstall the app.",
          };
        }
        if (err === "not_allowed_token_type") {
          return {
            ok: false,
            missingScope: true,
            error:
              "Slack search.messages requires a user OAuth token (xoxp-). Bot tokens are not accepted.",
          };
        }
        return {
          ok: false,
          error: `Slack API error: ${err}`,
        };
      }

      const matches = data.messages?.matches ?? [];
      for (const m of matches) {
        const ts = (m.ts ?? "").trim();
        const channelId = (m.channel?.id ?? "").trim();
        const key = dedupeKey(channelId, ts);
        if (!ts || !channelId || seenKeys.has(key)) continue;
        seenKeys.add(key);
        const text = (m.text ?? "").trim();
        const channelName = (m.channel?.name ?? "").trim();
        const permalink = (m.permalink ?? "").trim();
        const kind = classifyKind(m);
        const rawAuthor = (m.user ?? "").trim().toUpperCase();
        const authorSlackUserId =
          rawAuthor ||
          (assumeAuthorIfMissing ?? "").trim().toUpperCase();
        collected.push({
          ts,
          text,
          channelId,
          channelName,
          kind,
          permalink,
          authorSlackUserId,
        });
        addedThisSweep += 1;
        if (addedThisSweep >= sweepBudget) break;
      }

      const pageInfo = data.messages?.pagination;
      const pageCount = pageInfo?.page_count ?? 1;
      if (matches.length === 0 || page >= pageCount) break;
    }
    return { ok: true };
  }

  /**
   * Reserve ~1/6 of the budget for the oldest-message sweep so even when the desc
   * sweep fills up, we still capture a first-ever message for the join-date fallback.
   * When the caller skips the oldest sweep, desc gets the whole budget.
   */
  const oldestBudget = options.skipOldestSweep
    ? 0
    : Math.min(10, Math.max(5, Math.floor(maxMessages / 6)));
  const recentBudget = Math.max(1, maxMessages - oldestBudget);
  /** Mentions (teammate intros, etc.): recent only — never used for join-date oldest. */
  const mentionBudget = Math.min(
    40,
    Math.max(12, Math.floor(maxMessages * 0.38))
  );

  const descResult = await sweep(
    queryFromSelf,
    "desc",
    recentBudget,
    uid
  );
  if (!descResult.ok) return descResult;

  if (oldestBudget > 0) {
    const ascResult = await sweep(
      queryFromSelf,
      "asc",
      oldestBudget,
      uid
    );
    if (!ascResult.ok) return ascResult;
  }

  const wantMentions = options.includeMentionSearch !== false;
  if (wantMentions) {
    const mentionResult = await sweep(queryMentions, "desc", mentionBudget);
    if (!mentionResult.ok) return mentionResult;
  }

  collected.sort((a, b) => compareTs(a.ts, b.ts));

  const kindCounts = collected.reduce(
    (acc, m) => {
      acc[m.kind] = (acc[m.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<SlackUserMessageKind, number>
  );
  const kindBreakdown = (Object.keys(kindCounts) as SlackUserMessageKind[])
    .map((k) => `${k}=${kindCounts[k]}`)
    .join(" ");
  const selfAuthored = collected.filter((m) => m.authorSlackUserId === uid).length;
  const fromMentions = collected.length - selfAuthored;
  console.log(
    `[slack-search] ${uid}: search.messages merged ${collected.length} messages` +
      ` (self-authored≈${selfAuthored}, other-author/mention-hits≈${fromMentions})` +
      (kindBreakdown ? ` [${kindBreakdown}]` : "") +
      (collected.length > 0
        ? ` (oldest ts=${collected[0]!.ts}, newest ts=${
            collected[collected.length - 1]!.ts
          })`
        : "")
  );

  return { ok: true, messages: collected };
}

/** Converts a Slack `ts` (`seconds.micro`) to a roster `joinDate` (`YYYY-MM-DD`, UTC). */
export function slackTsToYmdUtc(ts: string): string {
  const sec = parseFloat(ts);
  if (!Number.isFinite(sec)) return "";
  const d = new Date(Math.floor(sec * 1000));
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
