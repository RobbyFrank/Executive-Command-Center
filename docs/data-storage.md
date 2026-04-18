# Data storage

## Location

- **Store:** Upstash Redis (REST), key **`ecc:tracker:data`**
- **Schema:** Zod-validated document in `src/lib/schemas/tracker.ts`; TypeScript types in `src/lib/types/tracker.ts`
- **Concurrency:** Root field **`revision`** plus atomic compare-and-set in Redis so concurrent edits do not silently overwrite each other (`src/server/repository/tracker-storage.ts`)

Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) in `.env.local` before running the app locally or in production.

## Review notes

Goals and projects may have a **`reviewLog`**: dated entries with text. On **Roadmap**, open **Review notes…** from the row context menu (or **⋯**); the popover appends notes and shows history.

## Seed / import

With Redis credentials in `.env.local`:

```bash
npm run seed:kv -- path/to/tracker.json
```

The script validates the JSON against the tracker schema and uploads it to Redis.

### Login passwords (bcrypt on `Person`)

Passwords are **not** configured via environment variables. After people exist in Redis (seed or app), set a hash for sign-in:

```bash
npx tsx scripts/set-password.ts you@company.com "your-long-passphrase"
```

Requires the person’s **email** in tracker JSON to match. Founders can also set or clear passwords from **Team → Login** in the app.

## Backup

Export or snapshot the Redis key with your provider’s tools. Keep offline JSON copies before risky bulk edits if needed.

## Company and people images

- **Local dev:** files under `public/uploads/companies/` and `public/uploads/people/`; paths like `/uploads/people/robby.png` are stored in the tracker JSON.
- **Production:** when `BLOB_READ_WRITE_TOKEN` is set, logos and avatars may use **Vercel Blob** URLs instead.

## See also

- [strategic-tracker.md](strategic-tracker.md) — Roadmap documentation index
- [strategic-tracker-data-model.md](strategic-tracker-data-model.md) — Companies, Team, goals, projects, Slack field storage
- [environment.md](environment.md) — Redis, Blob, and Slack env vars
