# Executive Command Center

Next.js app for **MLabs portfolio** roadmaps: companies, goals, projects, milestones, team roster, Slack-assisted workflows, and an in-app AI assistant. Tracker data is a single JSON document in **Upstash Redis** with **optimistic locking** (`revision` + compare-and-set).

**Where to read more**

- **[docs/strategic-tracker.md](docs/strategic-tracker.md)** — Roadmap doc index (data model, Slack, UI, AI); see also [docs/project-outline.md](docs/project-outline.md) for strategic framing
- **[docs/environment.md](docs/environment.md)** — Environment variables (Redis, AI, Blob, Slack tokens)
- **[docs/data-storage.md](docs/data-storage.md)** — Redis key, seed/import, backups, images
- **[docs/operations.md](docs/operations.md)** — CI, health check, caching, AI rate limits, PII in prompts
- **[docs/roadmap-slack-scrape.md](docs/roadmap-slack-scrape.md)** — Scan Slack for suggested goals/projects

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

5. Open [http://localhost:3000](http://localhost:3000) and sign in. Use the sidebar for **Roadmap**, **Companies**, and **Team**.

## Data

Redis key **`ecc:tracker:data`**; schema in `src/lib/schemas/tracker.ts`. Seed with `npm run seed:kv -- path/to/tracker.json`. See [docs/data-storage.md](docs/data-storage.md).

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
| [docs/roadmap-slack-scrape.md](docs/roadmap-slack-scrape.md) | Slack scan API and batch import |
| [docs/development.md](docs/development.md) | Local dev troubleshooting |

Other files under `docs/` (e.g. internal prompts or rollout notes) are supplementary.
