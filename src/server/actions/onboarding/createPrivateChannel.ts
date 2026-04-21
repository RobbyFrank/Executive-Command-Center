"use server";

import { getSession } from "@/server/auth";
import { slackUserTokenForThreads } from "@/lib/slack";
import type { SlackChannel } from "@/lib/slack";

/**
 * Slack channel names: lowercase letters, digits, hyphens, underscores, dots; ≤80 chars.
 * https://api.slack.com/methods/conversations.create#naming
 *
 * We deliberately don't auto-slugify: if the founder types an invalid name we surface the
 * Slack error so they can fix it themselves (punctuation, spaces, duplicates).
 */
const SLACK_CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

type ConversationsCreateResponse = {
  ok?: boolean;
  error?: string;
  channel?: {
    id: string;
    name: string;
    is_private?: boolean;
    is_archived?: boolean;
    num_members?: number;
    topic?: { value?: string };
    purpose?: { value?: string };
  };
};

export type CreatePrivateChannelResult =
  | { ok: true; channel: SlackChannel }
  | { ok: false; error: string; code: CreatePrivateChannelErrorCode };

export type CreatePrivateChannelErrorCode =
  | "unauthorized"
  | "not_configured"
  | "invalid_name"
  | "name_taken"
  | "missing_scope"
  | "rate_limited"
  | "unknown";

/**
 * Creates a **private** Slack channel via `conversations.create` (no public channels — by
 * product design, onboarding-time invites should bias toward private-context rooms). The
 * OAuth user becomes the channel creator and is automatically a member, which is required
 * for the subsequent `conversations.invite` call.
 *
 * Required Slack user-token scopes: `groups:write` (create + manage private channels).
 * Public-channel creation would additionally need `channels:manage`, but this action
 * hard-codes `is_private=true`.
 */
export async function createPrivateSlackChannelForOnboarding(input: {
  name: string;
}): Promise<CreatePrivateChannelResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, code: "unauthorized", error: "Sign in required." };
  }

  const rawName = (input.name ?? "").trim().toLowerCase();
  if (!rawName) {
    return { ok: false, code: "invalid_name", error: "Channel name is required." };
  }
  if (!SLACK_CHANNEL_NAME_RE.test(rawName)) {
    return {
      ok: false,
      code: "invalid_name",
      error:
        "Slack channel names must be lowercase, 1–80 characters, and can only contain letters, digits, hyphens, underscores, and dots.",
    };
  }

  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      code: "not_configured",
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-).",
    };
  }

  const body = new URLSearchParams();
  body.set("name", rawName);
  body.set("is_private", "true");

  const res = await fetch("https://slack.com/api/conversations.create", {
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
      error: "Slack rate-limited conversations.create. Try again in a moment.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: "unknown",
      error: `Slack API request failed (${res.status}).`,
    };
  }

  const data = (await res.json()) as ConversationsCreateResponse;
  if (!data.ok || !data.channel) {
    const err = (data.error ?? "unknown_error").trim();
    if (err === "name_taken") {
      return {
        ok: false,
        code: "name_taken",
        error: "A Slack channel with that name already exists. Pick another name.",
      };
    }
    if (err === "invalid_name" || err.startsWith("invalid_name_")) {
      return {
        ok: false,
        code: "invalid_name",
        error:
          "Slack rejected that channel name. Use lowercase letters, digits, hyphens, or underscores only.",
      };
    }
    if (err === "missing_scope") {
      return {
        ok: false,
        code: "missing_scope",
        error:
          "Slack user token is missing groups:write. Add the scope and reinstall the Slack app to create private channels.",
      };
    }
    return { ok: false, code: "unknown", error: `Slack API error: ${err}` };
  }

  const ch = data.channel;
  const created: SlackChannel = {
    id: ch.id,
    name: ch.name,
    isPrivate: Boolean(ch.is_private ?? true),
    memberCount: typeof ch.num_members === "number" ? ch.num_members : 1,
    topic: (ch.topic?.value ?? "").trim(),
    purpose: (ch.purpose?.value ?? "").trim(),
  };

  return { ok: true, channel: created };
}
