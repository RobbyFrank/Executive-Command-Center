import { unstable_cache } from "next/cache";
import { completeInitialIdeasShortlistText } from "@/lib/ai-create-prompt";
import { ECC_AI_CREATE_IDEAS_TAG } from "@/lib/cache-tags";

const TEN_MINUTES = 600;

/**
 * Cached initial AI shortlist for "Draft goal/project with AI" (ideas mode, empty history).
 * Invalidated via {@link ECC_AI_CREATE_IDEAS_TAG} on major goal/project changes, or after TTL.
 */
export function getCachedInitialIdeasShortlist(
  type: "goal" | "project",
  companyId: string | undefined,
  goalId: string | undefined,
): Promise<string> {
  const run = unstable_cache(
    () => completeInitialIdeasShortlistText(type, companyId, goalId),
    ["ecc-ai-create-ideas", type, companyId ?? "", goalId ?? ""],
    { revalidate: TEN_MINUTES, tags: [ECC_AI_CREATE_IDEAS_TAG] },
  );
  return run();
}
