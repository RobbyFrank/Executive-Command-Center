import { readFile, writeFile, rename, access } from "fs/promises";
import { join } from "path";
import { Redis } from "@upstash/redis";
import { TrackerDataSchema } from "@/lib/schemas/tracker";
import type { TrackerData } from "@/lib/types/tracker";

const DATA_PATH = join(process.cwd(), "data", "tracker.json");

/** Vercel KV key for the full tracker document. */
export const KV_TRACKER_KEY = "ecc:tracker:data";

export const EMPTY_DATA: TrackerData = {
  companies: [],
  goals: [],
  projects: [],
  milestones: [],
  people: [],
};

export interface TrackerStorage {
  read(): Promise<TrackerData>;
  write(data: TrackerData): Promise<void>;
}

/**
 * Local JSON file with in-process cache (dev / single-machine).
 * Atomic replace on write.
 */
export class FileTrackerStorage implements TrackerStorage {
  private cache: TrackerData | null = null;

  async read(): Promise<TrackerData> {
    if (this.cache) return this.cache;
    try {
      await access(DATA_PATH);
      const raw = await readFile(DATA_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = TrackerDataSchema.parse(parsed);
      this.cache = validated;
      return validated;
    } catch {
      this.cache = EMPTY_DATA;
      return EMPTY_DATA;
    }
  }

  async write(data: TrackerData): Promise<void> {
    const validated = TrackerDataSchema.parse(data);
    const tmpPath = DATA_PATH + ".tmp";
    await writeFile(tmpPath, JSON.stringify(validated, null, 2), "utf-8");
    await rename(tmpPath, DATA_PATH);
    this.cache = validated;
  }
}

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url =
      process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token =
      process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Redis env missing: set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV / legacy) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash)"
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

/**
 * Upstash Redis (Vercel Storage / marketplace) — no cross-request cache;
 * each read is fresh so warm lambdas do not serve stale tracker JSON.
 */
export class KvTrackerStorage implements TrackerStorage {
  async read(): Promise<TrackerData> {
    const raw = await getRedis().get(KV_TRACKER_KEY);
    if (raw == null) return EMPTY_DATA;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return TrackerDataSchema.parse(parsed);
  }

  async write(data: TrackerData): Promise<void> {
    const validated = TrackerDataSchema.parse(data);
    await getRedis().set(KV_TRACKER_KEY, JSON.stringify(validated));
  }
}

export function isKvConfigured(): boolean {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token);
}
