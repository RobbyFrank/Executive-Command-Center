# Roadmap UI: editing, filters, URLs

MLabs-internal. For data model and storage, see [strategic-tracker-data-model.md](strategic-tracker-data-model.md). For Slack, see [strategic-tracker-slack.md](strategic-tracker-slack.md). For AI routes, see [strategic-tracker-ai-auth.md](strategic-tracker-ai-auth.md).

## Project and goal workflow

**Project** workflow statuses (`ProjectStatusEnum` in `tracker.ts`) are **Idea**, **Pending**, **In Progress**, **Stuck**, **Blocked**, **For Review**, and **Done** — distinct from **goal** statuses (`GoalStatusEnum`). **Blocked** is not chosen in the Status dropdown: it appears when another project is set as **blocked by** and that project’s milestones are not all done (the stored workflow status is unchanged). Legacy project status strings in JSON are normalized on load (e.g. `Not Started` → `Pending`; legacy `Blocked` in old files loads as **Blocked**).

When a milestone’s **`slackUrl`** is saved as a valid `https` permalink and that milestone previously had no valid URL, if the parent **project** is still **Idea** or **Pending**, the server sets the project to **In Progress** (`createMilestone` / `updateMilestone` in `src/server/actions/tracker.ts`).

**Under each goal**, primary projects and **mirrors** of that goal are ordered together so **priority** (P0 first) applies, but any project whose **`blockedByProjectId`** points at another project in that same list is shown **directly under** that blocker (dependents of the same blocker are sorted by priority; chains nest depth-first).

The Roadmap filter bar includes a **Show completed** checkbox: when unchecked, **Done** projects are hidden and goals that would have no visible projects are omitted.

## Scores, priority, owners

**Cost of delay** (on goals) and **complexity** (on projects) are edited with dropdowns 1–5 (`costOfDelay` on goals; `complexityScore` on projects — **complexity** is on the **collapsed** project bar, immediately before **Confidence**). **Priority** is edited on goals and projects separately from those scores. The Roadmap shows **Urgent / High / Normal / Low** with colored **flag** icons; JSON still stores **`P0`–`P3`**.

**Confidence** is **auto-calculated** and shown on both goal and **collapsed** project rows (project **Confidence** aligns under goal **Confidence** when the project name column matches the goal title width — **360px**). Scoring (score **0–5** → **0%–100%**): per project, **no owner or owner not on Team → 0**; otherwise `clamp(1,5, ownerAutonomy - complexity + 3)`; per goal, it is the **plain average** of its child project confidence scores, rounded to the 0–5 band. If there are no projects, the goal shows **0/0%** until projects exist. Hover or focus the cell for a small panel (not a browser tooltip): **project** rows include a short rationale; **goal** rows show the aggregate score and a one-line note that it is an average (no per-project list). Legacy `confidenceScore` on goals in JSON is not edited on the Roadmap grid. Legacy `impactScore` on goals may still be present in JSON but is not edited in the app.

**Owner** on goals and projects shows the assignee’s **profile photo** with **first name** beside it when a photo exists; without a photo it shows **first name · department** when department is set. The goal **DRI** column (directly responsible individual for the goal outcome) only lists **founders** and people with **autonomy 4 or 5**; the picker shows a short note and the server rejects other assignments. Project **owners** still use the full team roster. Project **`type`** (Engineering, Product, etc.) remains in JSON but is not edited on the Roadmap grid.

## Collapsed project bar and goal rows

On the **collapsed** project bar, columns after **Priority** are **Complexity** (1–5 band, shown as three ascending **signal bars** + short label — aligned under the goal **Cost of delay** column), **Confidence** (aligned under the goal **Confidence** column; the Projects sticky label row omits the word “Confidence” because the Goals row above already labels it), **Status**, **Progress**, **Due date** (read-only: same calendar date as the **last milestone** that has a **target date**; shown as `targetDate` on the project in the UI after hierarchy load), then **Next milestone** (first milestone in list order not **Done**; a compact **D**/**W**/**M**/**Y** horizon from its milestone **target date** when set, otherwise **—** — hover for full relative wording, calendar date, and **Milestone *k*/*n***; when the project row is **collapsed** and that milestone has a **Slack thread URL**, a compact last-reply preview appears beside the name; when it has **no** thread URL yet, a **Start Slack thread** control opens the same menu as the milestone Slack affordance — **Draft a new Slack thread with AI…** or **Attach existing Slack thread URL…** (the latter expands the project and focuses the URL field on the next milestone row); when the project is **expanded**, the project row no longer shows that strip — the **next milestone** row shows **`MilestoneSlackThreadInline`** or the same **Start Slack thread** chip in the aligned **Next milestone** column, matching the collapsed project control).

**Description** and **Done when** on projects (`description` / `definitionOfDone`) are edited from the **info icon** beside the project name (floating panel; **click a field** to edit inline). Plan dates in **milestones**; the project due date follows the last dated milestone.

On each **goal** row, columns after **Priority** are **cost of delay**, **Confidence**, and **Slack**. **Goal description** (`measurableTarget`), **Why** (`whyItMatters`), and **Current** (`currentValue`) are edited from the **info icon** beside the goal title (same panel), not in the sticky column header row.

## Inline editing and context menus

**Roadmap** uses **inline editing** for goals, projects, and milestones (default toolbar: tree expansion **Goals only**; **Focus** on/off is persisted in the browser). **Right-click** (context menu) on a **company** header, **goal** row, **project** row, or **milestone** row—or click the row **⋯** (same menu)—for quick actions: e.g. add goal/project/milestone, **rename** (goal title or project name — opens the inline title field), **Update with AI…** (goals and projects — opens `POST /api/ai-update`, see [strategic-tracker-ai-auth.md](strategic-tracker-ai-auth.md)), **Review notes…** (goals and projects — opens the log popover), **Discuss in chat** (goals, projects, milestones — opens the Assistant with that entity tagged), **Mirror to goal…**, **Set blocked by…** (pick any other project; **`blockedByProjectId`** in JSON), **Clear blocked by**, expand or collapse, set **At risk** / **Spotlight** / clear signal, and **delete** (with confirmation when destructive).

While a blocker’s milestones are incomplete (or it has no milestones), the dependent project shows a **Blocked** badge; the badge hides when the blocker reaches 100% milestone progress. Hierarchy also exposes **`isBlocked`** and **`blockedByProjectName`** on project rows for UI.

**Add project** and **Add goal** share a row at the bottom of each goal’s project list (or alone when there are no projects); **Add goal** still creates a new goal for the **company** (`companyId`). **Companies** (name, short name, revenue, logo, add/remove) are managed on the **Companies** page (`/companies`); company rows on Roadmap are read-only headers. A **company** can only be deleted when it has **no goals** (remove or move goals first). A **goal** can only be deleted when it has **no projects** (delete projects first). A **person** can only be deleted when they are not a **goal owner**, **project owner**, or **assignee** on any project.

## Sticky headers

The **Goal** and **Project** column label rows (`TrackerColumnHeaders`) are **sticky** below the measured height of the sticky title/filter toolbar. The **company** header row sticks for the **entire** company block (until that section scrolls away), with **goal** column labels, each **goal** header row, and **project** column labels stacked beneath in order (`top` + `z-index`). Individual project title rows are not sticky so the company bar stays the section-level anchor.

## Search and filters

Use the **search** field at the top of Roadmap to filter by substring across company names and short names, goal text and fields, project names and metadata (including owner and assignee **names** resolved from **Team**), and milestone names and dates.

**Companies** and **Owner** multi-select filters narrow the tree (selected companies only; then goals/projects owned by any selected **person**, anyone in a selected **department**, anyone at a selected **autonomy** level (1–5, from **Team**), or anyone matching a selected **employment** type on **Team** — combined with OR across selected tokens). **Priority** (P0–P3) and **delivery status** (project workflow `status` values) are separate multi-selects.

**Owner** cells show an **amber ring** (profile photo) or **dot** (name-only row) when the assignee’s autonomy is 1–2 (founders excluded).

The **signals** multi-select shows rows where **any** chosen signal applies. **Manually flagged:** **Flagged at risk** (`atRisk` flag on goal or project), **Spotlighted** (`spotlight` flag — win or positive momentum). **Auto-detected:** **Unassigned** (no DRI on the goal or owner on the project), **Stuck in progress** (project In Progress but no milestones completed yet — the "zombie" check), **Needs kickoff** (goal cost of delay ≥4 and goal status not In Progress — distinct from calendar-based overdue, which lives in the Dates filter).

The **due date** multi-select filters **projects** by `targetDate` using **cumulative** horizons. Filter order: company → owner → priority → status enum → signals → due date → search.

## URL query parameters

**Roadmap** (`/`) supports the same query parameters the UI uses: comma-separated `companies` (ids), `owners` (ids or owner-filter tokens), `tags` (signal ids: `at_risk`, `spotlight`, `unassigned`, `zombie`, `stalled`), `priorities` (`P0`…`P3`), `delivery` (project status enum values), `due` (due-date bucket ids), `q` (search text), plus `focusGoal` / `focusProject` for a single expanded project.

**Review notes…** in the row menu opens the **review log** popover (append notes, read history). Dedicated **Summary**, **Matrix**, and full-page **Review** experiences are not part of this build (may be added later).

Goals within a company and projects within each goal are sorted by **priority** (P0 first).

## Persistence

Changes persist through server actions: each mutation reads the document, applies updates, bumps `revision`, and writes with an atomic compare-and-swap in Redis (retries on conflict; stale concurrent edits surface an error instead of silent data loss).

See [operations.md](operations.md) for dashboard caching (`ecc-tracker-data` tag).
