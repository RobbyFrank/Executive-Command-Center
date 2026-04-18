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

## See also

- [data-storage.md](data-storage.md) — Redis key, seeding, backups
- [strategic-tracker.md](strategic-tracker.md) — Roadmap documentation index
- [strategic-tracker-data-model.md](strategic-tracker-data-model.md) — Data model; [strategic-tracker-roadmap-ui.md](strategic-tracker-roadmap-ui.md) — Roadmap UI
- [operations.md](operations.md) — CI, health, caching, AI rate limits, PII in prompts
