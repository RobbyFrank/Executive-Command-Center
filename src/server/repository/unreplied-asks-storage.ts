import { Redis } from "@upstash/redis";
import {
  UnrepliedAsksDataSchema,
  type UnrepliedAsksData,
} from "@/lib/schemas/unrepliedAsks";

/** Redis key for unreplied-asks scan state (separate from tracker CAS). */
export const KV_UNREPLIED_ASKS_KEY = "ecc:unrepliedAsks:data";

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
if rev == nil then rev = 0 else rev = tonumber(rev) end
if rev == nil then rev = 0 end
if rev ~= expected then return 0 end
redis.call('SET', KEYS[1], newval)
return 1
`;

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url =
      process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token =
      process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Redis env missing: set KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)"
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

export const EMPTY_UNREPLIED_ASKS: UnrepliedAsksData = {
  revision: 0,
  entries: [],
};

export async function readUnrepliedAsks(): Promise<UnrepliedAsksData> {
  const raw = await getRedis().get(KV_UNREPLIED_ASKS_KEY);
  if (raw == null) return { ...EMPTY_UNREPLIED_ASKS, revision: 0 };
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return UnrepliedAsksDataSchema.parse(parsed);
}

export async function writeUnrepliedAsksIfRevisionMatches(
  data: UnrepliedAsksData,
  expectedRevision: number
): Promise<boolean> {
  const validated = UnrepliedAsksDataSchema.parse(data);
  const payload = JSON.stringify(validated);
  const r = await getRedis().eval(CAS_WRITE_LUA, [KV_UNREPLIED_ASKS_KEY], [
    String(expectedRevision),
    payload,
  ]);
  return r === 1;
}

/**
 * Read → mutate → CAS write with bounded retries (concurrent cron + refresh).
 */
export async function mutateUnrepliedAsks(
  mutator: (draft: UnrepliedAsksData) => void
): Promise<UnrepliedAsksData> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readUnrepliedAsks();
    const draft: UnrepliedAsksData = structuredClone(current);
    mutator(draft);
    draft.revision = current.revision + 1;
    const ok = await writeUnrepliedAsksIfRevisionMatches(draft, current.revision);
    if (ok) return draft;
  }
  throw new Error("Could not persist unreplied asks after retries.");
}
