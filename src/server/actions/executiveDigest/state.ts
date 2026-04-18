import { getSharedRedisClient } from "@/server/repository/tracker-storage";

/** Redis key holding metadata from the most recent successful digest post. */
export const EXECUTIVE_DIGEST_STATE_KEY = "ecc:digest:exec:last";

/**
 * Persisted after every successful post. `bulletHashes` feeds the next day's
 * prompt + a hard dedupe pass so the digest never repeats yesterday's items.
 */
export interface ExecutiveDigestState {
  /** ISO timestamp of the most recent successful digest post. */
  postedAt: string;
  /** Slack `ts` of the posted top-level message (for debugging / permalinks). */
  slackTs: string | null;
  /** Slack `ts` marking the right edge of the window analyzed on the last run. */
  lastAnalyzedSlackTs: string | null;
  /** SHA-1 hashes of the bullets posted in the last digest. */
  bulletHashes: string[];
}

type MaybeState = Partial<ExecutiveDigestState> | null | undefined;

function coerceState(raw: MaybeState): ExecutiveDigestState | null {
  if (!raw || typeof raw !== "object") return null;
  const postedAt =
    typeof raw.postedAt === "string" && raw.postedAt.trim()
      ? raw.postedAt
      : null;
  if (!postedAt) return null;
  const bulletHashes = Array.isArray(raw.bulletHashes)
    ? raw.bulletHashes.filter(
        (h): h is string => typeof h === "string" && h.length > 0
      )
    : [];
  const slackTs =
    typeof raw.slackTs === "string" && raw.slackTs.trim() ? raw.slackTs : null;
  const lastAnalyzedSlackTs =
    typeof raw.lastAnalyzedSlackTs === "string" &&
    raw.lastAnalyzedSlackTs.trim()
      ? raw.lastAnalyzedSlackTs
      : null;
  return { postedAt, slackTs, lastAnalyzedSlackTs, bulletHashes };
}

export async function readExecutiveDigestState(): Promise<ExecutiveDigestState | null> {
  const redis = getSharedRedisClient();
  const raw = await redis.get<MaybeState | string>(EXECUTIVE_DIGEST_STATE_KEY);
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return coerceState(JSON.parse(raw) as MaybeState);
    } catch {
      return null;
    }
  }
  return coerceState(raw);
}

export async function writeExecutiveDigestState(
  state: ExecutiveDigestState
): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.set(EXECUTIVE_DIGEST_STATE_KEY, state);
}
