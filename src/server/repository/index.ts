import { JsonTrackerRepository } from "./json-adapter";
import type { TrackerRepository } from "./types";

let instance: TrackerRepository | null = null;

export function getRepository(): TrackerRepository {
  if (!instance) {
    instance = new JsonTrackerRepository();
  }
  return instance;
}

export type { TrackerRepository } from "./types";
