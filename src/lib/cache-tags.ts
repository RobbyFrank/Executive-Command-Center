/**
 * Next.js `revalidateTag` key for cached tracker reads (`unstable_cache` in
 * `tracker-page-data.ts`). The live store is a single JSON document in Redis,
 * so any mutation invalidates the whole tag.
 */
export const ECC_TRACKER_DATA_TAG = "ecc-tracker-data";
