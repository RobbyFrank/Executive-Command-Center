"use server";

import { rosterMapFromHints, type SlackMemberRosterHint } from "./thread-ai-shared";
import { resolveSlackUserDisplays } from "./user-profile";

export type SlackMentionPreviewDisplay = {
  name: string;
  avatarSrc: string | null;
};

/**
 * Resolves Slack user IDs in draft text for the in-app preview: display name and avatar.
 *
 * Prefers Team roster entries (roster name + **local** profile photo path) so the
 * chip matches the rest of the roster UI. For off-roster users (guests, Slack Connect
 * from other workspaces, etc.), delegates to `resolveSlackUserDisplays` which is
 * **cache-backed (Redis 7d)** and tries **both** the user token and the bot token
 * — the same resolver the Followups page uses for group-header avatars, so anything
 * that resolves there also resolves in mention chips.
 */
export async function resolveSlackMentionPreviewDisplays(
  userIds: string[],
  rosterHints?: SlackMemberRosterHint[]
): Promise<Record<string, SlackMentionPreviewDisplay>> {
  const normalized = [
    ...new Set(userIds.map((id) => id.trim().toUpperCase()).filter(Boolean)),
  ];
  if (normalized.length === 0) return {};

  const rosterById = rosterMapFromHints(rosterHints);
  const out: Record<string, SlackMentionPreviewDisplay> = {};
  const offRoster: string[] = [];

  for (const uid of normalized) {
    const roster = rosterById.get(uid);
    const rosterPath = roster?.profilePicturePath?.trim();
    const rosterName = roster?.name?.trim();
    if (rosterPath && rosterName) {
      out[uid] = { name: rosterName, avatarSrc: rosterPath };
      continue;
    }
    offRoster.push(uid);
  }

  if (offRoster.length === 0) return out;

  const slackDisplays = await resolveSlackUserDisplays(offRoster);
  for (const uid of offRoster) {
    const rosterHit = rosterById.get(uid);
    const rosterPath = rosterHit?.profilePicturePath?.trim();
    const rosterName = rosterHit?.name?.trim();
    const slack = slackDisplays[uid];
    // Prefer Slack-resolved name/avatar when the roster hint is sparse; fall
    // back to the roster hint; finally fall back to the bare UID so the chip
    // always renders something readable.
    const name = slack?.name?.trim() || rosterName || uid;
    const avatarSrc = rosterPath || slack?.avatarSrc || null;
    out[uid] = { name, avatarSrc };
  }

  return out;
}
