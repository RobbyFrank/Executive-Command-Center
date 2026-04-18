/**
 * Set or rotate a person's app login password in Redis (bcrypt hash on their Person record).
 * Uses the same CAS write as the app. Requires KV_REST_* or UPSTASH_REDIS_* in `.env.local`.
 *
 *   npx tsx scripts/set-password.ts <email> <new-password>
 *
 * Example:
 *   npx tsx scripts/set-password.ts you@company.com "your-long-passphrase"
 */

import { config } from "dotenv";
import { hashSync } from "bcryptjs";
import { join } from "path";
import { TrackerDataSchema } from "../src/lib/schemas/tracker";
import type { TrackerData } from "../src/lib/types/tracker";
import { KvTrackerStorage } from "../src/server/repository/tracker-storage";

config({ path: join(process.cwd(), ".env.local") });

const BCRYPT_COST = 10;
const MAX_ATTEMPTS = 12;

async function main() {
  const emailArg = process.argv[2];
  const passwordArg = process.argv[3];
  if (!emailArg?.trim() || !passwordArg) {
    console.error(
      "Usage: npx tsx scripts/set-password.ts <email> <new-password>"
    );
    process.exit(1);
  }

  const emailLower = emailArg.trim().toLowerCase();
  const storage = new KvTrackerStorage();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const data: TrackerData = await storage.read();
    const expected = data.revision;
    const idx = data.people.findIndex(
      (p) => p.email.trim().toLowerCase() === emailLower
    );
    if (idx === -1) {
      console.error(`No person found with email matching: ${emailArg.trim()}`);
      process.exit(1);
    }

    const passwordHash = hashSync(passwordArg, BCRYPT_COST);
    data.people[idx] = {
      ...data.people[idx],
      passwordHash,
    };
    data.revision = expected + 1;

    const validated = TrackerDataSchema.parse(data);
    const ok = await storage.writeIfRevisionMatches(validated, expected);
    if (ok) {
      console.log(
        `Updated password hash for ${data.people[idx].name} (${data.people[idx].email}).`
      );
      return;
    }
  }

  console.error("Could not write after concurrent updates. Try again.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
