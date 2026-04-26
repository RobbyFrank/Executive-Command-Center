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

export const getCachedSlackPendingStats = unstable_cache(
  async () => {
    const doc = await readSlackSuggestions();
    return countPendingByCompany(doc);
  },
  ["ecc-slack-pending-stats"],
  { tags: [ECC_SLACK_SUGGESTIONS_TAG] }
);
