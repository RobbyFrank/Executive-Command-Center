import { JsonTrackerRepository } from "./json-adapter";
import { KvTrackerRepository } from "./kv-adapter";
import { isKvConfigured } from "./tracker-storage";
import type { TrackerRepository } from "./types";

let instance: TrackerRepository | null = null;

export function getRepository(): TrackerRepository {
  if (!instance) {
    instance = isKvConfigured()
      ? new KvTrackerRepository()
      : new JsonTrackerRepository();
  }
  return instance;
}

export type { TrackerRepository } from "./types";
