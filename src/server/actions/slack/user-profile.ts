"use server";

import { slackUserTokenForThreads, slackToken } from "@/lib/slack/tokens";
import {
  readManySlackUserProfileCache,
  writeSlackUserProfileCache,
  type CachedSlackUserProfile,
} from "@/server/repository/slack-user-profile-cache";

export type SlackUserDisplay = {
  name: string;
  avatarSrc: string | null;
};

type UsersInfoProfile = {
  real_name?: string;
  display_name?: string;
  image_72?: string;
  image_48?: string;
};

/**
 * Resolve Slack user IDs to `{ name, avatarSrc }` with a **Redis cache (7d)**.
 *
 * - Cache hits are returned immediately.
 * - Misses call `users.info` per user (in parallel) and write back into Redis
 *   with a 7-day TTL. Failures fall through to a `{ name: uid, avatarSrc: null }`
 *   so callers always get a usable label.
 * - Tries the **thread user token** first when present, then **`SLACK_BOT_USER_OAUTH_TOKEN`**
 *   so names resolve even when no `xoxp-` token is configured (bot needs `users:read`).
 *
 * This is used by the **Followups** page (`/unreplied`) so off-roster assignees
 * still render a human name + photo without re-hitting Slack every scan.
 */
function tokensForUsersInfo(): string[] {
  return [
    ...new Set(
      [slackUserTokenForThreads(), slackToken()].filter(
        (t): t is string => Boolean(t?.trim())
      )
    ),
  ];
}

async function usersInfoDisplay(
  uid: string,
  token: string
): Promise<SlackUserDisplay | null> {
  try {
    const params = new URLSearchParams();
    params.set("user", uid);
    const res = await fetch(
      `https://slack.com/api/users.info?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      user?: { profile?: UsersInfoProfile };
    };
    if (!data.ok || !data.user?.profile) return null;
    const profile = data.user.profile;
    const real = (profile.real_name ?? "").trim();
    const disp = (profile.display_name ?? "").trim();
    const name = real || disp || uid;
    const avatarSrc =
      profile.image_72?.trim() ||
      profile.image_48?.trim() ||
      null;
    return { name, avatarSrc };
  } catch {
    return null;
  }
}

export async function resolveSlackUserDisplays(
  slackUserIds: string[]
): Promise<Record<string, SlackUserDisplay>> {
  const normalized = [
    ...new Set(
      slackUserIds.map((id) => id.trim().toUpperCase()).filter(Boolean)
    ),
  ];
  if (normalized.length === 0) return {};

  const cached = await readManySlackUserProfileCache(normalized);

  const out: Record<string, SlackUserDisplay> = {};
  for (const [id, p] of cached) {
    out[id] = { name: p.name, avatarSrc: p.avatarSrc };
  }

  const missing = normalized.filter((id) => !cached.has(id));
  if (missing.length === 0) return out;

  const apiTokens = tokensForUsersInfo();
  if (apiTokens.length === 0) {
    for (const id of missing) out[id] = { name: id, avatarSrc: null };
    return out;
  }

  await Promise.all(
    missing.map(async (uid) => {
      let resolved: SlackUserDisplay | null = null;
      for (const t of apiTokens) {
        resolved = await usersInfoDisplay(uid, t);
        if (resolved) break;
      }
      if (!resolved) {
        out[uid] = { name: uid, avatarSrc: null };
        return;
      }
      out[uid] = resolved;
      const toCache: Omit<CachedSlackUserProfile, "cachedAt"> = {
        name: resolved.name,
        avatarSrc: resolved.avatarSrc,
      };
      await writeSlackUserProfileCache(uid, toCache);
    })
  );

  return out;
}
