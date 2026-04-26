import { readSlackSuggestions } from "@/server/repository/slack-suggestions-storage";
import { unstable_cache } from "next/cache";
import { ECC_SLACK_SUGGESTIONS_TAG } from "@/lib/cache-tags";
import type { SlackSuggestionsData } from "@/lib/schemas/tracker";

export function countPendingByCompany(
  data: Pick<SlackSuggestionsData, "items">
): { total: number; byCompany: Record<string, number> } {
  const byCompany: Record<string, number> = {};
  let total = 0;
  for (const it of data.items) {
    if (it.status !== "pending") continue;
    total += 1;
    byCompany[it.companyId] = (byCompany[it.companyId] ?? 0) + 1;
  }
  return { total, byCompany };
}

/**
 * Best-available "last sync" timestamp derived from existing records:
 * the max of `lastSeenAt` across **all** items. The pipeline writes a fresh
 * `lastSeenAt = now` for every suggestion it (re)creates, so this captures
 * the most recent successful run for any company without adding a schema field.
 */
function lastSyncedAtFromItems(
  data: Pick<SlackSuggestionsData, "items">
): string | null {
  let max = "";
  for (const it of data.items) {
    if (typeof it.lastSeenAt === "string" && it.lastSeenAt > max) {
      max = it.lastSeenAt;
    }
  }
  return max || null;
}

export const getCachedSlackPendingStats = unstable_cache(
  async () => {
    const doc = await readSlackSuggestions();
    const counts = countPendingByCompany(doc);
    return { ...counts, lastSyncedAt: lastSyncedAtFromItems(doc) };
  },
  ["ecc-slack-pending-stats"],
  { tags: [ECC_SLACK_SUGGESTIONS_TAG] }
);
