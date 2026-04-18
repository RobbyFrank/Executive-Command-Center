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
- **Sidebar:** `ecc.sidebar.collapsed` is set as an HTTP cookie when the user toggles collapse (`src/lib/sidebar-prefs.ts`) so `src/app/(dashboard)/layout.tsx` can pass `initialCollapsed` into `Sidebar` and avoid a wrong first paint. **localStorage** using the same key still wins on hydration when present.
- **Assistant:** **Escape** closes the panel; on viewports `md` and up the dimmed backdrop is omitted so the main Roadmap stays usable beside the panel (`AiAssistantButton`).

## AI rate limiting

Anthropic-backed routes use `@upstash/ratelimit` with the same Redis client as the tracker (see `src/lib/ai-rate-limit.ts`): **60 requests per minute per signed-in user** (sliding window). Excess requests return **429** with `Retry-After`.

## PII in LLM prompts

`src/lib/tracker-redact.ts` removes **email**, **phone**, and **estimated monthly salary** from the tracker JSON embedded in assistant / AI create / AI update prompts. Slack thread drafting still receives full in-memory data in `buildMilestoneThreadContextBlock` (it does not echo salary into the prompt text).
