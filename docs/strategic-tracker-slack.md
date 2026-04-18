# Roadmap: Slack integration

MLabs-internal. For Team/Person fields and Redis storage, see [strategic-tracker-data-model.md](strategic-tracker-data-model.md). For env vars and token scopes, see [environment.md](environment.md). For scanning Slack to suggest goals/projects, see [roadmap-slack-scrape.md](roadmap-slack-scrape.md).

## Team → Import from Slack

Calls `users.list` with the bot token (`SLACK_BOT_USER_OAUTH_TOKEN`), then enriches **join dates** with `users.profile.get` (bot scope **`users.profile:read`**) when `users.list` omitted `profile.start_date`—Slack often returns a slimmer profile on list than on profile get. Join dates map from Slack Atlas **`start_date`** and ISO `YYYY-MM-DD` values in custom profile fields.

Then `team.billableInfo` runs with a **separate user token** (`SLACK_BILLING_USER_TOKEN`, xoxp- with user scope `admin`) because Slack rejects bot tokens for `team.billableInfo` (`not_allowed_token_type`).

The import list includes members whose billing status is **Active** (`billing_active: true` in `billable_info`) **or** **Active guest** (multi- or single-channel guests: `is_restricted` / `is_ultra_restricted`, excluding pending invites via `is_invited_user`). The server omits bots, Slackbot, and **deactivated** users (`deleted`) before that filter. The dialog shows a **Billing** column (Active vs Active guest) and skips members whose Slack user ID is already stored on a person row; profile images use Blob (`BLOB_READ_WRITE_TOKEN`).

## Team → Refresh all from Slack

Toolbar next to Import walks every roster row with a **`slackHandle`** and calls **`refreshPersonFromSlack`** once per person (same logic as the row **Refresh from Slack** menu: `users.info` for name/email/avatar, **`users.profile.get`** for join date when available, profile photo to Blob when configured). The UI runs these **sequentially** with a loading toast showing **progress (n / total)** and the **current name**; each refresh is its own server round trip. A bulk helper `refreshAllFromSlack` also exists on the server without per-step progress.

## Slack channel picker (Goals)

The Slack column uses a **channel picker** that calls `conversations.list` (`types=public_channel,private_channel`). Token order: **`SLACK_CHANNEL_LIST_USER_TOKEN`** (optional user xoxp-) → else **`SLACK_BILLING_USER_TOKEN`** → else **`SLACK_BOT_USER_OAUTH_TOKEN`**. A **user** token lists non-archived channels **that user** can access (including private channels they’re in, e.g. workspace admin). The **bot** token only includes private channels the **bot** joined. **Search** filters by name, topic, or purpose.

When the goal’s **company** is known, **Relevant only** (on by default each time the panel opens) pre-filters to channels whose name, topic, or purpose contains the company **name** or **short name** (case-insensitive); turn it off to list every channel. Selecting stores **channel name** (`slackChannel`) and **channel ID** (`slackChannelId`). The **external-link** icon opens Slack via `https://slack.com/app_redirect?channel={id}`. Use user token scopes `channels:read` and `groups:read` (or `admin`) for listing; bot scopes `channels:read` / `groups:read` apply when listing falls back to the bot.

## Milestone Slack threads (Roadmap)

Each milestone may store **`slackUrl`** (HTTPS permalink to a channel message or thread). Parsing supports `…/archives/C…/p…` and `app.slack.com/.../thread/C…-ts` URLs (`parseSlackThreadUrl` in `src/lib/slack/threads.ts`, re-exported from `@/lib/slack`). Archive links that point at a **reply** in a thread include `?thread_ts=…` with the **root** parent message ts; the parser prefers that so thread fetch uses the correct anchor.

**Read + post** use the **user** token only (`slackUserTokenForThreads`: `SLACK_CHANNEL_LIST_USER_TOKEN` → else `SLACK_BILLING_USER_TOKEN`; no bot fallback) so the workspace member can call **`conversations.replies`** and **`chat.postMessage`** in channels they belong to without inviting the bot. Required **User Token Scopes:** `channels:history`, `groups:history`, `chat:write`.

The UI (`MilestoneSlackThreadInline` beside the milestone name, plus `SlackThreadPopover`, `SlackPingDialog`) shows last-activity vs **24h** staleness, recent lines (with **Team** `slackHandle` + name + profile photo when the message author matches the roster), **deadline risk** and a **one-line thread summary** when the milestone has a **target date** — both come from a single **`assessMilestoneOnTimeLikelihood`** Claude call (thread pace vs calendar, owner **autonomy**, project **complexity**, optional roadmap context; JSON includes `threadSummaryLine` plus likelihood fields), a **Nudge deadline…** draft (`generateDeadlineNudgeMessage`, first-person deadline emphasis), and a **ping** flow that drafts a generic follow-up with **`generateThreadPingMessage`** and sends after confirm via **`pingSlackThread`**.

All three generators (`generateThreadPingMessage`, `generateDeadlineNudgeMessage`, `reviseSlackThreadPingMessage`) build an **Authorship** background block: they resolve the sender via `auth.test` on the user token (preferring the Team roster name) and receive the project owner's name as `assigneeName` (from **`SlackMilestoneThreadPopovers`** → **`SlackPingDialog`**), so Claude writes in first person as the signed-in user, never @-mentions or names itself, and addresses the assignee with their **`<@USER_ID>`** token when asking for an update or pushing on the deadline.

The optional **`summarizeSlackThread`** action remains on the server for other use but is not used by the thread popover.

Likelihood results are stored in memory and **localStorage** (90-day retention; `src/hooks/useMilestoneLikelihood.ts`, `src/lib/browserJsonCache.ts`). Payloads include **`schemaVersion: 2`** and LS content keys use the **`mlh:v2:`** prefix so older entries (e.g. before **`threadSummaryLine`**) are ignored and re-assessed. A new **Claude** assessment runs when there is **no** stored result yet, when the cache is **legacy** (before reply-count tagging or schema **v2**), or when **`replyCount`** from `fetchSlackThreadStatus` **differs** from the count at last assessment (new replies). Assessments are **queued** with limited concurrency (`src/lib/likelihoodAssessQueue.ts`) so large Roadmaps do not stampede the API.

Message text normalizes Slack **mrkdwn** (user/channel mentions, links, common `:emoji:` shortcodes). Server actions live under `src/server/actions/slack/` (barrel `src/server/actions/slack/index.ts`); thread **status** uses a **one-hour** cache (popover reuses a fresh entry; **force** refresh after a successful ping). Keys: thread URL and roster ids when hints are used (`src/lib/slackThreadStatusCache.ts`).
