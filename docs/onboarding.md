# New hire onboarding (pilot projects)

End-to-end flow for detecting new hires from Slack, recommending a first **pilot project**, and posting an assignment message to the onboarding group DM.

## Concepts

- **Onboarding welcome signal:** Nadav’s welcome to a new hire almost always includes the **Slack communication guidelines** Loom: `https://www.loom.com/share/284a2318019d4ee49c7c7774e36d1752` (often with text like “Please watch this guideline video for how to work with Slack”). The cron detector treats this as a **surefire** onboarding welcome (`src/lib/onboarding-welcome-signals.ts` + `detectNewHires.ts`) so we skip an extra Claude classification step when it matches. Assignment message drafts are instructed not to repeat that boilerplate (`draftAssignmentMessage.ts`).

- **New hire window:** People with a `joinDate` in the last **30 calendar days** (`isNewHire` in `src/lib/onboarding.ts`).
- **Pilot project:** A project where the new hire is **owner** or **assignee**, created **on or after** their join date, while they are still in the new-hire window (see `findPilotProjectsFor`, `isPilotProject`). The **Team recommender dialog** only assigns pilots where the new hire becomes **owner** (empty `ownerId` on an existing card, or a new project they own after **Create with AI…**).
- **Active onboarding (Team roster):** New hire window **and** at least one qualifying pilot project (`isActiveOnboardingEmployee` in `src/lib/onboarding.ts`). These people **do not** appear in the **New hires** strip; they show in the main table with an **Onboarding** badge, and the Team toolbar can filter to **Onboarding** only. Row **…** → **Onboard employee** reopens the recommender for assignments or extra pilots.
- **Priority vocabulary:** Roadmap stores priority as `P0`–`P3` but the UI and AI copy use **Urgent / High / Normal / Low** (see `PRIORITY_MENU_LABEL` in `src/lib/prioritySort.ts`). Use those words in prompts and docs, not “P1” etc., unless referring to the raw field.
- **Person fields:** `welcomeSlackUrl` (permalink to Nadav’s welcome message) and `welcomeSlackChannelId` (Slack channel ID of the onboarding MPIM) are set by the detector when possible. The pilot and onboarding-partner prompts load DM context **only** from that onboarding conversation (or from the channel id embedded in the welcome permalink). If those are missing or unreadable, the app opens a **single** 1:1 DM via `conversations.open` with the new hire’s Slack user id instead of listing every MPIM/IM in the workspace.

## Slack detector (cron)

`GET /api/cron/onboarding-detector` runs on a schedule in `vercel.json` (with `CRON_SECRET`). It scans MPIMs and classifies the first Nadav message (deterministic Loom-guideline match first, else Claude). Two outcomes:

- **Create** — the MPIM has exactly 1 unknown Slack member (not yet on the roster). The detector creates a `Person` row and fills `joinDate`, `role`, `welcomeSlackUrl`, and `welcomeSlackChannelId`.
- **Backfill** — the MPIM has 0 unknowns and exactly 1 roster member who is missing `joinDate`, `welcomeSlackUrl`, or `welcomeSlackChannelId`. The detector fills only those empty fields (never overwrites existing values). Use this when a teammate was added manually with only a Slack user id so the Team page, pilot recommender, and onboarding-partner MPIM flows can light up.

The response from the cron (or a manual `curl` with `CRON_SECRET`) includes both `addedCount` / `added[]` and `backfilledCount` / `backfilled[]`.

**Required:** same Slack + Anthropic configuration as the rest of the app (`SLACK_BILLING_USER_TOKEN` or equivalent for user-context APIs, `ANTHROPIC_API_KEY` for welcome classification). User token scopes used for MPIM/DM history align with milestone threads: `channels:history`, `groups:history`, `im:history`, `mpim:history` as needed for your workspace.

## Team page

**Team** (`/team`) shows a **New hires** section only for new hires **without** a pilot yet (sorted by join recency). After assignment, they drop out of the strip and show in the roster with an **Onboarding** badge until the 30-day window ends. **Assign onboarding project** opens the recommender dialog. Before any AI work runs, the dialog presents a **preflight** step asking the founder for free-text **direction** (e.g. *“Focus her on outbound SDR work for VoiceDrop, not content”*). **Skip** runs the AI with Slack DM + role only; **Start with direction** sends the text to both the pilot and onboarding-partner prompts as the **highest-priority signal** (see `founderContext` in `recommendPilotProject.ts` and `recommendBuddies.ts`; capped at 2,000 chars server-side). The preflight **textarea placeholder** is built from the hire’s roster name, role, and department and **cached in the browser (`localStorage`) for 24 hours** per person (keyed by id + a signature of those fields so roster edits invalidate it). Once the user starts, the dialog shows up to two **existing** project cards that already have an empty owner, fit score 4+, plus one **new-project** card (backfill may add more new-project cards). Streaming UI mirrors **Sync from Slack** (progress bar + analyzing panel). `POST /api/onboarding/recommend/stream` accepts `{ personId, founderContext? }`, streams progress lines, raw model text, then a JSON footer (`RecommendPilotDialog`). The founder **multi-selects** existing pilots (click cards) and/or queues **Create with AI…** projects; **Continue to assignment…** sets the new hire as **owner** on each selected existing card and opens the **Assignment message** dialog **once per queued pilot** in order (dismiss or post advances). **Create with AI…** opens **AI create project** with a seeded name and definition-of-done (owner is set on create). Each assignment step drafts Slack copy (via Claude) and can post to `welcomeSlackChannelId`, attaching the permalink to that project’s first open milestone.

**Slack channel invites (context).** The recommender may suggest up to **8** extra Slack channels (`suggestedChannels` on `OnboardingRecommendation`, catalog-backed ids only). The founder confirms or edits them with checkboxes and can add more via the same searchable picker pattern as Roadmap (`fetchSlackChannelsList` + client cache, see `AddChannelPicker`). Optional **Create new private channel…** runs Slack **`conversations.create`** (`is_private=true`) and prepends the channel to the client cache. That selection is passed into the **Assignment message** dialog, where rows can be removed before send. After a **successful** assignment post (welcome channel or new onboarding-partner MPIM), the app calls Slack **`conversations.invite`** once per channel for the new hire’s Slack user id. The signed-in OAuth user must **already be a member** of each channel; failures surface inline and the dialog stays open so the founder can adjust the list. AI channel suggestions also use **`users.conversations`** hints for onboarding partners and a small set of same-department teammates (see `recommendPilotProject.ts` + `src/lib/slack/memberships.ts`).

**Backfill new-project ideas.** If no existing-project card passes the fit floor, the dialog silently calls `POST /api/onboarding/recommend/additional` (server action `recommendAdditionalPilotProposals` + schema `NewPilotProjectProposalSchema`) to produce **two more** diverse new-project proposals and renders them next to the original. Skeleton cards show while the request is in flight; a short inline error is shown if it fails (the original **Create with AI…** card still works). The prompt is told which proposals are already on screen so it diversifies. The same `founderContext` from preflight is forwarded on this call so backfill ideas honor the founder's direction.

**Skip** removes someone from the New hires strip (with confirmation). The roster stores `skippedFromNewHires: true` on that person. The flag is cleared automatically when their **join date** is updated to a new non-empty value (manual edit, **Refresh from Slack**, or cron), so they can reappear if the window still applies.

### Onboarding partners (accountability + oversight)

Alongside the project cards, the recommender shows **Onboarding partners** — up to **2** teammates picked by Claude from the roster (`recommendBuddies.ts`). Eligibility excludes founders, anyone in the "Founders" department, the new hire themselves, other current new hires (tenure < 30d), and anyone outside **autonomy 3–5** (after `clampAutonomy`). The model only considers those candidates and is told to prefer **same department** and to boost people whose **owned/assigned projects** align with the pilot’s goal or company. Internal identifiers (`BuddyRecommendation`, `SelectedBuddy`, `selectedBuddyIds`, `/api/onboarding/recommend` payload keys) still use the legacy `buddy` names to avoid a breaking schema change — the change is terminology-only in copy and AI prompts.

**Manual picks.** Founders can override the AI with an **Add onboarding partner…** control (`MultiPersonPicker` — same avatar + autonomy grouping + search pattern as the Roadmap owner picker). It lists every non-founder teammate with clamped autonomy ≥ 3 (same eligibility as the AI prompt), excluding the new hire and anyone already on-card. Manual picks appear as extra cards tagged **Manual pick**, are auto-selected when they have a Slack id, and have a per-card **×** to remove them. They flow through the normal selected-partner pipeline into the Assignment message dialog.

Selected partners (default: all returned) flow into the **Assignment message** dialog. When at least one partner has a Slack id, a checkbox **Open new group DM with onboarding partners + Nadav** is enabled and ON by default:

- **ON** → `conversations.open` with **[you (signed-in user) + new hire + Nadav + partners]**, then `chat.postMessage` to that MPIM. Permalink is attached to the project's first open milestone.
- **OFF** → posts to the existing onboarding `welcomeSlackChannelId` (current behavior).

Slack DM/MPIM is **capped at 8 users excluding the caller** — with 1–2 onboarding partners + new hire + Nadav we are well under that. Required user-token scopes for opening the MPIM: **`mpim:write`** (and **`im:write`** for 1:1 fallbacks). Nadav resolution prefers `Person.id === "nadav"` (then any founder named "Nadav"), and finally the `NADAV_SLACK_USER_ID` env fallback.

The assignment-message AI prompt receives the onboarding partners as `<@U…>` mentions and is instructed to include a single closing line naming them as go-to teammates.

## Roadmap signals

The **Signals** filter includes **New hire pilot** (`new_hire_pilot`). It uses roster join dates and project ownership/assignees (passes `people` + today’s local calendar date for faceted counts). URL query: `tags=new_hire_pilot` (comma-separated with other tags).

## Executive digest

`buildOnboardingSignalLines` adds bullets for new hires without a pilot project (see `src/lib/onboarding.ts`, merged in `buildDigest`).

## Environment

| Variable | Purpose |
| -------- | ------- |
| `ROBBY_CALENDLY_URL` | Optional; included in assignment message drafts when set. |
| `NADAV_SLACK_USER_ID` | Optional fallback for Nadav's Slack user id (used by the onboarding-partner group DM when no roster `Person.id === "nadav"` with `slackHandle` exists). |

See [environment.md](environment.md) for Redis, session, Slack, and AI keys.

## API

- `POST /api/onboarding/recommend` — body `{ "personId": "<uuid>", "founderContext"?: string }`. Requires a signed-in session; **429** when AI rate limit is exceeded. Returns `{ ok: true, recommendation, buddies, buddiesError? }` — `recommendation` is the pilot project recommendation (including optional `suggestedChannels` for post-assignment Slack invites), `buddies` is the onboarding-partner recommendation (1–2 candidates; field name is historical), and `buddiesError` is set when partner generation fails for an otherwise-successful response. JSON shapes live in `src/lib/schemas/onboarding.ts`.
- `POST /api/onboarding/recommend/stream` — same auth and body (`founderContext` optional); streams `ECC_ONBOARDING_STATUS:<line>` progress updates (tracker load, onboarding DM context fetch), then raw model text, then a delimiter and JSON footer with the same fields as the non-streaming route.
- `POST /api/onboarding/recommend/additional` — body `{ personId, count?: 1..4, alreadyProposed?: NewPilotProjectProposal[], founderContext?: string }`. Requires a signed-in session; **429** on AI rate limit. Returns `{ ok: true, proposals: NewPilotProjectProposal[] }` with between 1 and `count` proposals. Backfill endpoint used by the dialog when no existing-project cards qualify.
