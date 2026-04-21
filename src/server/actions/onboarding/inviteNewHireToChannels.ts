"use server";

import {
  inviteUserToSlackChannel,
  type InviteErrorCode,
} from "@/lib/slack/memberships";

export type ChannelInviteResult =
  | {
      ok: true;
      channelId: string;
      channelName: string;
      alreadyInChannel: boolean;
    }
  | {
      ok: false;
      channelId: string;
      channelName: string;
      code: InviteErrorCode;
      error: string;
    };

/**
 * Invites a single Slack user to each requested channel sequentially (Slack rate-limits
 * `conversations.invite` Tier 3 — keep this one-at-a-time instead of Promise.all). Returns
 * a per-channel result array so the UI can show success/failure inline.
 */
export async function inviteNewHireToSlackChannels(input: {
  newHireSlackUserId: string;
  channels: Array<{ channelId: string; channelName: string }>;
}): Promise<{
  ok: true;
  results: ChannelInviteResult[];
}> {
  const uid = input.newHireSlackUserId.trim().toUpperCase();
  const channels = (input.channels ?? [])
    .map((c) => ({
      channelId: (c.channelId ?? "").trim(),
      channelName: (c.channelName ?? "").trim(),
    }))
    .filter((c) => c.channelId.length > 0);

  if (!uid || channels.length === 0) {
    return { ok: true, results: [] };
  }

  const seen = new Set<string>();
  const results: ChannelInviteResult[] = [];
  for (const ch of channels) {
    if (seen.has(ch.channelId)) continue;
    seen.add(ch.channelId);

    const r = await inviteUserToSlackChannel(ch.channelId, uid);
    if (r.ok) {
      results.push({
        ok: true,
        channelId: ch.channelId,
        channelName: ch.channelName,
        alreadyInChannel: r.alreadyInChannel,
      });
    } else {
      results.push({
        ok: false,
        channelId: ch.channelId,
        channelName: ch.channelName,
        code: r.code,
        error: r.error,
      });
    }
  }
  return { ok: true, results };
}
