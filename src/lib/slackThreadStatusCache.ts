import type { SlackThreadStatusResult } from "@/server/actions/slack";
import {
  readBrowserJsonCache,
  writeBrowserJsonCache,
  removeBrowserJsonCache,
} from "@/lib/browserJsonCache";

export type SlackThreadStatusOk = Extract<
  SlackThreadStatusResult,
  { ok: true }
>;

/** Thread preview + replies metadata — aligned with popover refresh behavior */
const TTL_MS = 60 * 60 * 1000;

function lsKey(cacheKey: string): string {
  return `slackTh:${cacheKey}`;
}

const store = new Map<
  string,
  { storedAt: number; payload: SlackThreadStatusOk }
>();

export function readSlackThreadStatusCache(
  url: string
): SlackThreadStatusOk | undefined {
  const e = store.get(url);
  if (e) {
    if (Date.now() - e.storedAt <= TTL_MS) return e.payload;
    store.delete(url);
    removeBrowserJsonCache(lsKey(url));
  }

  const fromLs = readBrowserJsonCache<SlackThreadStatusOk>(lsKey(url), TTL_MS);
  if (fromLs) {
    store.set(url, {
      storedAt: fromLs.storedAt,
      payload: fromLs.payload,
    });
    return fromLs.payload;
  }
  return undefined;
}

export function writeSlackThreadStatusCache(
  url: string,
  payload: SlackThreadStatusOk
): void {
  const now = Date.now();
  store.set(url, { storedAt: now, payload });
  writeBrowserJsonCache(lsKey(url), payload);
}

/** Clears cached status for this URL, including variants keyed with Team roster hints. */
export function invalidateSlackThreadStatusCache(url: string): void {
  for (const k of [...store.keys()]) {
    if (k === url || k.startsWith(`${url}::`)) {
      store.delete(k);
      removeBrowserJsonCache(lsKey(k));
    }
  }
}
