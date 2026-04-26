# Roadmap: Slack scan for goals, projects, and edits

## Overview

There is **one place** to scan Slack and **one place** to review/approve suggestions: the **Slack review queue** slide-over. The per-company "Sync from Slack" button on Roadmap rows has been removed; both **review** and **on-demand sync** live in the slide-over.

**Channel resolution (auto)** — The pipeline resolves channels for each company using `resolveCompanyScrapeChannels` (`src/lib/scrapeCompanyChannels.ts`). Channels are the **union** of:

- Workspace channels whose **name, topic, or purpose** contain the company **name** or **shortName**.
- Channels already linked on this company’s **goals** via `slackChannelId`.

**Transcript and threads** — The engine loads channel history, then (when `includeThreads: true`, which the daily cron and on-demand sync both use) fetches **thread replies** for messages with `reply_count > 0`, merged into the transcript with bounded concurrency and caps (see `src/lib/slack/threadHistory.ts`).

**Pass 1 (model suggestions)** — Claude returns a **JSON array** of suggestions. The Team roster (person id, name, Slack user id) is in the system prompt. After parsing, the server **enriches** suggestions: channel resolution, owners/assignees from evidence and `@mentions`, and extra handling for **edit** kinds (see `src/lib/slackScrapeEnrich.ts`).

**Pass 2 (reconciliation)** — A second pass turns fresh suggestions + existing tracker into **pending records** (stable ids, `rationale`, patches). Results are **merged** with the per-company pending queue, with **supersession** and **dedupe** (see below).

**Global review** — A slide-over lists pending suggestions **across companies** (filters, bulk approve for one company at a time). It is animated (slide + fade) and is reachable from the **inbox** icon next to **Roadmap** in the sidebar (always visible) or the **cyan count pill** that appears when there are pending items.

The header has a **Sync all** split-button:

- **Click the main button** to open a **confirmation modal** that explains the run (server-side, ~45s/company estimate, daily cron context, kept-rejections behavior). Confirm to start; while running the same button becomes **Cancel** (aborts the stream, server stops on next iteration).
- **Click the chevron** to open a company picker and run the same pipeline for **just one** company (no confirmation — it’s quick). Companies appear in the **same order as the Roadmap page** (pinned first, then revenue desc), each with its **logo** (or a fallback building icon) and the per-company **pending count**.

While running, the sheet shows a comprehensive progress panel:

- **Headline** with progress (`3/12`) and an **ETA**.
- **Current company** + the active **stage** (`Reading Slack history (3/6)` / `Analyzing transcript` / `Reconciling with roadmap` / `Saving suggestions`).
- The **current channel** (`#mlabs-acme`) when in the history stage.
- Running tallies: **N ok**, **N failed**, **N new pending**.
- After completion: a per-failure mini-list (first 3 + “+N more”) with the server error message.

The pipeline streams over **NDJSON** with `currentStage`, `channels.{total,done,failed,current}`, and rolling `results[]`. When the run finishes the queue reloads and `router.refresh()` updates badges throughout the dashboard.

## Pending queue and Redis

- **Key:** `ecc:slackSuggestions:data` (see `src/server/repository/slack-suggestions-storage.ts`).
- **Shape:** `SlackSuggestionsData` — per-company arrays of `SlackSuggestionRecord` plus `rejectedKeysByCompany` for user rejections.
- **Invalidation:** After the pipeline writes the queue, `runSlackSyncPipelineForCompany` calls `revalidateTag(ECC_SLACK_SUGGESTIONS_TAG, { expire: 0 })` (required for Route Handlers and crons; Next.js 16 only allows `updateTag` inside Server Actions). From the UI, `src/server/actions/slackSuggestions.ts` uses `updateTag`: **approve** refreshes both `ECC_SLACK_SUGGESTIONS_TAG` and `ECC_TRACKER_DATA_TAG`; **reject** refreshes only the suggestions tag.
- **Dedupe:** `computeSlackSuggestionDedupeKey(companyId, payload)` (`src/lib/slackSuggestionDedupe.ts`) — new suggestions with the same key **replace** older pending ones; **rejected** keys are filtered on reconcile.

## Suggestion kinds (Pass 1 output)

| Kind | Meaning |
| ---- | ------- |
| `newGoal` | New goal (optional nested projects/milestones) |
| `newProject` | New project under a known goal id |
| `newProjectOnExistingGoal` | New project; goal identified by `existingGoalId` |
| `addMilestoneToExistingProject` | New milestone on an existing project |
| `newMilestone` | New milestone; project/goal from ids or create context |
| `editGoal` | Patch fields on an existing goal |
| `editProject` | Patch fields on an existing project |
| `editMilestone` | Patch fields on an existing milestone |

`newProjectOnExistingGoal` entries with an `existingGoalId` that is not a goal for that company are dropped at validation. Each suggestion may include **`rationale`** and **`evidence`** (for UI and audit).

**Apply on approve** — `src/server/actions/slackSuggestions.ts` routes by `payload.kind` to existing tracker mutators (create goal/project/milestone, update goal/project/milestone) in one coherent path.

## Channel list (client + server cache)

- The configure step uses the **same 90-second in-memory cache** as the goal row **Slack channel** picker (`src/lib/slackChannelsListClientCache.ts`, shared with `SlackChannelPicker`). After a successful `fetchSlackChannelsList` server action, the list is reused for the scraper without another `conversations.list` round-trip until TTL expires.
- On the server, `fetchSlackChannels()` in `src/lib/slack.ts` also caches **successful** list results for the same **90 seconds** (`SLACK_CHANNELS_LIST_CACHE_TTL_MS` in `src/lib/slackChannelsCacheConstants.ts`), so `POST /api/companies/scrape-slack/run` does not always hit Slack again right after the picker or scraper loaded the list.

## API routes

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `POST` | `/api/companies/scrape-slack/run` | `companyId`, `channelIds`, `days`, optional `includeThreads` (default true in UI) | **Streaming NDJSON** (`Content-Type: application/x-ndjson`): per-channel history progress, then model phase, then `done` or `error`. |
| `POST` | `/api/companies/scrape-slack/run-all` | optional `{ companyIds?: string[] }` | **Streaming NDJSON**: emits per-company progress (`completed/total`, `okCount`, `failCount`, `currentCompanyName`) while running `runSlackSyncPipelineForCompany` for every company (`days: 2`, `includeThreads: true`). Pass `companyIds` to scope the run to a subset (the **Sync all → Pick a company** picker uses this to run for one company). Same pipeline as the cron, session-authed + rate-limited. |
| `GET` | `/api/cron/slack-roadmap-sync` | (none; uses `CRON_SECRET`) | Triggers a **per-company** scan loop (see **Daily automation**). |

- Candidate channels for the UI are computed on the client with `resolveCompanyScrapeChannels` (see Overview). Rows include `id`, `name`, optional `isPrivate` (from Slack when known), `linkedToGoalIds`, `matchedByName`.
- The configure dialog consumes the stream and shows **per-channel** status (same idea as **Companies → Generate from website…**). Payload shapes are in `src/lib/slack-scrape-stream-types.ts`.
- **Done** line includes: `suggestions`, `rejected`, optional `pendingForCompany` (authoritative queue after merge), `reconcileFailed` if the reconcile step failed (Pass 1 suggestions may still be present for debugging; queue behavior falls back in code).
- Final `suggestions` are validated with `SlackScrapeSuggestionSchema` in `src/lib/schemas/tracker.ts`. Invalid array elements increment `rejected`.

## Daily automation (Vercel Cron)

- **Path:** `GET /api/cron/slack-roadmap-sync`
- **Schedule:** `0 0 * * *` (daily UTC midnight) in `vercel.json`
- **Auth:** `Authorization: Bearer <CRON_SECRET>` (or `?secret=` for manual triggers, consistent with other crons in this repo)
- **Behavior:** Sequentially runs the shared pipeline for each company: recent window (`days: 2`), `includeThreads: true`, reconcile + replace pending for that company. Configure **`CRON_SECRET`** and Slack user token env vars; see [docs/environment.md](docs/environment.md).

**Pipeline entry points:** `runSlackSyncPipelineForCompany` in `src/server/actions/slackRoadmapSync/pipeline.ts`; per-channel fetch in `src/server/actions/slackRoadmapSync/run.ts`.

## Server actions and storage (tracker + queue)

- **`createScrapedItems`** (`src/server/actions/tracker.ts`) — used for “import many at once” style flows; batch write via repository.
- **`approveSlackSuggestion` / `rejectSlackSuggestion` / `bulkApproveForCompany`** — `src/server/actions/slackSuggestions.ts`; rejection stores dedupe key under `rejectedKeysByCompany`.

## Slack requirements

Same as milestone thread reads: a **user** token (`SLACK_BILLING_USER_TOKEN` or `SLACK_CHANNEL_LIST_USER_TOKEN`) with **`channels:history`**, **`groups:history`**, and thread access as used elsewhere. Channel listing still uses `conversations.list` (see main README Slack setup).

## AI

- Requires **`ANTHROPIC_API_KEY`** (optional `ANTHROPIC_MODEL`). Pass 2 reconciliation also uses Anthropic.
- **`POST .../run`** uses the same **per-user AI rate limit** as other Anthropic routes (`checkAiRateLimit`, 60 requests/minute when Redis is configured). Daily cron is server-side; ensure quotas fit your deployment.

## Related files

| Area | Path |
| ---- | ---- |
| Schemas | `src/lib/schemas/tracker.ts` (`SlackScrapeSuggestion`, `SlackSuggestionRecord`) |
| Stream types | `src/lib/slack-scrape-stream-types.ts` |
| Thread merge | `src/lib/slack/threadHistory.ts` |
| Reconcile / validate | `src/server/actions/slackRoadmapSync/reconcile.ts`, `validate.ts` |
| UI row | `src/components/tracker/SlackSuggestionRow.tsx` |
| Global sheet | `src/components/tracker/RoadmapReviewSheet.tsx`, `RoadmapReviewContext.tsx` |
