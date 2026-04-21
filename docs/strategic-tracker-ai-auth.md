# Roadmap: auth and AI

MLabs-internal. For Roadmap editing and filters, see [strategic-tracker-roadmap-ui.md](strategic-tracker-roadmap-ui.md). For environment variables (`ANTHROPIC_*`, `SESSION_SECRET`), see [environment.md](environment.md). For AI rate limits and PII redaction, see [operations.md](operations.md).

## Auth

Users sign in at `/login` with **email + password**. The email must match a team member’s **work email** on their `Person` record; the password is verified against a **bcrypt hash** stored in Redis on that person (`passwordHash`). Founders manage passwords from **Team → Login**; you can also run `npx tsx scripts/set-password.ts <email> <password>` against Redis to bootstrap or rotate. Sessions use a signed HTTP-only cookie (`SESSION_SECRET` + `jose`). No OAuth or NextAuth in the current build.

### Team → Login column (Create Login / Send new password)

The Team page Login column replaces the earlier manual "Set password / Change / Remove" controls with a Slack-delivered flow (`src/server/actions/auth-admin.ts`):

- **Create Login** (no password yet) — opens a confirmation dialog. On confirm, the server generates a strong 24-char password (ambiguous chars like `0/O/1/l/I` excluded), saves the bcrypt hash on the person, opens a Slack MPIM with the caller (Robby), Nadav (`resolveNadavSlackUserId`), and the target, and posts a single message that includes the login URL (`https://admin.mlabs.vc`), the person's work email, and the password wrapped in a Slack code span so it stays a hand-copyable token. The button is disabled until the person has a Slack user ID (needed to open the DM).
- **"…" dropdown** (login already set) — offers:
  - **Send new password** — same flow as Create Login but worded as a rotation; the previous password stops working the moment the new hash is saved.
  - **Remove login access** — clears `passwordHash`. Hidden for founders, and additionally rejected server-side in `setPersonPassword(..., null)` so a founder can never be locked out via this UI.
- If Slack delivery fails (MPIM open error, `chat.postMessage` missing scope, etc.) the server action rolls back to the previous hash so the recipient is never stranded with credentials they never received.

Founders are also blocked from the row-level **Delete team member** action (`deletePerson` in `src/server/actions/tracker.ts`) as a defense-in-depth measure on top of the row menu hiding the button.

## AI assistant

The dashboard includes a floating **Assistant** control (bottom-right), wrapped in `AssistantProvider` (`src/contexts/AssistantContext.tsx`) so any client component can call **`openAssistant({ type, id, label })`** to open the panel with a **tagged** goal, project, or milestone (used by **Discuss in chat** on Roadmap rows).

It calls `POST /api/assistant` with `{ question, history?, entityContext? }`. When `entityContext` is set (`{ type: 'goal' | 'project' | 'milestone', id, label }`), the handler prepends a focused block built by `buildEntityFocusBlock` (`src/lib/assistantEntityFocus.ts`) before the usual instructions; the **full** tracker JSON is still appended so questions can span the workspace. The handler loads tracker data via `getRepository().load()` (Redis), embeds it in the Claude system prompt, and streams the reply as `text/plain`. Requires `ANTHROPIC_API_KEY` in `.env.local` (optional `ANTHROPIC_MODEL`). The route is protected by the same session middleware as other app routes. The **Send** button in the footer turns into **Stop** during streaming — it aborts the in-flight `fetch` and saves whatever text has arrived so far as a completed turn.

### Suggested questions

When the chat is empty, the panel streams **four** bubble cards in a **masonry** layout (2-col on ≥640px, 1-col on mobile). The route (`POST /api/assistant/suggestions`) returns **JSONL** — one `{ short, full, category }` object per line. **More suggestions** calls the same route with `{ more: true, exclude: [{ short, full }, …] }` (every card already shown) so the model returns **four additional** non-duplicative questions; results are cached separately per exclude-set (`ecc:assistant:suggestions:v3:more:<rev+entity>:<exclude-hash>`). The initial batch uses `ecc:assistant:suggestions:v3:init:<rev+entity>`. Each card shows a category badge, the short label, and a preview of the full question; **click inserts `full` into the input without submitting**. Four skeleton placeholders show until the first batch arrives; a dashed pulse card appears while another batch streams. Bump the `v3` prefix in the route if the schema or caching strategy changes.

`GET /api/assistant/entities` includes **`revision`** (tracker document revision). The client persists the **full merged suggestion list** (initial + every “more” batch) in **`localStorage`** under `ecc-assistant-suggestion-list-v1` keyed by `revision` + focused-entity id, so closing and reopening the assistant still shows all loaded cards until the roadmap changes (revision bump) or the focused entity changes.

## AI field update (goals/projects)

`POST /api/ai-update` accepts `{ type: 'goal' | 'project', goalId? | projectId?, currentFields, message?, history? }` and streams a conversational update flow; the model asks short questions then returns a fenced JSON object with the textarea fields to change. The client (`AiUpdateDialog`) shows **before/after** per field and applies patches via `updateGoal` / `updateProject`. Same Anthropic streaming pattern as `POST /api/ai-create`.

## AI create (new goals/projects)

`POST /api/ai-create` accepts `{ type: 'goal' | 'project', companyId? | goalId?, message?, history?, autoMode? }` and streams one of three flows, depending on `autoMode`:

- **Default (ideas shortlist)**: `AiCreateDialog` opens with `autoMode: 'ideas'` so the user sees 5-8 concrete directions immediately instead of an interview. The server returns a fenced `{ "ideas": [{ "title", "category", "rationale" }] }` payload, rendered as a 2-column card grid with per-category icons + color accents (growth, revenue, retention, product, quality, ops, strategy, risk, experiment; unknown categories fall back to `product`). Each card reveals its rationale in-place under a **Why it matters** label when the user hovers the card or focuses it (keyboard). While the shortlist is visible, **Send** with an empty textarea re-runs the brainstorm for a fresh set of directions (replacing a separate control in the footer).
- **Expand a picked idea** (`autoMode: 'expand'`): clicking an idea hides the shortlist during the stream and sends a follow-up with the chosen title/rationale; the server emits a full proposal JSON directly (no further questions) and the normal Revise / Create UI takes over. If the expand stream fails or is aborted, the shortlist reappears.
- **Conversational refinement** (no `autoMode`): typing into the textarea after seeing a shortlist (or at any point) sends a free-form follow-up. The server falls back to CONVERSATION RULES, which may ask a clarifying question, return a refined shortlist, or produce a full proposal, depending on how specific the user's message is.

Onboarding-seeded project creation (`projectSeed` on `AiCreateDialog`) short-circuits the default ideas flow and drafts a proposal directly from the supplied pilot name + definition of done.

After a proposal appears, `AiCreateDialog` offers **Revise with AI** (same idea as **Revise with AI** on Slack thread drafts): your feedback is sent as the next user message so the model updates the proposal without restarting the flow.

The legacy boolean `autoPropose: true` from earlier clients is still accepted and maps to `autoMode: 'ideas'`.

## Future (optional)

- Postgres or another store behind the same `TrackerRepository` interface if Redis JSON blobs become limiting.
- Persist or sync auto-calculated confidence; richer zombie detection if milestone completion timestamps are added.
