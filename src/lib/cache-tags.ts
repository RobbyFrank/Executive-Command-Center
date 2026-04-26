/**
 * Next.js `revalidateTag` key for cached tracker reads (`unstable_cache` in
 * `tracker-page-data.ts`). The live store is a single JSON document in Redis,
 * so any mutation invalidates the whole tag.
 */
export const ECC_TRACKER_DATA_TAG = "ecc-tracker-data";

/**
 * Initial "ideas shortlist" response for `/api/ai-create` (draft goal/project with AI).
 * Revalidated on a 10-minute TTL and when goals/projects change in substantive ways
 * (see `revalidateAiCreateIdeasCache` in `server/actions/tracker.ts`).
 */
export const ECC_AI_CREATE_IDEAS_TAG = "ecc-ai-create-ideas";

/** Pending Slack → roadmap review queue in Redis (`ecc:slackSuggestions:data`). */
export const ECC_SLACK_SUGGESTIONS_TAG = "ecc-slack-suggestions";
