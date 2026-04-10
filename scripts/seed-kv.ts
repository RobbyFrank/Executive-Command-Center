/**
 * Upload a validated tracker JSON file to Upstash Redis (key `ecc:tracker:data`).
 * Requires KV_REST_* or UPSTASH_REDIS_* in `.env.local`.
 *
 *   npm run seed:kv -- path/to/tracker.json
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

  const dataPath = process.argv[2];
  if (!dataPath) {
    console.error(
      "Usage: npm run seed:kv -- <path-to-tracker.json>\nExample: npm run seed:kv -- ./backup/tracker.json"
    );
    process.exit(1);
  }

  if (!existsSync(dataPath)) {
    console.error(`File not found: ${dataPath}`);
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
