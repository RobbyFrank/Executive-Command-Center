/**
 * One-time: copy local `data/tracker.json` into Upstash Redis (same key as production).
 * Requires KV_REST_* or UPSTASH_REDIS_REST_* in `.env.local` (pull from Vercel or Storage dashboard).
 *
 *   npm run seed:kv
 */

import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Redis } from "@upstash/redis";
import { TrackerDataSchema } from "../src/lib/schemas/tracker";
import { KV_TRACKER_KEY } from "../src/server/repository/tracker-storage";

config({ path: join(process.cwd(), ".env.local") });

async function main() {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error(
      "Missing KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN"
    );
    process.exit(1);
  }

  const dataPath = join(process.cwd(), "data", "tracker.json");
  if (!existsSync(dataPath)) {
    console.error("No data/tracker.json found.");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(dataPath, "utf-8"));
  const validated = TrackerDataSchema.parse(raw);
  const redis = new Redis({ url, token });
  await redis.set(KV_TRACKER_KEY, JSON.stringify(validated));
  console.log(
    `Seeded ${KV_TRACKER_KEY} (${validated.companies.length} companies, ${validated.people.length} people).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
