/**
 * Persists JSON-serializable values in localStorage with a TTL.
 * Used for Slack thread status and milestone likelihood so caches survive reloads.
 */

const LS_KEY_PREFIX = "ecc.jc.v1:";

function hashKey(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h, 33) ^ key.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function storageKey(contentKey: string): string {
  return `${LS_KEY_PREFIX}${hashKey(contentKey)}`;
}

type Stored<T> = {
  storedAt: number;
  payload: T;
  /** Prevents hash collisions from returning the wrong row */
  contentKey: string;
};

export type CachedEnvelope<T> = { storedAt: number; payload: T };

export function readBrowserJsonCache<T>(
  contentKey: string,
  ttlMs: number
): CachedEnvelope<T> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(storageKey(contentKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (
      parsed.contentKey !== contentKey ||
      typeof parsed.storedAt !== "number" ||
      parsed.payload === undefined
    ) {
      localStorage.removeItem(storageKey(contentKey));
      return undefined;
    }
    if (Date.now() - parsed.storedAt > ttlMs) {
      localStorage.removeItem(storageKey(contentKey));
      return undefined;
    }
    return { storedAt: parsed.storedAt, payload: parsed.payload };
  } catch {
    return undefined;
  }
}

export function writeBrowserJsonCache<T>(contentKey: string, payload: T): void {
  if (typeof window === "undefined") return;
  try {
    const row: Stored<T> = {
      storedAt: Date.now(),
      payload,
      contentKey,
    };
    localStorage.setItem(storageKey(contentKey), JSON.stringify(row));
  } catch {
    /* quota / private mode */
  }
}

export function removeBrowserJsonCache(contentKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(contentKey));
  } catch {
    /* ignore */
  }
}
