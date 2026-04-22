# Environment variables

Copy `.env.example` to `.env.local` and set values below. The app does not commit secrets.

## Required for running the app

| Variable | Purpose |
| -------- | ------- |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Upstash / Vercel KV REST API (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). Tracker JSON lives in Redis; there is no local `tracker.json` store. |
| `SESSION_SECRET` | Long random string used only to sign the session cookie (`jose`). |

**Sign-in** does not use env-based usernames/passwords. Each user signs in with their **work email** (on their `Person` record) and a **bcrypt hash** stored in tracker JSON (`passwordHash` on `Person`). Founders set passwords from **Team → Login**, or bootstrap with `npx tsx scripts/set-password.ts <email> <password>` (see [data-storage.md](data-storage.md)).

## AI (optional but expected in production)

| Variable | Purpose |
| -------- | ------- |
| `ANTHROPIC_API_KEY` | Enables the **Assistant** (floating button), **Update with AI…**, **AI create**, company **Generate from website…**, Slack thread drafting/summaries, and milestone likelihood. Without it, those features return a configuration error. |
| `ANTHROPIC_MODEL` | Optional override for the default Claude model (e.g. `claude-sonnet-4-6`). |
| `ANTHROPIC_CLASSIFY_MODEL` | Optional model for **Followups** classify-once (ask vs. noise). Default: `claude-haiku-4-5` (fast / high volume). Override if you want Sonnet for classification. |
| `ROBBY_CALENDLY_URL` | Optional; included in **new hire pilot** assignment Slack drafts when set (Team onboarding). |
| `NADAV_SLACK_USER_ID` | Optional fallback Slack user id for **Nadav** (used by the new hire **onboarding-partner group DM** when no roster `Person.id === "nadav"` with `slackHandle` exists). Format: `U01234ABCDE`. |

## Images (optional)

| Variable | Purpose |
| -------- | ------- |
| `BLOB_READ_WRITE_TOKEN` | **Vercel Blob** for company logos and people photos in production. Without it, uploads use `public/uploads/` locally. |

## Slack (optional)

Slack integration is optional until you use **Team → Import from Slack**, **Roadmap** channel pickers, or **milestone Slack threads**.

### Bot token

- **`SLACK_BOT_USER_OAUTH_TOKEN`** — Bot User OAuth Token (`xoxb-`). Used for `users.list` and related APIs.
- Recommended bot scopes include `users:read`, **`users.profile:read`** (join dates via `users.profile.get` / Slack Atlas), and `users:read.email` if you want emails on import.

### Billing-aligned roster (Team import)

- **`SLACK_BILLING_USER_TOKEN`** — **User** OAuth token (`xoxp-`) with the **`admin` user scope** for [`team.billableInfo`](https://api.slack.com/methods/team.billableInfo). Slack does **not** accept bot tokens for this method (`not_allowed_token_type`).
- Add **User Token Scopes** → `admin` in the Slack app, reinstall, complete OAuth once as a workspace admin, then paste the user token.
- The bot scope `team.billing:read` only covers `team.billing.info` (workspace plan), not per-member `billing_active`.
- The import list includes users with `billing_active: true` **or** signed-in workspace guests (`is_restricted` / `is_ultra_restricted`).

### Roadmap channel listing

- **`conversations.list`** uses **`SLACK_CHANNEL_LIST_USER_TOKEN`** (optional `xoxp-`) if set, else **`SLACK_BILLING_USER_TOKEN`** when set, else the **bot** token.
- A **user** token lists private channels **you** can access (e.g. workspace admin); the bot only lists private channels the **bot** was invited to.
- Optional **`SLACK_CHANNEL_LIST_USER_TOKEN`** overrides the billing token for listing only. Use user scopes **`channels:read`** and **`groups:read`** (or `admin`) on that token.

### Milestone Slack threads (Roadmap)

Paste a thread or message permalink on each milestone’s Slack cell. The app uses the **same user token** (not the bot) for `conversations.replies` and `chat:write` so you can **read thread activity** and **post follow-ups as yourself** in channels you’re in.

Add **User Token Scopes** **`channels:history`**, **`groups:history`**, and **`chat:write`**, reinstall the app, and re-run user OAuth.

Roadmap UI includes a **status dot** (green = activity within 24h, amber = quiet longer), a **popover** with recent messages and **AI summarize**, **deadline on-time likelihood** (Claude + thread context — cached ~10 minutes), **Nudge deadline…**, and **Ping thread** (draft, edit, confirm before send). The inline thread strip can show a small **on-time %** after you’ve opened the popover once (compact project row shows it only for **high/critical** risk). These need `ANTHROPIC_API_KEY` where noted in the UI.

Profile photos from Slack import use **Vercel Blob** when `BLOB_READ_WRITE_TOKEN` is set. Roster duplicates are skipped by Slack user ID.

### Team roster message-based enrichment (Role / Department / Join Date fallback)

**Import from Slack** and **Refresh all from Slack** on the Team page use Slack `search.messages` (`query=from:<@USERID>`) to backfill empty **Role**, empty **Department**, and empty **Join Date** fields from a person’s last ~50 messages (AI-inferred role/dept via Claude; oldest-message `ts` for the join-date fallback). Existing non-empty values are never overwritten.

Add **User Token Scope `search:read`** to the same `xoxp-` token used for `SLACK_BILLING_USER_TOKEN` (or `SLACK_CHANNEL_LIST_USER_TOKEN` if you prefer that one), reinstall the app, and re-run user OAuth. Without the scope the roster import/refresh still runs—the enrichment is silently skipped.

Requires `ANTHROPIC_API_KEY` for the role/department inference; the join-date fallback is pure Slack data and works without it. See [strategic-tracker-slack.md](strategic-tracker-slack.md#message-based-enrichment-role--department--join-date-fallback) for the algorithm.

## Daily executive digest (optional)

A Vercel Cron job can post an AI-generated digest to `#executive-priorities` every morning. It reads the last 7 days of channel messages, joins them with the current tracker (at-risk / spotlight / P0–P1 / upcoming milestones), and surfaces only **new, interesting, or problematic** items since yesterday's digest. See [operations.md](operations.md#daily-executive-digest) for the full runbook.

| Variable | Purpose |
| -------- | ------- |
| `SLACK_EXECUTIVE_PRIORITIES_CHANNEL_ID` | Slack **channel ID** (not name, e.g. `C0123456789`) where the digest is posted. The user token must be a member of the channel. |
| `ECC_PUBLIC_BASE_URL` | Base URL prepended to Roadmap deep links in the digest. Defaults to `https://admin.mlabs.vc`. |
| `CRON_SECRET` | Bearer secret required by `GET /api/cron/executive-digest`. Vercel Cron injects this automatically when the variable exists at build time. |
| `DIGEST_POST_FAILURES` | Optional (`1`) — post a short `Digest failed: …` line into the channel on errors instead of silent logs. |

Slack user-token scopes reused from the milestone-thread flow cover the digest as-is: `channels:history`, `groups:history`, and `chat:write`.

## New hire onboarding (optional)

See [onboarding.md](onboarding.md) for the pilot recommender, cron detector, and Team flows. Reuses the same Slack user token and `ANTHROPIC_API_KEY` as other AI features.

The **onboarding-partner group DM** action (Team → Assign onboarding project → assignment dialog → "Open new group DM with onboarding partners + Nadav") opens a multi-person DM via `conversations.open` and posts as the OAuth user. Requires the user token to also have **`mpim:write`** (and ideally **`im:write`** for 1:1 fallback). Resolves Nadav from `Person.id === "nadav"`, then any founder named "Nadav", then `NADAV_SLACK_USER_ID` env override.

**Optional channel invites after assignment:** To suggest channels using teammate membership signals, add user scopes that allow **`users.conversations`** for other users (typically **`users:read`**, **`channels:read`**, and **`groups:read`** alongside your existing history/write scopes — Slack returns `missing_scope` if the token cannot list that user’s channels). To run **`conversations.invite`** for the new hire after the assignment message posts, add **`channels:write.invites`** (public channels) and **`groups:write.invites`** (private channels). The inviting user must already be in each channel; private invites need the private-channel invite scope.

**Create private channel from the recommender:** The pilot dialog can call **`conversations.create`** with `is_private=true`. Add the **`groups:write`** user scope on the Slack app (private channel creation), reinstall, and re-authorize OAuth.

## See also

- [data-storage.md](data-storage.md) — Redis key, seeding, backups
- [strategic-tracker.md](strategic-tracker.md) — Roadmap documentation index
- [onboarding.md](onboarding.md) — New hire pilot projects and Slack onboarding
- [strategic-tracker-data-model.md](strategic-tracker-data-model.md) — Data model; [strategic-tracker-roadmap-ui.md](strategic-tracker-roadmap-ui.md) — Roadmap UI
- [operations.md](operations.md) — CI, health, caching, AI rate limits, PII in prompts
