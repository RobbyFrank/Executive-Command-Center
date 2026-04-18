# Operations

For where tracker JSON lives, seeding, and backups, see [data-storage.md](data-storage.md). For environment variables, see [environment.md](environment.md).

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, then `npm run lint`, then `npm run typecheck` on pushes and pull requests to `main` / `master`.

## Health check

`GET /api/health` returns JSON and does not require login. It verifies Upstash Redis using `PING`. Use for uptime monitors and deploy smoke tests.

## Dashboard caching

Roadmap (`/`), Companies (`/companies`), and Team (`/team`) load tracker data via `unstable_cache` in `src/server/tracker-page-data.ts` with tag `ecc-tracker-data`. Mutations in `src/server/actions/tracker.ts` and `uploads.ts` call `updateTag("ecc-tracker-data")` so cached reads refresh after writes.

## Dashboard UI preferences

- **Roadmap URL:** The client keeps the query string in sync with active filters and search (`TrackerView` + `buildRoadmapHref` / `history.replaceState`) so links are shareable without a full navigation.
- **Sidebar:** `ecc_sidebar_collapsed` is set as an HTTP cookie (and mirrored in **localStorage** under the same key) when the user toggles collapse (`src/lib/sidebar-prefs.ts`) so `src/app/(dashboard)/layout.tsx` can pass `initialCollapsed` into `Sidebar` and avoid a wrong first paint. **localStorage** still wins when present; the client syncs the cookie so the next full reload matches. Legacy dotted cookie name `ecc.sidebar.collapsed` is read once for migration and cleared on write.
- **Assistant:** **Escape** closes the panel; on viewports `md` and up the dimmed backdrop is omitted so the main Roadmap stays usable beside the panel (`AiAssistantButton`).

## AI rate limiting

Anthropic-backed routes use `@upstash/ratelimit` with the same Redis client as the tracker (see `src/lib/ai-rate-limit.ts`): **60 requests per minute per signed-in user** (sliding window). Excess requests return **429** with `Retry-After`.

## PII in LLM prompts

`src/lib/tracker-redact.ts` removes **email**, **phone**, and **estimated monthly salary** from the tracker JSON embedded in assistant / AI create / AI update prompts. Slack thread drafting still receives full in-memory data in `buildMilestoneThreadContextBlock` (it does not echo salary into the prompt text).

## Daily executive digest

A Vercel Cron posts an AI-generated executive digest to `#executive-priorities` every morning. The job runs at `0 12 * * *` (12:00 UTC ≈ 8:00 AM America/New_York; note that the posted hour drifts by one between EDT and EST), defined in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/executive-digest", "schedule": "0 12 * * *" }
  ]
}
```

**How it works** (`src/server/actions/executiveDigest/` + `src/app/api/cron/executive-digest/route.ts`):

1. Loads the last posted digest's metadata from Redis (`ecc:digest:exec:last`): posted-at timestamp, Slack `ts`, and SHA-1 fingerprints of yesterday's bullets.
2. In parallel, reads the last **7 days** of top-level messages in `#executive-priorities` (`fetchSlackChannelHistory`), the full tracker hierarchy, and the team roster.
3. Reduces the tracker to high-signal lines: **at-risk** / **spotlight** flags, **P0 / P1** goals and projects, `Stuck` or `Blocked` projects, and anything with recent review-log notes. Each line ships an absolute Roadmap deep link using `ECC_PUBLIC_BASE_URL` (default `https://admin.mlabs.vc`) + `buildRoadmapHref` (e.g. `https://admin.mlabs.vc/?focusGoal=…&focusProject=…`).
4. Calls Claude (`claudePlainText`, model from `getAnthropicModel()`) with a strict prompt: Slack-mrkdwn only, four fixed sections (`*New risks*`, `*Decisions needed*`, `*Notable progress*`, `*Owner asks*`), every bullet ending in `<url|Open roadmap>`, and an explicit "do not repeat these fingerprints" list.
5. Hash-dedupes each returned bullet against yesterday's fingerprints (post-filter belt-and-suspenders). If nothing survives, posts a one-liner `Nothing new worth paging on since yesterday` so the channel can confirm the job ran.
6. Posts via `postSlackChannelMessage` (user token, same as milestone threads) and writes the new `{ postedAt, slackTs, lastAnalyzedSlackTs, bulletHashes }` back to Redis.

**Auth.** The route requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron injects this automatically when `CRON_SECRET` is set at build time; manual invocations must send the same header.

**Manual test.**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://admin.mlabs.vc/api/cron/executive-digest?dryRun=1"
```

`dryRun=1` returns `{ ok: true, posted: false, slackText, bulletCount, windowMessageCount, droppedDuplicateBulletCount }` without posting to Slack or touching Redis state. Drop the flag to post for real.

**Troubleshooting.**

- `stage: "config"` — `SLACK_EXECUTIVE_PRIORITIES_CHANNEL_ID` or `ANTHROPIC_API_KEY` is missing.
- `stage: "slack_history"` `not_in_channel` — the user token is not a member of `#executive-priorities`. Invite them and retry.
- `stage: "slack_history"` `missing_scope` — add User Token Scopes `channels:history`, `groups:history` (and `chat:write` for posting), reinstall, re-run OAuth.
- `stage: "slack_post"` — the same user lacks `chat:write` or was removed from the channel.
- Set `DIGEST_POST_FAILURES=1` to have the route post a short `Daily executive digest failed: …` line into the channel on errors (off by default to avoid noisy failures).
- To reset dedupe (force the next run to behave like a first run), delete the Redis key `ecc:digest:exec:last`.
