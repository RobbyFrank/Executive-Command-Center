import { slackUserTokenForThreads } from "./tokens";

/** Parsed Slack thread permalink: channel + message/thread `ts`. */
export type ParsedSlackThreadUrl = { channelId: string; threadTs: string };

/**
 * Converts `p` + digits from an archives permalink to Slack message `ts` (`seconds.micro`).
 * @see https://api.slack.com/messaging/retrieving#individual_messages
 */
export function slackTsFromArchivesPDigits(pDigits: string): string | null {
  const d = pDigits.replace(/\D/g, "");
  if (d.length < 7) return null;
  return `${d.slice(0, -6)}.${d.slice(-6)}`;
}

/** Slack message `ts` as used in query params (`thread_ts`): `seconds.microseconds`. */
function slackMessageTsFromQueryParam(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+\.\d+$/.test(s)) return null;
  return s;
}

/**
 * Parses a Slack thread or message URL into `channelId` + `threadTs` for Web API calls.
 * Supports `…/archives/C…/p…` and `app.slack.com/.../thread/C…-ts` styles.
 * For archive links to a **reply inside a thread**, Slack adds `?thread_ts=…` with the **parent**
 * message ts; when present, that value is used so `conversations.replies` receives the thread root.
 */
export function parseSlackThreadUrl(raw: string): ParsedSlackThreadUrl | null {
  const t = raw.trim();
  if (!t) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const path = url.pathname;

  const threadSeg = path.match(/\/thread\/([CDG][A-Z0-9]+)-(\d+\.\d+)\/?$/i);
  if (threadSeg) {
    return { channelId: threadSeg[1], threadTs: threadSeg[2] };
  }

  const archives = path.match(
    /\/archives\/([CDG][A-Z0-9]+)\/p(\d+)\/?$/i
  );
  if (archives) {
    const ts = slackTsFromArchivesPDigits(archives[2]);
    if (!ts) return null;
    const rootFromQuery = slackMessageTsFromQueryParam(
      url.searchParams.get("thread_ts")
    );
    return { channelId: archives[1], threadTs: rootFromQuery ?? ts };
  }

  return null;
}

export type SlackThreadApiMessage = {
  ts: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
};

type ConversationsRepliesResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackThreadApiMessage[];
  response_metadata?: { next_cursor?: string };
};

function compareSlackTs(a: string, b: string): number {
  const da = parseFloat(a);
  const db = parseFloat(b);
  if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
  return a.localeCompare(b);
}

/**
 * Loads all messages in a thread via `conversations.replies` (paginated) using the user token.
 */
export async function fetchSlackThreadReplies(
  channelId: string,
  threadTs: string
): Promise<
  | {
      ok: true;
      messages: SlackThreadApiMessage[];
      /** Latest `ts` among all messages in the thread. */
      latestTs: string;
      /** Oldest `ts` in the thread (parent message) — use as `thread_ts` when posting. */
      rootTs: string;
      latestDate: Date;
    }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured for threads. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scopes channels:history, groups:history, and chat:write.",
    };
  }

  const collected: SlackThreadApiMessage[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("channel", channelId.trim());
    params.set("ts", threadTs.trim());
    params.set("limit", "200");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.replies?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return {
        ok: false,
        error: `Slack API request failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as ConversationsRepliesResponse;

    if (!data.ok) {
      const err = data.error ?? "unknown_error";
      if (err === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack token is missing a required scope (channels:history or groups:history). Add User Token Scopes and reinstall the app.",
        };
      }
      if (err === "channel_not_found") {
        return {
          ok: false,
          error:
            "Channel not found or you’re not a member — check the Slack URL and your workspace access.",
        };
      }
      if (err === "not_in_channel") {
        return {
          ok: false,
          error:
            "You’re not in this channel — join the channel in Slack or use a thread URL from a channel you can access.",
        };
      }
      return {
        ok: false,
        error: `Slack API error: ${err}`,
      };
    }

    collected.push(...(data.messages ?? []));

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  if (collected.length === 0) {
    return {
      ok: false,
      error: "No messages returned for this thread.",
    };
  }

  let latestTs = collected[0]!.ts;
  let rootTs = collected[0]!.ts;
  for (const m of collected) {
    if (compareSlackTs(m.ts, latestTs) > 0) latestTs = m.ts;
    if (compareSlackTs(m.ts, rootTs) < 0) rootTs = m.ts;
  }

  const sec = parseFloat(latestTs);
  const latestDate = Number.isFinite(sec)
    ? new Date(Math.floor(sec * 1000))
    : new Date();

  return {
    ok: true,
    messages: collected,
    latestTs,
    /** Parent / root message `ts` — use as `thread_ts` when posting replies. */
    rootTs,
    latestDate,
  };
}

/** Top-level channel message from `conversations.history` (thread replies excluded). */
export type SlackChannelHistoryMessage = {
  ts: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  /** Present on thread replies; parent has `thread_ts === ts`. */
  thread_ts?: string;
};

type ConversationsHistoryResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackChannelHistoryMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
};

/**
 * Fetches top-level channel messages via `conversations.history` (paginated) using the user token.
 * Thread replies are not included (only messages in the channel timeline).
 * Pass `oldestTs` to only include messages at or after that Slack `ts` (e.g. window start).
 */
export async function fetchSlackChannelHistory(
  channelId: string,
  options: {
    oldestTs?: string;
    /** Per request; Slack max is 1000. Default 200. */
    limitPerPage?: number;
    /** Stop after this many messages (across pages). Default 500. */
    maxMessages?: number;
  } = {}
): Promise<
  | { ok: true; messages: SlackChannelHistoryMessage[] }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured for history. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scopes channels:history and groups:history.",
    };
  }

  const limitPerPage = Math.min(
    Math.max(1, options.limitPerPage ?? 200),
    1000
  );
  const maxMessages = Math.max(1, options.maxMessages ?? 500);

  const collected: SlackChannelHistoryMessage[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("channel", channelId.trim());
    params.set("limit", String(limitPerPage));
    if (cursor) params.set("cursor", cursor);
    const oldest = options.oldestTs?.trim();
    if (oldest) params.set("oldest", oldest);

    const res = await fetch(
      `https://slack.com/api/conversations.history?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return {
        ok: false,
        error: `Slack API request failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as ConversationsHistoryResponse;

    if (!data.ok) {
      const err = data.error ?? "unknown_error";
      if (err === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack token is missing a required scope (channels:history or groups:history). Add User Token Scopes and reinstall the app.",
        };
      }
      if (err === "channel_not_found") {
        return {
          ok: false,
          error:
            "Channel not found or you’re not a member — check the channel and your workspace access.",
        };
      }
      if (err === "not_in_channel") {
        return {
          ok: false,
          error:
            "You’re not in this channel — join it in Slack or pick another channel.",
        };
      }
      return {
        ok: false,
        error: `Slack API error: ${err}`,
      };
    }

    const page = data.messages ?? [];
    for (const m of page) {
      if (!m?.ts) continue;
      if (m.thread_ts && m.thread_ts !== m.ts) continue;
      collected.push(m);
      if (collected.length >= maxMessages) break;
    }

    if (collected.length >= maxMessages) break;

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  collected.sort((a, b) => compareSlackTs(a.ts, b.ts));

  return { ok: true, messages: collected };
}

type ChatPostMessageResponse = {
  ok?: boolean;
  error?: string;
  ts?: string;
  channel?: string;
};

/**
 * Posts a new top-level channel message (starts a thread when others reply) as the Slack user.
 */
export async function postSlackChannelMessage(
  channelId: string,
  text: string
): Promise<
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scope chat:write.",
    };
  }

  const body = new URLSearchParams();
  body.set("channel", channelId.trim());
  body.set("text", text);

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ChatPostMessageResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token is missing chat:write (User Token Scope). Add it and reinstall the app.",
      };
    }
    if (err === "not_in_channel") {
      return {
        ok: false,
        error:
          "Cannot post — you’re not in this channel. Join it in Slack or pick another channel.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  const ts = (data.ts ?? "").trim();
  const ch = (data.channel ?? channelId).trim();
  if (!ts) {
    return { ok: false, error: "Slack did not return a message timestamp." };
  }

  return { ok: true, ts, channel: ch };
}

type ChatGetPermalinkResponse = {
  ok?: boolean;
  error?: string;
  permalink?: string;
};

/**
 * Returns a permalink URL for a message (`chat.getPermalink`).
 */
export async function getSlackMessagePermalink(
  channelId: string,
  messageTs: string
): Promise<{ ok: true; permalink: string } | { ok: false; error: string }> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-).",
    };
  }

  const params = new URLSearchParams();
  params.set("channel", channelId.trim());
  params.set("message_ts", messageTs.trim());

  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ChatGetPermalinkResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token cannot read permalinks. Ensure the user token has access to this channel.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  const permalink = (data.permalink ?? "").trim();
  if (!permalink) {
    return { ok: false, error: "Slack returned no permalink." };
  }

  return { ok: true, permalink };
}

/**
 * Posts a reply in a thread as the Slack user (user token `chat:write`).
 */
export async function postSlackThreadReply(
  channelId: string,
  threadTs: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scope chat:write.",
    };
  }

  const body = new URLSearchParams();
  body.set("channel", channelId.trim());
  body.set("thread_ts", threadTs.trim());
  body.set("text", text);

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ChatPostMessageResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token is missing chat:write (User Token Scope). Add it and reinstall the app.",
      };
    }
    if (err === "not_in_channel") {
      return {
        ok: false,
        error:
          "Cannot post — you’re not in this channel or the thread is inaccessible.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  return { ok: true };
}

type UsersInfoShortResponse = {
  ok?: boolean;
  error?: string;
  user?: { id?: string; name?: string; profile?: { real_name?: string; display_name?: string } };
};

/**
 * Resolves a Slack user id to a short display label (for thread previews). Uses the same
 * user token as thread APIs when provided.
 */
export async function fetchSlackUserLabelForToken(
  token: string,
  slackUserId: string
): Promise<string> {
  const id = slackUserId.trim();
  if (!id) return "Unknown";

  const params = new URLSearchParams();
  params.set("user", id);

  const res = await fetch(`https://slack.com/api/users.info?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) return id;

  const data = (await res.json()) as UsersInfoShortResponse;
  if (!data.ok || !data.user) return id;

  const profile = data.user.profile ?? {};
  const real = (profile.real_name ?? "").trim();
  const disp = (profile.display_name ?? "").trim();
  const name = (data.user.name ?? "").trim();
  return real || disp || name || id;
}
