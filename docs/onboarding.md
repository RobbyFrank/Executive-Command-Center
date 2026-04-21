# New hire onboarding (pilot projects)

End-to-end flow for detecting new hires from Slack, recommending a first **pilot project**, and posting an assignment message to the onboarding group DM.

## Concepts

- **Onboarding welcome signal:** Nadav’s welcome to a new hire almost always includes the **Slack communication guidelines** Loom: `https://www.loom.com/share/284a2318019d4ee49c7c7774e36d1752` (often with text like “Please watch this guideline video for how to work with Slack”). The cron detector treats this as a **surefire** onboarding welcome (`src/lib/onboarding-welcome-signals.ts` + `detectNewHires.ts`) so we skip an extra Claude classification step when it matches. Assignment message drafts are instructed not to repeat that boilerplate (`draftAssignmentMessage.ts`).

- **New hire window:** People with a `joinDate` in the last **30 calendar days** (`isNewHire` in `src/lib/onboarding.ts`).
- **Pilot project:** A project where the new hire is **owner** or **assignee**, created **on or after** their join date, while they are still in the new-hire window (see `findPilotProjectsFor`, `isPilotProject`).
- **Person fields:** `welcomeSlackUrl` (permalink to Nadav’s welcome message) and `welcomeSlackChannelId` (Slack channel ID of the onboarding MPIM) are set by the detector when possible.

## Slack detector (cron)

`GET /api/cron/onboarding-detector` runs on a schedule in `vercel.json` (with `CRON_SECRET`). It scans MPIMs and classifies the first Nadav message (deterministic Loom-guideline match first, else Claude). Two outcomes:

- **Create** — the MPIM has exactly 1 unknown Slack member (not yet on the roster). The detector creates a `Person` row and fills `joinDate`, `role`, `welcomeSlackUrl`, and `welcomeSlackChannelId`.
- **Backfill** — the MPIM has 0 unknowns and exactly 1 roster member who is missing `joinDate`, `welcomeSlackUrl`, or `welcomeSlackChannelId`. The detector fills only those empty fields (never overwrites existing values). Use this when a teammate was added manually with only a Slack user id so the Team page, pilot recommender, and buddy MPIM flows can light up.

The response from the cron (or a manual `curl` with `CRON_SECRET`) includes both `addedCount` / `added[]` and `backfilledCount` / `backfilled[]`.

**Required:** same Slack + Anthropic configuration as the rest of the app (`SLACK_BILLING_USER_TOKEN` or equivalent for user-context APIs, `ANTHROPIC_API_KEY` for welcome classification). User token scopes used for MPIM/DM history align with milestone threads: `channels:history`, `groups:history`, `im:history`, `mpim:history` as needed for your workspace.

## Team page

**Team** (`/team`) shows a **New hires** section (sorted: no pilot first, then by days since join). **Assign onboarding project** opens the recommender dialog (three cards: two existing projects + one new-project proposal). The pilot + buddy suggestions are produced with the same streaming UX as **Goal creation with AI**: `POST /api/onboarding/recommend/stream` streams the model’s raw reply, then appends a JSON footer with the parsed recommendation and buddy list (see `RecommendPilotDialog` + `claudePlainTextStream`). Assigning an existing project updates the tracker; **Create with AI…** opens **AI create project** with a seeded name and definition-of-done. After assignment, an **Assignment message** dialog drafts Slack copy (via Claude) and can post to `welcomeSlackChannelId`, attaching the permalink to the project’s first open milestone.

**Skip** removes someone from the New hires strip (with confirmation). The roster stores `skippedFromNewHires: true` on that person. The flag is cleared automatically when their **join date** is updated to a new non-empty value (manual edit, **Refresh from Slack**, or cron), so they can reappear if the window still applies.

### Suggested buddies (accountability + oversight)

Alongside the project cards, the recommender shows **Suggested buddies** — up to **2** experienced teammates picked by Claude using the full roster (`recommendBuddies.ts`). Eligibility excludes founders, anyone in the "Founders" department, the new hire themselves, and other current new hires (tenure < 30d). The model is told to prefer **same department + non-trivial tenure** and to boost candidates whose **owned/assigned projects** sit under the **same goal or company** as the chosen pilot.

Selected buddies (default: all returned) flow into the **Assignment message** dialog. When at least one buddy has a Slack id, a checkbox **Open new group DM with buddies + Nadav** is enabled and ON by default:

- **ON** → `conversations.open` with **[you (signed-in user) + new hire + Nadav + buddies]**, then `chat.postMessage` to that MPIM. Permalink is attached to the project's first open milestone.
- **OFF** → posts to the existing onboarding `welcomeSlackChannelId` (current behavior).

Slack DM/MPIM is **capped at 8 users excluding the caller** — with 1–2 buddies + new hire + Nadav we are well under that. Required user-token scopes for opening the MPIM: **`mpim:write`** (and **`im:write`** for 1:1 fallbacks). Nadav resolution prefers `Person.id === "nadav"` (then any founder named "Nadav"), and finally the `NADAV_SLACK_USER_ID` env fallback.

The assignment-message AI prompt receives the buddies as `<@U…>` mentions and is instructed to include a single closing line naming them as accountability partners.

## Roadmap signals

The **Signals** filter includes **New hire pilot** (`new_hire_pilot`). It uses roster join dates and project ownership/assignees (passes `people` + today’s local calendar date for faceted counts). URL query: `tags=new_hire_pilot` (comma-separated with other tags).

## Executive digest

`buildOnboardingSignalLines` adds bullets for new hires without a pilot project (see `src/lib/onboarding.ts`, merged in `buildDigest`).

## Environment

| Variable | Purpose |
| -------- | ------- |
| `ROBBY_CALENDLY_URL` | Optional; included in assignment message drafts when set. |
| `NADAV_SLACK_USER_ID` | Optional fallback for Nadav's Slack user id (used by the buddy group DM when no roster `Person.id === "nadav"` with `slackHandle` exists). |

See [environment.md](environment.md) for Redis, session, Slack, and AI keys.

## API

- `POST /api/onboarding/recommend` — body `{ "personId": "<uuid>" }`. Requires a signed-in session; **429** when AI rate limit is exceeded. Returns `{ ok: true, recommendation, buddies, buddiesError? }` — `recommendation` is the pilot project recommendation, `buddies` is the buddy recommendation (1–2 candidates), and `buddiesError` is set when buddy generation fails for an otherwise-successful response. JSON shapes live in `src/lib/schemas/onboarding.ts`.
- `POST /api/onboarding/recommend/stream` — same auth and body; streams `ECC_ONBOARDING_STATUS:<line>` progress updates (tracker counts, Slack MPIM/IM scan, message fetch), then raw model text, then a delimiter and JSON footer with the same fields as the non-streaming route. Slack member/history fetches run in small parallel batches to reduce wait time.
