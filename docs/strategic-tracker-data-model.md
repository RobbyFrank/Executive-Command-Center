# Tracker data model: Companies, Team, storage

MLabs-internal roadmap app. For the doc index, see [strategic-tracker.md](strategic-tracker.md). For **environment variables**, see [environment.md](environment.md). For Slack APIs and milestone threads, see [strategic-tracker-slack.md](strategic-tracker-slack.md).

## Hierarchy

**Company → Goal → Project → Milestone**

## Company

Each **Company** has:

- **Short name** (e.g. `VD`, `1L`) — used in labels and for new goal id prefixes.
- **Revenue** — monthly MRR in **thousands of USD** (0–999 in JSON; e.g. `220` means $220K/month). Used to order companies on Roadmap and on the Companies page (pinned companies first, then highest revenue).
- **`pinned`** (boolean, default false) — toggled on **Companies**. When true, the company appears in a **Pinned** group at the top of the Companies directory (MRR tier view) and before non-pinned companies on Roadmap and in company pickers that use tier grouping.
- **`website`** — full `https://` URL (optional).
- **`description`** — free text, edited on **Companies** (not the same surface as goal outcome text on Roadmap; that lives under an **expanded** goal).

On **Companies**, the description edit panel includes **Generate from website…**: a single **starting URL** is scraped with **Jina Reader**; the server discovers up to nine same-origin links and fetches those pages **in parallel**, then **Claude** summarizes (`ANTHROPIC_API_KEY` required). The client can **cancel** a run in progress.

Optional **development start** and **launch** dates (`developmentStartDate`, `launchDate`, `YYYY-MM-DD`) appear on the Companies page (editable) and on the Roadmap company header as **relative** labels (same rules as project/milestone target dates: days, weeks, months, years).

On **Companies**, rows are **grouped by MRR tier**: Idea ($0), Startup ($1–$1K), PMF ($1K–$10K), Pre-scale ($10K–$25K), Scale ($25K+). The same page can **sort by momentum** (composite score from In Progress goals/projects, spotlight vs at-risk, and milestone completion) and shows a **momentum bar**, optional **dots** for spotlight/at-risk on goal and project counts, and a **left border** tint by score tier.

## Team and people

**Person** records live on **Team**. Each person may have:

- **Department** — chosen from a dropdown (every distinct department already used on the team appears, merged with a small default list so new teams can assign departments before any custom labels exist). The label **Founders** is reserved for the fixed founder person ids `robby` and `nadav` (read-only on Team for them; cleared for anyone else if present in JSON).
- **Team** employment — **In-house**, **In-house (hourly)**, or **Outsourced**.
- **App login** — optional **`passwordHash`** (bcrypt). Sign-in uses the person’s **email** plus password; the hash is never sent to the client (only a `loginPasswordSet` flag on reads). Founders set passwords on **Team → Login**; see [strategic-tracker-ai-auth.md](strategic-tracker-ai-auth.md).

The **Team** page lists **founders** (fixed person records) first, then groups remaining rows by **autonomy score** (1–5), with section headers per autonomy level (the score uses neutral blocks in the Autonomy column). Each row shows **workload**: total owned projects, P0/P1 counts, and **companies** where they own projects (logos from the Companies page when set; otherwise short names).

**Goals** can store an optional **Slack channel** name and **URL**; **projects** can store **Slack channel**, **thread** (label/title), and **URL** (inline when each goal/project row is expanded). Slack *integration* behavior is documented in [strategic-tracker-slack.md](strategic-tracker-slack.md).

## Storage and concurrency

Stored in Upstash Redis key **`ecc:tracker:data`** (required; `KV_REST_*` or `UPSTASH_REDIS_REST_*`), validated with Zod (`src/lib/schemas/tracker.ts`). The root document includes a monotonic **`revision`** for optimistic locking (atomic compare-and-set in Redis).

Company logos and people profile photos are files under `public/uploads/…` locally or **Vercel Blob** URLs in production when `BLOB_READ_WRITE_TOKEN` is set; JSON stores either a path like `/uploads/companies/voicedrop.png` or an `https://…blob.vercel-storage.com/…` URL.

See also [data-storage.md](data-storage.md).
