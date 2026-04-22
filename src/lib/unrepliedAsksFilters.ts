import type { AskEntry } from "@/lib/schemas/unrepliedAsks";
import { businessHoursBetween } from "@/lib/businessHours";

export const DEFAULT_UNREPLIED_LOOKBACK_DAYS = 30;
export const MAX_UNREPLIED_LOOKBACK_DAYS = 99;
export const UNREPLIED_BUSINESS_HOURS_THRESHOLD = 48;

export function entrySlackMessageDate(entry: AskEntry): Date {
  const sec = parseFloat(entry.ts);
  if (!Number.isFinite(sec)) return new Date(0);
  return new Date(Math.floor(sec * 1000));
}

/**
 * Whether this entry should appear on the Followups wall.
 *
 * An ask is surfaced iff all of:
 *   - classified as an ask
 *   - still open (not dismissed / nudged / replied)
 *   - the ask is the newest message in its thread (`hasExternalReply === false`;
 *     the scanner flips this to true when `thread.latestTs > entry.ts`, i.e.
 *     **any** newer message in the thread, regardless of author)
 *   - within the configured lookback window
 *   - past the business-hours threshold (48h)
 *   - not snoozed
 */
export function isAskSurfacedOnWall(
  entry: AskEntry,
  lookbackDays: number,
  now: Date
): boolean {
  if (entry.classification !== "ask") return false;
  if (entry.state !== "open") return false;
  if (entry.hasExternalReply) return false;
  const msgAt = entrySlackMessageDate(entry);
  const cutoffMs = lookbackDays * 86_400_000;
  if (now.getTime() - msgAt.getTime() > cutoffMs) return false;
  const su = entry.snoozeUntil?.trim();
  if (su) {
    const until = new Date(su);
    if (!Number.isNaN(until.getTime()) && until > now) return false;
  }
  if (businessHoursBetween(msgAt, now) < UNREPLIED_BUSINESS_HOURS_THRESHOLD) {
    return false;
  }
  return true;
}

export function clampLookbackDays(raw: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_UNREPLIED_LOOKBACK_DAYS;
  return Math.min(
    MAX_UNREPLIED_LOOKBACK_DAYS,
    Math.max(7, n)
  );
}
