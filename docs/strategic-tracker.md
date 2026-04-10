# Roadmap

## Data model

Hierarchy: **Company → Goal → Project → Milestone**. Each **Company** has a **short name** (e.g. `VD`, `1L`) used in labels and for new goal id prefixes, and **revenue** (monthly MRR in **thousands of USD**, 0–999 in JSON — e.g. `220` means $220K/month) used to order companies in Roadmap and on the Companies page (highest first). Optional **development start** and **launch** dates (`developmentStartDate`, `launchDate`, `YYYY-MM-DD`) appear on the Companies page (editable) and on the Roadmap company header as **relative** labels (same rules as project/milestone target dates: days, weeks, months, years). On **Companies**, rows are **grouped by MRR tier**: Idea ($0), Startup ($1–$1K), PMF ($1K–$10K), Pre-scale ($10K–$25K), Scale ($25K+). **Person** records live on **Team**; each person may have a **department** chosen from a dropdown (every distinct department already used on the team appears, merged with a small default list so new teams can assign departments before any custom labels exist), except the label **Founders**, which is reserved for the fixed founder person ids `robby` and `nadav` (read-only on Team for them; cleared for anyone else if present in JSON), and an **In-house / Outsourced** control (contractors vs internal team). The **Team** page lists **founders** (fixed person records) first, then groups remaining rows by **autonomy score** (1–5), with section headers per autonomy level (the score uses neutral blocks in the Autonomy column), and shows each person’s **workload**: total owned projects, P0/P1 counts, and **companies** where they own projects (logos from the Companies page when set; otherwise short names). **Goals** can store an optional **Slack channel** name and **URL**; **projects** can store **Slack channel**, **thread** (label/title), and **URL** (inline when each goal/project row is expanded).

Stored in `data/tracker.json` and validated with Zod (`src/lib/schemas/tracker.ts`). Company logos and people profile photos are stored as files under `public/uploads/companies/` and `public/uploads/people/`; JSON stores site paths such as `/uploads/companies/voicedrop.png`.

## Editing

**Impact** and **confidence** (on goals), and **complexity** (on projects) are edited with dropdowns: Minimal, Low, Medium, High, Very high — stored as integers **1–5** in JSON (`impactScore`, `confidenceScore` on goals; `complexityScore` on projects). **Impact** and **confidence** are goal-only; project rows do not use placeholder columns for them.

**Owner** on goals and projects shows the assignee’s **profile photo** with **department** beside it when both exist; without a photo it shows **name · department**. Project **`type`** (Engineering, Product, etc.) remains in JSON but is not edited on the Roadmap grid.

On project rows, **Next milestone** is read-only: it shows the first milestone in list order that is not **Done** (with placeholder text when there are no milestones or all are done). Plan work in **milestones** under the project instead.

**Roadmap** uses **inline editing** for goals, projects, and milestones. **Add project** and **Add goal** share a row at the bottom of each goal’s project list (or alone when there are no projects); **Add goal** still creates a new goal for the **company** (`companyId`). **Companies** (name, short name, revenue, logo, add/remove) are managed on the **Companies** page (`/companies`); company rows on Roadmap are read-only headers. A **company** can only be deleted when it has **no goals** (remove or move goals first). A **person** can only be deleted when they are not a **goal owner**, **project owner**, or **assignee** on any project.

Use the **search** field at the top of Roadmap to filter by substring across company names and short names, goal text and fields, project names and metadata (including owner and assignee **names** resolved from **Team**), and milestone names and dates. **Companies** and **Owner** multi-select filters narrow the tree (selected companies only; then goals/projects owned by any selected **person**, anyone in a selected **department**, or anyone matching **In-house** / **Outsourced** on **Team** — combined with OR across selected tokens). The **status** multi-select shows rows where **any** chosen signal applies: **At risk** (`atRisk`), **Spotlight** (`spotlight` — positive exec highlight; mutually exclusive with `atRisk` in stored data), **Unassigned** (no goal or project owner), **Need review** (stale `lastReviewed` — 72h for goals, 24h for projects, same logic as the Review control). These filters run before search is applied.

Changes persist through server actions and rewrite the JSON file atomically (write to a temp file, then rename).

## Auth

Two accounts are configured via environment variables (`AUTH_USER_*`). Sessions use a signed cookie (`SESSION_SECRET`). No OAuth or NextAuth in the current build.

## Future

- Replace `JsonTrackerRepository` with a Postgres-backed implementation behind the same `TrackerRepository` interface.
- Add filter presets and risk signals from the product spec (stale, zombie, drifting, etc.) on top of the same data.
