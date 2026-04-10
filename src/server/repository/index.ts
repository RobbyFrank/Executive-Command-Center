import { KvTrackerRepository } from "./kv-adapter";
import { isKvConfigured } from "./tracker-storage";
import type { TrackerRepository } from "./types";

let instance: TrackerRepository | null = null;

export function getRepository(): TrackerRepository {
  if (!instance) {
    if (!isKvConfigured()) {
      throw new Error(
        "Tracker storage requires Redis: set KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). See .env.example."
      );
    }
    instance = new KvTrackerRepository();
  }
  return instance;
}

export type { TrackerRepository } from "./types";
export { TrackerConcurrentModificationError } from "./errors";
