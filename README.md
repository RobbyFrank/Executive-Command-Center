# Portfolio OS

Next.js app for the **MLabs portfolio**: companies, goals, projects, milestones, team roster, Slack-assisted workflows, and an in-app AI assistant. Tracker data is a single JSON document in **Upstash Redis** with **optimistic locking** (`revision` + compare-and-set).

**Where to read more**

- **[docs/strategic-tracker.md](docs/strategic-tracker.md)** — Roadmap doc index (data model, Slack, UI, AI); see also [docs/project-outline.md](docs/project-outline.md) for strategic framing
- **[docs/environment.md](docs/environment.md)** — Environment variables (Redis, AI, Blob, Slack tokens)
- **[docs/data-storage.md](docs/data-storage.md)** — Redis key, seed/import, backups, images
- **[docs/operations.md](docs/operations.md)** — CI, health check, caching, AI rate limits, PII in prompts
- **[docs/onboarding.md](docs/onboarding.md)** — New hire Slack detection, pilot recommender, Team onboarding, digest lines
- **[docs/roadmap-slack-scrape.md](docs/roadmap-slack-scrape.md)** — Slack Roadmap scan: threads, two-pass AI (suggest + reconcile), Redis pending queue, approve/reject, daily Vercel cron
- **[docs/unreplied-asks.md](docs/unreplied-asks.md)** — **Followups**: founder Slack asks in Slack (channels + group DMs, AI classify-once, nudge via thread reply or hover-revealed **Bulk reply** when someone has multiple open asks)
- **[docs/design-system.md](docs/design-system.md)** — Brand primitives (glass surfaces, spotlight, buttons) and CSS tokens

## Design system

Shared UI lives under **`src/components/brand/`**: `Logo`, `PageHeader`, `GlassSurface`, `PremiumButton`, `DashboardMain` (dashboard background + subtle pointer spotlight), `AmbientPad` / `AmbientSpotlightLayers` + `useSpotlightCssVars` (grid highlight). Global tokens and utilities (`.brand-gradient-text`, `.brand-aurora`, focus `--ring`, **`--surface-toolbar`** / **`--surface-group-header`** for tracker chrome) are in **`src/app/globals.css`**. The app body uses **Inter** via `next/font` in **`src/app/layout.tsx`**. Roadmap / Team / Companies share **`PageToolbar`** and **`EmptyState`** in **`src/components/tracker/`**. Favicon and Open Graph images are generated from **`src/app/icon.tsx`**, **`src/app/apple-icon.tsx`**, and **`src/app/opengraph-image.tsx`**.

## Prerequisites

- Node.js 20+ (LTS recommended; Node 21 may show engine warnings from some dependencies)

## Setup

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   copy .env.example .env.local
   ```

   On macOS/Linux use `cp .env.example .env.local`.

3. Edit `.env.local`: set **`SESSION_SECRET`** and **Redis** (`KV_REST_API_URL` + `KV_REST_API_TOKEN` or `UPSTASH_*`). Redis is required for local dev and production. Set **`ANTHROPIC_API_KEY`** for AI features. Optional: Blob and Slack — see [docs/environment.md](docs/environment.md). **Sign-in:** seed a password with `npx tsx scripts/set-password.ts <email> <password>` (people must exist in tracker JSON with that email), then sign in at `/login` with email + password. Founders can also set passwords from **Team → Login** after the first account works.

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) and sign in. Use the sidebar for **Roadmap**, **Followups** (under Communication), **Companies**, and **Team**. The **Team** page shows a **New hires** strip (first 30 days, only until a pilot project exists) with **Assign onboarding project** (streaming AI recommender: multi-select existing unowned pilots and/or queue new projects via **Create with AI…**; **Continue** runs one **Assignment message** + optional `conversations.invite` pass per pilot; onboarding-partner picker matches Roadmap owner UX) and **Skip** (dismiss someone from the strip until their join date changes). Assigned hires move to the main roster with an **Onboarding** badge; use the **Onboarding** filter or row **… → Onboard employee** to find or reopen the flow. See [docs/onboarding.md](docs/onboarding.md).

**Roadmap UI:** goal rows use a darker band than the project list; each project is a bordered card under the goal; milestones sit on a light shelf under the project bar (compact rows); project rows are indented vs goals; owner cells are compact avatars; goal Slack uses a compact channel chip (hash + add icon when unset). **Collapsed goals** show a clickable **goal delivery strip** after the Slack column: an overlapping **owner avatar stack** (distinct project owners sorted by autonomy desc), rollup **on-time %**, **AI confidence**, and a one-line summary (rollup from child milestone likelihoods + `assessGoalOneLiner`). Clicking opens a **goal delivery popover** with stats, reasoning, a per-project drill-down (worst-first), and an **Actions → New message in channel…** composer that posts a top-level message to the goal's Slack channel via `postGoalChannelMessage`. See [docs/strategic-tracker-slack.md](docs/strategic-tracker-slack.md). Goal **Due date** / **Progress** are rollups (latest milestone due date across projects; milestone completion across projects). **Milestone auto-complete:** when the AI-estimated progress for a milestone's Slack thread reaches **100%**, the milestone is automatically marked **Done** (one-shot per thread reply-count; respects manual reversion until new activity re-triggers the AI). See [docs/strategic-tracker-roadmap-ui.md](docs/strategic-tracker-roadmap-ui.md).

## Data

Redis key **`ecc:tracker:data`**; schema in `src/lib/schemas/tracker.ts`. Seed with `npm run seed:kv -- path/to/tracker.json`. See [docs/data-storage.md](docs/data-storage.md). **Followups** state lives under a separate key **`ecc:unrepliedAsks:data`** ([docs/unreplied-asks.md](docs/unreplied-asks.md)).

## Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Next.js development server |
| `npm run lint` | ESLint (Next.js config) |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run build` | Production build (run when you want a release build) |
| `npm run seed:kv -- <file.json>` | Validate and upload a tracker JSON file to Upstash (needs Redis in `.env.local`) |
| `npx tsx scripts/set-password.ts <email> <password>` | Set bcrypt login password for a roster person in Redis (bootstrap / CLI rotation) |

## Operations

- **CI** — GitHub Actions runs `npm run lint` and `npm run typecheck` on pushes and PRs to `main` / `master`.
- **`GET /api/health`** — JSON liveness: Redis `PING` (no login). Details: [docs/operations.md](docs/operations.md).
- **Draft goal/project AI** — The first “ideas” shortlist when opening the dialog is **server-cached for 10 minutes** (per company for new goals, per parent goal for new projects). The cache is dropped immediately when substantive goal or project fields change, or after TTL. See [docs/operations.md](docs/operations.md#draft-goalproject-ai--ideas-shortlist-cache).
- **Daily executive digest** — Vercel Cron posts an AI summary to `#executive-priorities` every morning at **12:00 UTC (≈ 8:00 AM ET)** from `GET /api/cron/executive-digest`. It reads the last 7 days of channel messages, cross-references the tracker, and only surfaces **new / interesting / problematic** items since the previous digest (deduped in Redis). Configure `SLACK_EXECUTIVE_PRIORITIES_CHANNEL_ID`, `ECC_PUBLIC_BASE_URL` (default `https://admin.mlabs.vc`), and `CRON_SECRET` — see [docs/environment.md](docs/environment.md) and [docs/operations.md](docs/operations.md#daily-executive-digest).
- **Onboarding detector** — Vercel Cron calls `GET /api/cron/onboarding-detector` three times daily to scan Slack for new-hire welcome threads and update the roster. Same `CRON_SECRET` auth. See [docs/onboarding.md](docs/onboarding.md) and [docs/operations.md](docs/operations.md#onboarding-detector-cron).
- **Followups scan** — Vercel Cron calls `GET /api/cron/unreplied-asks-scan` hourly to classify new founder Slack messages and refresh thread reply state (Redis key `ecc:unrepliedAsks:data`). Same `CRON_SECRET` auth. **Refresh now** on Followups uses `POST /api/unreplied-asks/scan` and streams **NDJSON** progress to the UI. See [docs/unreplied-asks.md](docs/unreplied-asks.md) and [docs/operations.md](docs/operations.md#followups-unreplied-asks-cron).
- **Roadmap Slack sync** — Vercel Cron calls `GET /api/cron/slack-roadmap-sync` once daily (UTC midnight, see `vercel.json`) to scan each company’s Slack (threaded history, 2-day window) and refresh the **pending review** queue in Redis (`ecc:slackSuggestions:data`). Same **`CRON_SECRET`** auth and Slack user token as other Slack features. The Roadmap **scan** button and nav badge surface items for **approve/reject** in-app. See [docs/roadmap-slack-scrape.md](docs/roadmap-slack-scrape.md).

## Troubleshooting

Stale Next.js cache: see [docs/development.md](docs/development.md).

## Documentation

| Doc | Contents |
| --- | -------- |
| [docs/strategic-tracker.md](docs/strategic-tracker.md) | Roadmap doc index (links to data model, Slack, UI, AI) |
| [docs/strategic-tracker-data-model.md](docs/strategic-tracker-data-model.md) | Companies, Team, hierarchy, Redis |
| [docs/strategic-tracker-slack.md](docs/strategic-tracker-slack.md) | Slack import, channels, milestone threads |
| [docs/strategic-tracker-roadmap-ui.md](docs/strategic-tracker-roadmap-ui.md) | Roadmap editing, filters, URLs |
| [docs/strategic-tracker-ai-auth.md](docs/strategic-tracker-ai-auth.md) | Auth, Assistant, AI create/update |
| [docs/environment.md](docs/environment.md) | `.env.local` reference (Redis, AI, Blob, Slack) |
| [docs/data-storage.md](docs/data-storage.md) | Redis key, seed, backup, uploads |
| [docs/operations.md](docs/operations.md) | CI, health, cache tags, AI rate limits, PII redaction |
| [docs/onboarding.md](docs/onboarding.md) | New hire detection, pilot recommender, Team onboarding |
| [docs/unreplied-asks.md](docs/unreplied-asks.md) | Followups: founder Slack asks with no teammate reply (wall + nudge) |
| [docs/roadmap-slack-scrape.md](docs/roadmap-slack-scrape.md) | Slack Roadmap scan, pending queue, cron, approvals |
| [docs/development.md](docs/development.md) | Local dev troubleshooting |
| [docs/design-system.md](docs/design-system.md) | Brand components, spotlight intensities, tokens |

Other files under `docs/` (e.g. internal prompts or rollout notes) are supplementary.
