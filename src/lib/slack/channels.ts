import { slackTokenForConversationsList } from "./tokens";

export type SlackChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
  /** Number of members in the channel; -1 when unavailable. */
  memberCount: number;
  topic: string;
  purpose: string;
};

type SlackApiChannel = {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
};

type ConversationsListResponse = {
  ok?: boolean;
  error?: string;
  channels?: SlackApiChannel[];
  response_metadata?: { next_cursor?: string };
};

function mapChannel(c: SlackApiChannel): SlackChannel | null {
  if (c.is_archived) return null;
  if (c.is_im || c.is_mpim) return null;
  return {
    id: c.id,
    name: (c.name ?? "").trim(),
    isPrivate: Boolean(c.is_private || c.is_group),
    memberCount: typeof c.num_members === "number" ? c.num_members : -1,
    topic: (c.topic?.value ?? "").trim(),
    purpose: (c.purpose?.value ?? "").trim(),
  };
}

function conversationsListErrorMessage(error: string | undefined): string {
  if (error === "missing_scope") {
    return "Slack token is missing a required scope (channels:read, groups:read).";
  }
  return error ? `Slack API error: ${error}` : "Slack API returned an error.";
}

/**
 * Paginates `conversations.list` for one or more comma-separated `types` values
 * (e.g. `public_channel`, `private_channel`, or `public_channel,private_channel`).
 */
async function fetchConversationsListByTypesParam(
  token: string,
  typesParam: string
): Promise<
  | { ok: true; channels: SlackApiChannel[] }
  | { ok: false; error: string }
> {
  const collected: SlackApiChannel[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("types", typesParam);
    params.set("exclude_archived", "true");
    params.set("limit", "200");
    params.set("include_num_members", "true");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.list?${params.toString()}`,
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

    const data = (await res.json()) as ConversationsListResponse;

    if (!data.ok) {
      return { ok: false, error: conversationsListErrorMessage(data.error) };
    }

    collected.push(...(data.channels ?? []));

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  return { ok: true, channels: collected };
}

function mergeMappedSlackChannels(raws: SlackApiChannel[]): SlackChannel[] {
  const byId = new Map<string, SlackChannel>();
  for (const raw of raws) {
    const ch = mapChannel(raw);
    if (ch) byId.set(ch.id, ch);
  }
  const collected = [...byId.values()];
  collected.sort((a, b) => a.name.localeCompare(b.name));
  return collected;
}

export type FetchSlackChannelsResult =
  | { ok: true; channels: SlackChannel[]; notice?: string }
  | { ok: false; error: string };

/**
 * Fetches public and private channels the bot can access via `conversations.list`.
 * Prefer a single paginated run with `types=public_channel,private_channel`; falls back
 * to separate runs, then merges by channel id. If the private list cannot be loaded
 * (e.g. missing `groups:read`), still returns public channels with an optional `notice`.
 * With a **bot** token, the bot must be **in** a private channel for Slack to return it.
 * With a **user** token (`SLACK_CHANNEL_LIST_USER_TOKEN` or `SLACK_BILLING_USER_TOKEN`),
 * Slack returns channels that **user** can access (typical for an admin workspace token).
 * Requires `channels:read` and `groups:read` on whichever token is used (bot or user scopes).
 */
export async function fetchSlackChannels(): Promise<FetchSlackChannelsResult> {
  const token = slackTokenForConversationsList();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack is not configured. Set SLACK_BOT_USER_OAUTH_TOKEN, or a user token (SLACK_CHANNEL_LIST_USER_TOKEN or SLACK_BILLING_USER_TOKEN) for channel listing.",
    };
  }

  const combined = await fetchConversationsListByTypesParam(
    token,
    "public_channel,private_channel"
  );
  if (combined.ok) {
    return {
      ok: true,
      channels: mergeMappedSlackChannels(combined.channels),
    };
  }

  const publicResult = await fetchConversationsListByTypesParam(
    token,
    "public_channel"
  );
  if (!publicResult.ok) return publicResult;

  const privateResult = await fetchConversationsListByTypesParam(
    token,
    "private_channel"
  );

  if (privateResult.ok) {
    return {
      ok: true,
      channels: mergeMappedSlackChannels([
        ...publicResult.channels,
        ...privateResult.channels,
      ]),
    };
  }

  const notice =
    privateResult.error.includes("missing_scope") ||
    privateResult.error.includes("groups:read")
      ? "Private channels are not listed: add the groups:read scope to the Slack app and reinstall it to the workspace."
      : `Private channels could not be listed (${privateResult.error}). Public channels are shown below.`;

  return {
    ok: true,
    channels: mergeMappedSlackChannels(publicResult.channels),
    notice,
  };
}
