/**
 * Slack `users.conversations` + `conversations.invite` helpers for the onboarding flow.
 *
 * - `fetchUserChannelMemberships` lists the public/private channels a given Slack user id
 *   is a member of. We feed this to Claude as a signal when picking which channels to
 *   invite a new hire to (bias toward channels the recommended onboarding partners and
 *   same-department teammates actually use).
 * - `inviteUserToSlackChannel` wraps `conversations.invite` for a single user id and maps
 *   the common Slack error codes to friendly messages.
 *
 * Scopes (see `/docs/environment.md`):
 * - `users.conversations` — bot can list only channels the bot is in; for workspace-wide
 *   membership signals use the **user token** (already used for threads/MPIMs). We call
 *   `users.conversations?user=U...` with that token.
 * - `conversations.invite` requires `channels:write.invites` (public) and/or
 *   `groups:write.invites` (private) on the **user** token, **and** the calling user must
 *   already be a member of the channel they're inviting into.
 */

import { slackUserTokenForThreads } from "@/lib/slack";

type UsersConversationsResponse = {
  ok?: boolean;
  error?: string;
  channels?: Array<{ id: string; name?: string; is_private?: boolean }>;
  response_metadata?: { next_cursor?: string };
};

export type UserChannelMembership = {
  channelId: string;
  channelName: string;
  isPrivate: boolean;
};

/**
 * Paginated membership list for one Slack user id. Returns `{ ok: true, channels }` on
 * success; soft-fails with `{ ok: false }` on missing-scope/rate/404-type errors so the
 * caller can drop this user's signals without aborting the whole onboarding run.
 */
export async function fetchUserChannelMemberships(
  slackUserId: string,
  options?: {
    /** Hard cap on results per user; the `users.conversations` max is 1000 per page. */
    cap?: number;
  }
): Promise<
  | { ok: true; memberships: UserChannelMembership[] }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-).",
    };
  }
  const uid = slackUserId.trim().toUpperCase();
  if (!uid) return { ok: true, memberships: [] };

  const cap = Math.max(10, Math.min(1000, options?.cap ?? 200));
  const collected: UserChannelMembership[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 8; page++) {
    const params = new URLSearchParams();
    params.set("user", uid);
    params.set("types", "public_channel,private_channel");
    params.set("exclude_archived", "true");
    params.set("limit", String(Math.min(200, cap - collected.length)));
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/users.conversations?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `Slack users.conversations failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as UsersConversationsResponse;
    if (!data.ok) {
      if (data.error === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack user token is missing users:read / channels:read / groups:read for users.conversations.",
        };
      }
      return {
        ok: false,
        error: `Slack API error: ${data.error ?? "unknown"}`,
      };
    }

    for (const c of data.channels ?? []) {
      if (collected.length >= cap) break;
      const id = c.id?.trim();
      if (!id) continue;
      collected.push({
        channelId: id,
        channelName: (c.name ?? "").trim(),
        isPrivate: Boolean(c.is_private),
      });
    }

    if (collected.length >= cap) break;
    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  return { ok: true, memberships: collected };
}

type ConversationsInviteResponse = {
  ok?: boolean;
  error?: string;
  /** Slack returns per-user errors on partial success (rare when inviting a single user). */
  errors?: Array<{ user?: string; error?: string; ok?: boolean }>;
};

export type InviteOutcome =
  | { ok: true; alreadyInChannel: boolean }
  | { ok: false; error: string; code: InviteErrorCode };

export type InviteErrorCode =
  | "not_configured"
  | "missing_scope"
  | "channel_not_found"
  | "not_in_channel"
  | "cant_invite_self"
  | "user_is_bot"
  | "user_disabled"
  | "invalid_user"
  | "rate_limited"
  | "unknown";

/**
 * Invites a single Slack user id to a channel via `conversations.invite` using the OAuth
 * user token. Treats `already_in_channel` as a successful no-op. Maps common errors to a
 * short code so the UI can show a one-liner rather than the raw Slack error string.
 */
export async function inviteUserToSlackChannel(
  channelId: string,
  slackUserId: string
): Promise<InviteOutcome> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      code: "not_configured",
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-).",
    };
  }

  const cid = channelId.trim();
  const uid = slackUserId.trim().toUpperCase();
  if (!cid) {
    return { ok: false, code: "channel_not_found", error: "Channel id is empty." };
  }
  if (!uid) {
    return { ok: false, code: "invalid_user", error: "Slack user id is empty." };
  }

  const body = new URLSearchParams();
  body.set("channel", cid);
  body.set("users", uid);

  const res = await fetch("https://slack.com/api/conversations.invite", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (res.status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      error: "Slack rate limit hit for conversations.invite. Try again in a moment.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: "unknown",
      error: `Slack API request failed (${res.status}).`,
    };
  }

  const data = (await res.json()) as ConversationsInviteResponse;

  const perUserAlready = (data.errors ?? []).some(
    (e) => e.error === "already_in_channel"
  );
  if (data.ok || perUserAlready) {
    return { ok: true, alreadyInChannel: perUserAlready };
  }

  const err = (data.error ?? "unknown_error").trim();

  if (err === "already_in_channel") {
    return { ok: true, alreadyInChannel: true };
  }
  if (err === "missing_scope") {
    return {
      ok: false,
      code: "missing_scope",
      error:
        "Slack user token is missing channels:write.invites (public) or groups:write.invites (private). Add the scope and reinstall the app.",
    };
  }
  if (err === "channel_not_found" || err === "not_in_channel") {
    const isNotIn = err === "not_in_channel";
    return {
      ok: false,
      code: isNotIn ? "not_in_channel" : "channel_not_found",
      error: isNotIn
        ? "You are not a member of this channel, so Slack will not let you invite others. Join the channel first, then retry."
        : "Slack could not find that channel id.",
    };
  }
  if (err === "cant_invite_self") {
    return {
      ok: false,
      code: "cant_invite_self",
      error: "You cannot invite yourself to a channel.",
    };
  }
  if (err === "user_is_bot") {
    return {
      ok: false,
      code: "user_is_bot",
      error: "That Slack id belongs to a bot.",
    };
  }
  if (err === "user_disabled") {
    return {
      ok: false,
      code: "user_disabled",
      error: "That Slack user is deactivated.",
    };
  }
  if (err === "user_not_found" || err === "invalid_users") {
    return {
      ok: false,
      code: "invalid_user",
      error: "Slack does not recognize that user id.",
    };
  }
  return { ok: false, code: "unknown", error: `Slack API error: ${err}` };
}
