# Roadmap: Slack scan for missing goals and projects

## Overview

On **Roadmap**, each **company** row has a **scan** icon (right side of the header). It opens a two-step flow:

1. **Configure** — Choose how many **days** of Slack history to read (1–90, default 14) and which **channels** to include. On load, **public** channels and channels whose **name** contains the word `test` (case-insensitive) start **unchecked**; everything else starts checked (see `slackScrapeChannelSelectedByDefault` in `src/lib/scrapeCompanyChannels.ts`). Channels are the **union** of:
   - Workspace channels whose **name, topic, or purpose** contain the company **name** or **shortName** (same logic as the goal row **Slack channel** picker’s “Relevant only” filter, shared via `src/lib/scrapeCompanyChannels.ts`).
   - Channels already linked on this company’s **goals** via `slackChannelId` (even if they did not match the name filter).

2. **Review** — The server loads **top-level** channel messages only (`conversations.history`, user token), caps transcript size for the model, and asks Claude to return a JSON **array** of suggestions. You **multi-select** which proposed **goals** (with optional nested **projects**) and which **projects on existing goals** to import. **Add selected** writes everything in **one** tracker commit.

## Channel list (client + server cache)

- The configure step uses the **same 90-second in-memory cache** as the goal row **Slack channel** picker (`src/lib/slackChannelsListClientCache.ts`, shared with `SlackChannelPicker`). After a successful `fetchSlackChannelsList` server action, the list is reused for the scraper without another `conversations.list` round-trip until TTL expires.
- On the server, `fetchSlackChannels()` in `src/lib/slack.ts` also caches **successful** list results for the same **90 seconds** (`SLACK_CHANNELS_LIST_CACHE_TTL_MS` in `src/lib/slackChannelsCacheConstants.ts`), so `POST /api/companies/scrape-slack/run` does not always hit Slack again right after the picker or scraper loaded the list.

## API routes

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `POST` | `/api/companies/scrape-slack/run` | `{ "companyId": string, "channelIds": string[], "days": number }` | **Streaming NDJSON** (`Content-Type: application/x-ndjson`): per-channel history progress, then model phase, then `{ "type":"done", "suggestions", "rejected" }` or `{ "type":"error", "message" }`. Validation failures **before** the stream starts return plain JSON (`{ "error": string }`) with 4xx/5xx. |

- Candidate channels for the UI are computed on the client with `resolveCompanyScrapeChannels` (see Overview). Rows include `id`, `name`, optional `isPrivate` (from Slack when known), `linkedToGoalIds`, `matchedByName`.
- The configure dialog consumes the stream and shows **per-channel** status (same idea as **Companies → Generate from website…**). Payload shapes are in `src/lib/slack-scrape-stream-types.ts`.
- Final `suggestions` are validated with `SlackScrapeSuggestionSchema` in `src/lib/schemas/tracker.ts`. Invalid array elements increment `rejected`.
- `newProjectOnExistingGoal` entries with an `existingGoalId` that is not a goal for that company are dropped (and counted in `rejected`).

## Server actions and storage

- **`createScrapedItems`** (`src/server/actions/tracker.ts`) — Validates payload with `createScrapedItemsPayloadSchema`, then calls **`createScrapedItemsBatch`** on the repository (`src/server/repository/tracker-repository-core.ts`) so goals, projects, and milestones are appended in a **single** optimistic-lock write.

## Slack requirements

Same as milestone thread reads: a **user** token (`SLACK_BILLING_USER_TOKEN` or `SLACK_CHANNEL_LIST_USER_TOKEN`) with **`channels:history`** and **`groups:history`**. Channel listing for resolution still uses `conversations.list` (see main README Slack setup).

## AI

- Requires **`ANTHROPIC_API_KEY`** (optional `ANTHROPIC_MODEL`).
- **`POST .../run`** uses the same **per-user AI rate limit** as other Anthropic routes (`checkAiRateLimit`, 60 requests/minute when Redis is configured).
