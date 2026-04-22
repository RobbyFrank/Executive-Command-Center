# Followups (Slack unreplied asks)

The **Followups** page in the app (`/unreplied`, sidebar **Communication → Followups**) lists Slack messages from **founders** (roster `isFounder` / legacy ids `robby` & `nadav`) in **public/private channels** and **group DMs** (`mpim`) that:

1. Were classified once by Claude as an **ask** (question, assignment, or request).
2. Are **the newest message in their thread** — any newer message (teammate reply, founder follow-up, bot, anything) hides the row on the next scan.
3. Are older than **48 business hours** since the message, counting only time on **Monday–Friday** (weekend hours excluded).

Each row has four compact icon buttons on the right (left → right: **Preview thread** / **Quick reply** / **Snooze** / **Dismiss**) so triage is one click each. **Quick reply** opens a lightweight AI popover (`src/components/unreplied/QuickReplyPopover.tsx`) that auto-drafts a short context-grounded reply, shows it as a **Slack-style preview** first, and turns into an editable draft when you **click the preview**; then you can post back to the same thread. The heavier Roadmap `SlackPingDialog` is no longer used here; see "Quick reply flow" below.

## Reply detection (one rule)

The scanner calls `conversations.replies` on each open ask's thread and compares the thread's `latestTs` to the ask's own `ts`. If **anything** is newer, `hasExternalReply` flips to `true` and the row drops off the wall. There is no founder-set filtering, no bot-author filtering, no "last external reply" heuristic — matches what the user sees in the **Thread preview** popover.

Because `search.messages` does not return `thread_ts`, the scanner derives the real thread root from the permalink's `?thread_ts=` query param (`parseSlackThreadUrl` in `src/lib/slack/threads.ts`). Old entries stored before this fix had `threadTs = ts` baked in; every scan now self-heals those by re-parsing the permalink before calling Slack, so no migration is needed.

Every open ask is re-polled on every scan (no "≥48 business hours" gate on refresh), so a reply that arrives minutes after the ask still hides the row on the next scan. Thread-fetch errors (`channel_not_found`, rate limits, etc.) are logged with `channelId|ts` and tallied into the `complete` progress event's `threadErrors` field; the final scan banner turns amber and shows the count when any fail.

## Reactions

`conversations.replies` already includes a `reactions` array on each message (no extra API call, no extra scope) — the scanner extracts reactions on the **ask message itself** and persists them on the `AskEntry` (`reactions: [{ name, count, users }]`), so the Followups row can show teammate acknowledgments (e.g. `:eyes:` / `:thumbsup:`) even before a full text reply lands. The **Thread preview** popover also renders reactions on every preview message by piping them through `fetchSlackThreadStatus.recentMessages[].reactions`.

Rendering uses the existing `expandSlackEmojiShortcodes` helper (`src/lib/slackDisplay.ts`, backed by `node-emoji` + a Slack-first shortcode map). Custom workspace emojis that aren't in the map fall back to their raw `:name:` text — still readable and signals that *someone* reacted. The UI is a small pill row; see `src/components/unreplied/SlackReactionsRow.tsx`.

## Effective assignee (thread-derived)

The Followups wall groups rows by the **effective assignee** — whoever the founder's ask is clearly replying to, derived from thread context rather than the classifier's one-shot guess at ask time.

Rule: starting from the founder's ask, walk backward through the thread. Collect distinct non-founder, non-bot authors until we hit an earlier founder message or the start of the thread. That set is the effective assignees, most-recent first.

Examples (oldest → newest):

- `[Robby(founder), Ghulam, Robby(ask)]` → `[Ghulam]` — classic "Ghulam replied, Robby followed up" case.
- `[Robby(founder), James, Dave, Robby(ask)]` → `[Dave, James]` — both are candidates; the wall header shows "Dave & James" with both avatars.
- `[Robby(ask)]` alone — the ask is the thread-starter; we fall back to the classifier's `assigneeSlackUserId` so the row still groups meaningfully.

The scan computes this on every refresh (`conversations.replies` is already fetched for the reply-detection rule) and persists it on the entry as `effectiveAssigneeSlackUserIds` (`src/server/actions/unrepliedAsks/scan.ts` → `computeEffectiveAssignees`). `getUnrepliedAsksSnapshot` resolves each id to `{ name, profilePicturePath, onRoster }` via the same cache-backed `resolveSlackUserDisplays` batch used elsewhere, and the UI renders:

- Single-person groups: one avatar + name (unchanged from the previous behaviour when it worked).
- Multi-person groups: an overlapping avatar stack (`AssigneeAvatarStack`) and a joined label ("Dave & James", "Dave, James & Priya"). Up to 3 avatars are stacked; more overflow into a "+N" chip.
- "Add to Team" CTA: fires in parallel for **every** off-roster assignee in the group. The button label switches to "Add N to Team" when multiple people still need importing.

There's no more "Unknown assignee" bucket whenever the thread has any teammate message — the classifier guess is only used as a last resort (ask is the only message in the thread).

## Off-roster @mention resolution

Slack user IDs that appear as `<@U…>` mentions inside message text (e.g. an external teammate on a shared channel, a guest, or someone not yet on the Team roster) resolve through the same **cache-backed batch** the Followups group headers already use (`resolveSlackUserDisplays` — Redis 7d, tries both the user token and the bot token). That means whenever a group header shows a human name and photo for an off-roster assignee, the inline mention chips and the Thread preview message avatars show the **same** name and photo automatically — no extra Slack API calls per render, and no cases where the header resolves but the chip shows a raw `U012…` id. See `src/server/actions/slack/mention-preview.ts` and `buildSlackUserDisplayMaps` in `src/server/actions/slack/thread-ai-shared.ts`.

## Quick reply flow (one-click)

Clicking the **Quick reply** icon (✨ Sparkles, violet tint) on a row opens a compact popover anchored to the button (`QuickReplyPopover`). It immediately calls `generateSlackQuickReply` which:

1. Reads the last ~8 messages of the thread via `conversations.replies` (same helper used for the Thread preview and the deeper ping flow).
2. Prompts Claude to write a short (1-2 sentence) natural reply grounded in that transcript — a brief nudge, acknowledgment, clarification, or answer — addressed at the assignee with their `<@USER_ID>` when natural. The prompt is tuned to "thread ask the user hasn't replied to yet" so the default output fits as a quick follow-up.
3. Renders the draft as a preview (mentions/channels/links styled like Slack). Clicking the preview swaps in an inline `<textarea>` with the raw text (`<@U…>` tokens, etc.) for editing. A small `Revise with AI` input (enter-to-submit) refines in place via `reviseSlackQuickReply` without leaving the popover.
4. **Post to Slack** calls `pingSlackThread` (same helper used by the Roadmap flows), invalidates the thread-status cache so the Thread preview refreshes on next hover, and marks the ask `state: nudged` so it drops off the wall. A `toast.success` confirms.

The icon itself shows a hover tooltip ("Quick reply — AI drafts a short reply grounded in the thread"). The popover closes on outside click / Escape / scroll, and disables everything while posting so double-submit is impossible. The heavier `SlackPingDialog` (full-page modal with spotlight backdrop) is still used by the Roadmap milestone flows but no longer by Followups.

### Bulk reply (per assignee group)

When a person (or combined assignee group) has **two or more** open asks, the sticky group header shows a hover-revealed **Bulk reply** chip (violet outline, Sparkles). It opens `BulkReplyAllDialog` (`src/components/unreplied/BulkReplyAllDialog.tsx`): every ask in that group renders as a card with the original message on the left and the AI draft on the right (side-by-side on `md+`, stacked on narrow screens, with matching shells so both columns align vertically). The **original ask** is capped to roughly **7 lines** of height with `overflow-y` scrolling when longer. Drafts are generated in parallel via `generateSlackQuickReply` as soon as the dialog opens. The draft uses the same **preview-first** affordance as `QuickReplyPopover`: `SlackMentionInlineText` renders `<@U…>` as readable chips until you **click to edit**, then a textarea shows the raw tokens for precise edits. Per card you can **Skip** or **Send** (`pingSlackThread` + `markUnrepliedAskNudged`, same as the single-row Quick reply). **Send all remaining** shows an amber confirmation strip before sequentially posting every still-ready draft. Closing the dialog after any successful send triggers a page refresh so the wall updates. The dialog intentionally omits `Revise with AI` — the single-row Quick reply popover still has it for one-off revision flows; bulk review keeps the action set deliberately small (Skip / Send).

Group DM (`mpim`) rows show participant names instead of the raw `mpdm-…` Slack id. On open, the dialog calls `resolveMpimParticipantLabel(channelId, rosterHints)` (`src/server/actions/slack/mpim-label.ts`) which paginates `conversations.members` and resolves each id through the same Redis-cached `resolveSlackUserDisplays` batch used elsewhere on the Followups page, joining with the `"Dave", "Dave & James", "Dave, James & Priya"` convention. Fallback text is the neutral label **Group DM** if resolution fails.

The three sibling icons in the action cluster are:

- **Preview thread** (`MessageSquare`, neutral zinc) — opens the read-only `FollowupThreadPopover` with the last 5 thread messages, reactions, and the focused ask highlighted.
- **Snooze** (`Clock`, neutral zinc) — opens a small menu (1d, 3d, 7d, 14d, 30d). The choice calls `snoozeUnrepliedAsk(id, days)` so `snoozeUntil = now + N×24h` and the row disappears for that window. It re-surfaces on the next scan **only if it's still unreplied**; the scan keeps refreshing `hasExternalReply` regardless of `snoozeUntil`, so anything that got answered during the snooze stays hidden. A toast confirms the duration.
- **Dismiss** (`EyeOff`, neutral zinc) — sets `state: dismissed` (hides from the wall without posting anything).

## Storage

- **Redis key:** `ecc:unrepliedAsks:data`
- **Schema:** `src/lib/schemas/unrepliedAsks.ts`
- **Read/write:** `src/server/repository/unreplied-asks-storage.ts` (compare-and-set on `revision`, same pattern as the tracker document but a **separate** key so Slack-derived state does not bloat `ecc:tracker:data`).

Each Slack message is keyed by `${channelId}|${ts}`. Classification (`ask` / `not_ask` / `error`) is stored the **first time** that id appears; the scanner does not re-call Claude for the same id. On **Followups**, new-message classification uses **Claude Haiku** by default (`claude-haiku-4-5`; override with `ANTHROPIC_CLASSIFY_MODEL` in [environment.md](environment.md)) for speed and cost; other app AI flows still use `ANTHROPIC_MODEL` (Sonnet by default).

## Slack requirements

Uses the same **user OAuth token** as other thread flows (`SLACK_BILLING_USER_TOKEN` or `SLACK_CHANNEL_LIST_USER_TOKEN`):

- `search:read` — `search.messages` to list each founder’s recent messages (`from:<@USER>` sweeps in `src/lib/slack/user-messages.ts`).
- `channels:history`, `groups:history` — thread replies via `conversations.replies`.

Founders must have **`slackHandle`** set on their roster row (or `NADAV_SLACK_USER_ID` for Nadav when the handle is missing). See [environment.md](environment.md).

## Cron and manual refresh

- **Vercel Cron:** `GET /api/cron/unreplied-asks-scan` hourly (`0 * * * *` in `vercel.json`). Auth: `Authorization: Bearer ${CRON_SECRET}` (same as other crons).
- **In-app:** **Refresh now** on **Followups** (`/unreplied`) calls `POST /api/unreplied-asks/scan` (session cookie). The response is **NDJSON** (`application/x-ndjson`): one JSON object per line with progress events (`slack_search_start`, `classify_progress`, `threads_progress`, `complete`, etc.) so the UI can show a live stepper. The same `runUnrepliedAsksScan` work runs as the cron job. Subject to the **AI rate limit** (Anthropic calls for *new* messages only). `maxDuration` is 300s on this route for long scans.

## Posting identity

Replies are posted with the configured **single** Slack user token. If that token is not the same user as the founder who wrote the original ask, the UI shows a warning that the post will appear as the token holder (see `getSlackPosterAuthContext`).

## User actions

- **Snooze** (`Clock` icon) — menu with 1d, 3d, 7d, 14d, or 30d (`snoozeUnrepliedAsk(id, days)` clamps to 1–30 and sets `snoozeUntil`).
- **Dismiss** — hides the row (`state: dismissed`).
- **Add to Team** — when the assignee has a Slack user id from the classifier but is **not** on the roster, creates a `Person` via `users.info` + the same pipeline as **Team → Import from Slack** (`importSlackMemberByUserId`). If `BLOB_READ_WRITE_TOKEN` is unset, the row is still created but the profile photo step is skipped (toast explains).
- **Quick reply** → AI-drafted popover → post — sets `state: nudged` after a successful post (see "Quick reply flow" below).
- **Bulk reply** (hover-revealed on group header, 2+ open asks) — side-by-side review dialog; each sent thread sets `state: nudged` (see "Bulk reply" above).

## Related code

| Area | Path |
|------|------|
| Scan + classify | `src/server/actions/unrepliedAsks/scan.ts` |
| Streaming manual scan API | `src/app/api/unreplied-asks/scan/route.ts` |
| Server actions / snapshot | `src/server/actions/unrepliedAsks/index.ts` |
| Business-hours helper | `src/lib/businessHours.ts` |
| Wall filter | `src/lib/unrepliedAsksFilters.ts` |
| UI | `src/components/unreplied/UnrepliedAsksView.tsx` |
| Reactions pill row | `src/components/unreplied/SlackReactionsRow.tsx` |
| Thread preview popover | `src/components/unreplied/FollowupThreadPopover.tsx` |
| Quick reply popover | `src/components/unreplied/QuickReplyPopover.tsx` |
| Bulk reply dialog | `src/components/unreplied/BulkReplyAllDialog.tsx` |
| Group DM label resolver | `src/server/actions/slack/mpim-label.ts` |
| Quick reply AI actions | `src/server/actions/slack/thread-ping-revise.ts` (`generateSlackQuickReply` / `reviseSlackQuickReply`) |

See also [strategic-tracker-slack.md](strategic-tracker-slack.md) for milestone thread tooling.
