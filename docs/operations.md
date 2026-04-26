# Operations

For where tracker JSON lives, seeding, and backups, see [data-storage.md](data-storage.md). For environment variables, see [environment.md](environment.md).

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, then `npm run lint`, then `npm run typecheck` on pushes and pull requests to `main` / `master`.

## Health check

`GET /api/health` returns JSON and does not require login. It verifies Upstash Redis using `PING`. Use for uptime monitors and deploy smoke tests.

## Dashboard caching

Roadmap (`/`), Companies (`/companies`), and Team (`/team`) load tracker data via `unstable_cache` in `src/server/tracker-page-data.ts` with tag `ecc-tracker-data`.

**Invalidating that cache** depends on where the code runs:

- **Server Actions** (for example `src/server/actions/tracker.ts`, `uploads.ts`, `auth-admin.ts`, and approve/reject in `slackSuggestions.ts`) call `updateTag(ECC_TRACKER_DATA_TAG)` so the next request sees fresh data (read-your-own-writes).
- **Route Handlers and crons** cannot use `updateTag` in Next.js 16; they must call `revalidateTag(ECC_TRACKER_DATA_TAG, { expire: 0 })` instead. The onboarding detector does this after it creates or backfills people (`src/server/actions/onboarding/detectNewHires.ts`), because it is invoked from `GET /api/cron/onboarding-detector`.

Pending **Slack Roadmap** suggestion counts and lists use tag **`ecc-slack-suggestions`** (`ECC_SLACK_SUGGESTIONS_TAG`). The Slack sync pipeline (`src/server/actions/slackRoadmapSync/pipeline.ts`) calls `revalidateTag(ECC_SLACK_SUGGESTIONS_TAG, { expire: 0 })` after queue writes (cron and on-demand scrape). Human approve/reject in `slackSuggestions.ts` uses `updateTag` on that tag (and on `ecc-tracker-data` when applying suggestions changes the tracker).

## Dashboard UI preferences

- **Roadmap URL:** The client keeps the query string in sync with active filters and search (`TrackerView` + `buildRoadmapHref` / `history.replaceState`) so links are shareable without a full navigation.
- **Sidebar:** `ecc_sidebar_collapsed` is set as an HTTP cookie (and mirrored in **localStorage** under the same key) when the user toggles collapse (`src/lib/sidebar-prefs.ts`) so `src/app/(dashboard)/layout.tsx` can pass `initialCollapsed` into `Sidebar` and avoid a wrong first paint. **localStorage** still wins when present; the client syncs the cookie so the next full reload matches. Legacy dotted cookie name `ecc.sidebar.collapsed` is read once for migration and cleared on write.
- **Assistant:** **Escape** closes the panel; on viewports `md` and up the dimmed backdrop is omitted so the main Roadmap stays usable beside the panel (`AiAssistantButton`).

## AI rate limiting

Anthropic-backed routes use `@upstash/ratelimit` with the same Redis client as the tracker (see `src/lib/ai-rate-limit.ts`): **60 requests per minute per signed-in user** (sliding window). Excess requests return **429** with `Retry-After`.

## Draft goal/project AI — ideas shortlist cache

The **initial** auto-request for **Draft a new goal/project with AI** (ideas mode, empty chat history) hits `POST /api/ai-create` and is stored with Next.js `unstable_cache` for **10 minutes** (`src/lib/ai-create-ideas-cache.ts`, tag `ecc-ai-create-ideas`). The cache key is the draft **type** plus **company id** (goal flow) or **goal id** (project flow).

**Invalidation:** `src/server/actions/tracker.ts` calls `revalidateTag("ecc-ai-create-ideas", { expire: 0 })` when goals or projects change in ways that affect AI context: **create / delete** goal or project, **batch scrape import**, or **patch** updates that touch substantive fields (goal: description, measurable target, why it matters, current value, priority, status; project: name, description, definition of done, priority, status, primary `goalId`). Promoting a project to **In Progress** from a milestone Slack URL also invalidates. **Not** invalidated for minor edits (e.g. owner, Slack fields, at-risk/spotlight, mirrors). **Follow-on** API calls (pick an idea, expand, revise, conversational mode, or “new directions” with a non-empty history) are never read from this cache.

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
3. Reduces the tracker to high-signal lines: **at-risk** / **spotlight** flags, **P0 / P1** goals and projects, `Stuck` or `Blocked` projects, and anything with recent review-log notes. Each line still carries an absolute Roadmap deep link using `ECC_PUBLIC_BASE_URL` (default `https://admin.mlabs.vc`) + `buildRoadmapHref` so Claude has context about which item it's reasoning over, but **bullets in the posted message do not contain per-line links** — the channel message has a single `<…|Portfolio OS>` hyperlink in the header.
4. Calls Claude (`claudePlainText`, model from `getAnthropicModel()`) with a strict prompt: Slack-mrkdwn only, four fixed sections (`*New risks*`, `*Decisions needed*`, `*Notable progress*`, `*Owner asks*`), 0–3 bullets per section, ≤22 words per bullet, no URLs in bullets, ≤1200 chars total, plus an explicit "do not repeat these fingerprints" list.
5. Hash-dedupes each returned bullet against yesterday's fingerprints (post-filter belt-and-suspenders). A separate `stripBulletLinks` pass removes any stray `<URL|label>` tokens Claude leaves behind. If nothing survives, posts a one-liner `Nothing new worth paging on since yesterday` so the channel can confirm the job ran.
6. Builds a **founder mention prefix** by filtering the Team roster with `isFounderPerson` and collecting each founder's `slackHandle` (Slack user ID); the message starts with `<@U…> <@U…>` so every founder is paged.
7. Posts via `postSlackChannelMessageAsBot` so the message is **authored by the installed Slack app** (uses `SLACK_BOT_USER_OAUTH_TOKEN`, xoxb-), not by an OAuth user. Invite the app to `#executive-priorities` first (`/invite @YourAppName`); the bot needs Bot Token Scope `chat:write`. Then writes the new `{ postedAt, slackTs, lastAnalyzedSlackTs, bulletHashes }` back to Redis.

**Auth.** The route requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron injects this automatically when `CRON_SECRET` is set at build time; manual invocations must send the same header.

**Manual test.**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://admin.mlabs.vc/api/cron/executive-digest?dryRun=1"
```

`dryRun=1` returns `{ ok: true, posted: false, slackText, bulletCount, windowMessageCount, droppedDuplicateBulletCount }` without posting to Slack or touching Redis state. Drop the flag to post for real.

**Troubleshooting.**

- `stage: "config"` — `SLACK_EXECUTIVE_PRIORITIES_CHANNEL_ID` or `ANTHROPIC_API_KEY` is missing.
- `stage: "slack_history"` `not_in_channel` — the **user token** used for reading history is not a member of `#executive-priorities`. Invite the OAuth user and retry.
- `stage: "slack_history"` `missing_scope` — add User Token Scopes `channels:history`, `groups:history`, reinstall, re-run OAuth.
- `stage: "slack_post"` `not_in_channel` — the **Slack app/bot** is not in the channel. Open the channel and run `/invite @YourAppName`, then retry.
- `stage: "slack_post"` `missing_scope` — the bot token is missing Bot Token Scope `chat:write`. Add it in [api.slack.com/apps](https://api.slack.com/apps) → OAuth & Permissions → Bot Token Scopes, reinstall, paste the new `xoxb-` value into `SLACK_BOT_USER_OAUTH_TOKEN`.
- Founders not @-tagged in the post — at least one founder is missing a Slack user ID on their Team record. Open `/team`, edit each founder, and set `slackHandle` to their `U…` user ID. Anyone marked `isFounder: true` (or the legacy ids `robby` / `nadav`) with a non-empty `slackHandle` is included automatically.
- Set `DIGEST_POST_FAILURES=1` to have the route post a short `Daily executive digest failed: …` line into the channel on errors (off by default to avoid noisy failures).
- To reset dedupe (force the next run to behave like a first run), delete the Redis key `ecc:digest:exec:last`.

## Onboarding detector (cron)

`GET /api/cron/onboarding-detector` runs three times daily (`0 3,11,19 * * *` in `vercel.json`). It uses the same **`Authorization: Bearer ${CRON_SECRET}`** pattern as the executive digest. The job scans Slack for Nadav welcome messages and may append new `Person` rows plus welcome metadata. Configure Slack + Anthropic as in [environment.md](environment.md). Full runbook: [onboarding.md](onboarding.md).

## Followups (unreplied-asks cron)

`GET /api/cron/unreplied-asks-scan` runs hourly (`0 * * * *` in `vercel.json`). Same **`Authorization: Bearer ${CRON_SECRET}`** header. It pulls each founder’s recent Slack messages via `search.messages`, classifies **new** message ids once with Anthropic, and refreshes `conversations.replies` for open asks. State is stored under Redis key **`ecc:unrepliedAsks:data`**. Manual **Refresh now** on **Followups** (`/unreplied`) calls **`POST /api/unreplied-asks/scan`** (session auth) and streams **NDJSON** progress while the same pipeline runs (AI rate limiting applies). Full runbook: [unreplied-asks.md](unreplied-asks.md).

## Roadmap Slack scan (cron)

`GET /api/cron/slack-roadmap-sync` runs daily at **`0 0 * * *` (UTC midnight)** in `vercel.json`. Same **`Authorization: Bearer ${CRON_SECRET}`** pattern. The job iterates **companies** and runs the shared Slack Roadmap pipeline: recent **2-day** history with **thread replies**, two Anthropic passes (suggest + reconcile), dedupe/supersession, and writes the per-company **pending** queue to Redis key **`ecc:slackSuggestions:data`**. The UI (Roadmap scan dialog + nav sheet) is for **human approve/reject**; rejects store dedupe keys so they do not re-queue trivially. Full runbook: [roadmap-slack-scrape.md](roadmap-slack-scrape.md).

**Vercel logs:** The pipeline logs structured **JSON one line at a time** to stdout. In the Vercel project → *Logs* (or the Runtime Logs for a specific deployment), search for **`ecc:slackRoadmapSync`**. Each line includes a `source` of that value, a stable `event` (for example `cron_batch_start`, `model_response`, `model_json_parse_failed`, `pipeline_ok`), plus **`batchId`** (nightly run or a single “Sync all” request) and **`correlationId`** (one per company) so you can follow one failure end-to-end. If the model returns non-JSON, look for `model_json_parse_failed` and chunked `model_raw_output` events with the same ids.
