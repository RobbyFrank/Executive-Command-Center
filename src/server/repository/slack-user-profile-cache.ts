import { getSharedRedisClient } from "./tracker-storage";

/**
 * Cached Slack user display for assignees not on the Team roster.
 *
 * Used by the Followups wall so off-roster assignees still get a human name
 * and avatar without hammering `users.info` on every render. Shape intentionally
 * minimal — we only surface what the UI needs.
 */
export type CachedSlackUserProfile = {
  /** Human display name (`real_name` / `display_name`), or the Slack user id when unknown. */
  name: string;
  /** Slack CDN URL for the profile photo. `null` when Slack didn't return one. */
  avatarSrc: string | null;
  /** ISO timestamp (populated for debugging / future TTL overrides). */
  cachedAt: string;
};

/** 7 days. Per request: don't re-fetch the same user more often than this. */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

function keyFor(slackUserId: string): string {
  return `ecc:slackUser:profile:${slackUserId.trim().toUpperCase()}`;
}

export async function readSlackUserProfileCache(
  slackUserId: string
): Promise<CachedSlackUserProfile | null> {
  const id = slackUserId.trim().toUpperCase();
  if (!id) return null;
  try {
    const raw = await getSharedRedisClient().get(keyFor(id));
    if (raw == null) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { name?: unknown }).name === "string"
    ) {
      const p = parsed as Partial<CachedSlackUserProfile>;
      return {
        name: p.name ?? id,
        avatarSrc: typeof p.avatarSrc === "string" ? p.avatarSrc : null,
        cachedAt: typeof p.cachedAt === "string" ? p.cachedAt : "",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function writeSlackUserProfileCache(
  slackUserId: string,
  profile: Omit<CachedSlackUserProfile, "cachedAt">
): Promise<void> {
  const id = slackUserId.trim().toUpperCase();
  if (!id) return;
  const payload: CachedSlackUserProfile = {
    ...profile,
    cachedAt: new Date().toISOString(),
  };
  try {
    await getSharedRedisClient().set(keyFor(id), JSON.stringify(payload), {
      ex: CACHE_TTL_SECONDS,
    });
  } catch {
    /* cache miss on failure is fine */
  }
}

/** Batch helper for the snapshot builder — O(N) round trips; N is tiny for typical workspaces. */
export async function readManySlackUserProfileCache(
  slackUserIds: string[]
): Promise<Map<string, CachedSlackUserProfile>> {
  const normalized = [
    ...new Set(
      slackUserIds.map((id) => id.trim().toUpperCase()).filter(Boolean)
    ),
  ];
  const out = new Map<string, CachedSlackUserProfile>();
  await Promise.all(
    normalized.map(async (id) => {
      const p = await readSlackUserProfileCache(id);
      if (p) out.set(id, p);
    })
  );
  return out;
}
