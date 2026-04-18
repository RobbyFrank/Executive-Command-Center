# Roadmap: auth and AI

MLabs-internal. For Roadmap editing and filters, see [strategic-tracker-roadmap-ui.md](strategic-tracker-roadmap-ui.md). For environment variables (`ANTHROPIC_*`, `SESSION_SECRET`), see [environment.md](environment.md). For AI rate limits and PII redaction, see [operations.md](operations.md).

## Auth

Users sign in at `/login` with **email + password**. The email must match a team member’s **work email** on their `Person` record; the password is verified against a **bcrypt hash** stored in Redis on that person (`passwordHash`). Founders manage passwords from **Team → Login**; you can also run `npx tsx scripts/set-password.ts <email> <password>` against Redis to bootstrap or rotate. Sessions use a signed HTTP-only cookie (`SESSION_SECRET` + `jose`). No OAuth or NextAuth in the current build.

## AI assistant

The dashboard includes a floating **Assistant** control (bottom-right), wrapped in `AssistantProvider` (`src/contexts/AssistantContext.tsx`) so any client component can call **`openAssistant({ type, id, label })`** to open the panel with a **tagged** goal, project, or milestone (used by **Discuss in chat** on Roadmap rows).

It calls `POST /api/assistant` with `{ question, history?, entityContext? }`. When `entityContext` is set (`{ type: 'goal' | 'project' | 'milestone', id, label }`), the handler prepends a focused block built by `buildEntityFocusBlock` (`src/lib/assistantEntityFocus.ts`) before the usual instructions; the **full** tracker JSON is still appended so questions can span the workspace. The handler loads tracker data via `getRepository().load()` (Redis), embeds it in the Claude system prompt, and streams the reply as `text/plain`. Requires `ANTHROPIC_API_KEY` in `.env.local` (optional `ANTHROPIC_MODEL`). The route is protected by the same session middleware as other app routes.

## AI field update (goals/projects)

`POST /api/ai-update` accepts `{ type: 'goal' | 'project', goalId? | projectId?, currentFields, message?, history? }` and streams a conversational update flow; the model asks short questions then returns a fenced JSON object with the textarea fields to change. The client (`AiUpdateDialog`) shows **before/after** per field and applies patches via `updateGoal` / `updateProject`. Same Anthropic streaming pattern as `POST /api/ai-create`.

## AI create (new goals/projects)

`POST /api/ai-create` accepts `{ type: 'goal' | 'project', companyId? | goalId?, message?, history? }`, streams a short interview then a fenced JSON proposal. After a proposal appears, `AiCreateDialog` offers **Revise with AI** (same idea as **Revise with AI** on Slack thread drafts): your feedback is sent as the next user message so the model updates the proposal without restarting the Q&A.

## Future (optional)

- Postgres or another store behind the same `TrackerRepository` interface if Redis JSON blobs become limiting.
- Persist or sync auto-calculated confidence; richer zombie detection if milestone completion timestamps are added.
