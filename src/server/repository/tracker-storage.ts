import { Redis } from "@upstash/redis";
import { TrackerDataSchema } from "@/lib/schemas/tracker";
import type { TrackerData } from "@/lib/types/tracker";

/** Vercel KV key for the full tracker document. */
export const KV_TRACKER_KEY = "ecc:tracker:data";

/**
 * Logical empty store before any Redis write (`revision` 0). Not written as JSON
 * until the first successful mutation.
 */
export const EMPTY_DATA: TrackerData = {
  revision: 0,
  companies: [],
  goals: [],
  projects: [],
  milestones: [],
  people: [],
};

export interface TrackerStorage {
  read(): Promise<TrackerData>;
  /**
   * Persists `data` only if the stored document’s revision equals `expectedRevision`.
   * Missing key is treated as revision `0`. Returns whether the write succeeded.
   */
  writeIfRevisionMatches(
    data: TrackerData,
    expectedRevision: number
  ): Promise<boolean>;
}

/**
 * Atomic compare-and-set using Redis `EVAL` + `cjson` (Upstash / Redis 7).
 * KEYS[1] = tracker key; ARGV[1] = expected revision; ARGV[2] = new JSON string.
 */
const CAS_WRITE_LUA = `
local raw = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
local newval = ARGV[2]
if raw == false then
  if expected ~= 0 then return 0 end
  redis.call('SET', KEYS[1], newval)
  return 1
end
local ok, doc = pcall(cjson.decode, raw)
if not ok or type(doc) ~= 'table' then
  return redis.error_reply('BAD_JSON')
end
local rev = doc['revision']
if rev == nil then rev = 1 else rev = tonumber(rev) end
if rev == nil then rev = 1 end
if rev ~= expected then return 0 end
redis.call('SET', KEYS[1], newval)
return 1
`;

let _redis: Redis | null = null;

/** Shared Upstash client (KV + AI rate limiting). */
export function getSharedRedisClient(): Redis {
  return getRedis();
}

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
 * Upstash Redis — each read is fresh (no in-process cache).
 * Invalid JSON in Redis surfaces as an error (no silent reset to empty).
 */
export class KvTrackerStorage implements TrackerStorage {
  async read(): Promise<TrackerData> {
    const raw = await getRedis().get(KV_TRACKER_KEY);
    if (raw == null) return EMPTY_DATA;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return TrackerDataSchema.parse(parsed);
  }

  async writeIfRevisionMatches(
    data: TrackerData,
    expectedRevision: number
  ): Promise<boolean> {
    const validated = TrackerDataSchema.parse(data);
    const payload = JSON.stringify(validated);
    const r = await getRedis().eval(CAS_WRITE_LUA, [KV_TRACKER_KEY], [
      String(expectedRevision),
      payload,
    ]);
    return r === 1;
  }
}

export function isKvConfigured(): boolean {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token);
}
