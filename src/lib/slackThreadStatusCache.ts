import type { SlackThreadStatusResult } from "@/server/actions/slack";

export type SlackThreadStatusOk = Extract<
  SlackThreadStatusResult,
  { ok: true }
>;

const TTL_MS = 5 * 60 * 1000;

const store = new Map<
  string,
  { storedAt: number; payload: SlackThreadStatusOk }
>();

export function readSlackThreadStatusCache(
  url: string
): SlackThreadStatusOk | undefined {
  const e = store.get(url);
  if (!e) return undefined;
  if (Date.now() - e.storedAt > TTL_MS) {
    store.delete(url);
    return undefined;
  }
  return e.payload;
}

export function writeSlackThreadStatusCache(
  url: string,
  payload: SlackThreadStatusOk
): void {
  store.set(url, { storedAt: Date.now(), payload });
}

/** Clears cached status for this URL, including variants keyed with Team roster hints. */
export function invalidateSlackThreadStatusCache(url: string): void {
  for (const k of [...store.keys()]) {
    if (k === url || k.startsWith(`${url}::`)) store.delete(k);
  }
}
