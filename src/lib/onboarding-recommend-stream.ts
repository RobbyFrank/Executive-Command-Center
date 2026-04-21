/**
 * Delimiters used by `POST /api/onboarding/recommend/stream` so the client can
 * parse the plain-text stream into (status lines, model text, final JSON).
 *
 * Wire format (in order):
 *   <zero or more `ECC_ONBOARDING_STATUS:<text>\n` lines — pre-AI progress>
 *   <raw model text deltas>
 *   <`ECC_ONBOARDING_DONE\n` delimiter>
 *   <final JSON payload (recommendation + buddies, or `{ ok: false, error }`)>
 */
export const ONBOARDING_RECOMMEND_STATUS_PREFIX = "ECC_ONBOARDING_STATUS:";
export const ONBOARDING_RECOMMEND_STREAM_DONE = "\n---ECC_ONBOARDING_DONE---\n";
