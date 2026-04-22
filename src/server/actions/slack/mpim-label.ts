"use server";

import { fetchConversationMembers } from "@/lib/slack";
import { resolveSlackUserDisplays } from "./user-profile";
import {
  rosterMapFromHints,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";

export type ResolveMpimParticipantLabelResult =
  | { ok: true; label: string }
  | { ok: false; error: string };

/** Joins names Oxford-style: "Dave", "Dave & James", "Dave, James & Priya". */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  const last = names[names.length - 1]!;
  const head = names.slice(0, -1).join(", ");
  return `${head} & ${last}`;
}

/**
 * Resolve a Slack group DM (`mpim`) to a human-readable participant label.
 *
 * Slack doesn't store a topic or name for group DMs — `channel.name` is an
 * opaque `mpdm-…-1` string. The Followups UI needs to show something useful,
 * so we call `conversations.members` then resolve each user id to a display
 * name (Team roster first, then the cache-backed Slack user profile resolver
 * used elsewhere on the page — both cheap on repeat hits thanks to the 7-day
 * Redis cache in `resolveSlackUserDisplays`).
 *
 * Returned label matches the group-header convention: "Dave", "Dave & James",
 * "Dave, James & Priya". Bot users that end up in the DM (rare) fall through
 * the same resolver and are simply listed by whatever display name Slack
 * exposes for them.
 */
export async function resolveMpimParticipantLabel(
  channelId: string,
  rosterHints?: SlackMemberRosterHint[]
): Promise<ResolveMpimParticipantLabelResult> {
  const trimmed = channelId.trim();
  if (!trimmed) return { ok: false, error: "Missing channel id." };

  const members = await fetchConversationMembers(trimmed);
  if (!members.ok) return members;
  if (members.memberIds.length === 0) {
    return { ok: false, error: "No members returned for group DM." };
  }

  const rosterById = rosterMapFromHints(rosterHints);
  const resolved = await resolveSlackUserDisplays(members.memberIds);

  const names: string[] = [];
  for (const uid of members.memberIds) {
    const roster = rosterById.get(uid);
    const rosterName = roster?.name?.trim();
    const slackName = resolved[uid]?.name?.trim();
    const name = rosterName || slackName;
    if (name) names.push(name);
  }

  if (names.length === 0) {
    return { ok: false, error: "No resolvable names for group DM members." };
  }
  return { ok: true, label: joinNames(names) };
}
