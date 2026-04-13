# Executive Command Center

**Roadmap** for MLabs portfolio companies: goals, projects, milestones, and leadership review signals. **All tracker data** is stored as a single JSON document in **Upstash Redis** (key `ecc:tracker:data`) when `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) are set—required for both local dev and production. Writes use **optimistic locking** (`revision` on the document plus a Redis atomic compare-and-set) so concurrent edits do not silently overwrite each other. Company and people images use **`public/uploads/`** locally and **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`) in production when configured. On the project grid, **Description** is editable scope/outcome (`description`); **Next milestone** is computed from milestones (first not done in list order), not stored separately. Column order after **Pri** is **Description** → **Done when** → **Complexity** → **Next milestone** → **Status** → **Confidence** → **Progress** → **Due date** (`targetDate`). **Goal** rows use **DRI** and **Pri** before **Description** (`measurableTarget`); spacer columns align the **Confidence** column with projects. **Sync** goals require each project’s due date to be **after** the previous project’s due date (pipeline storage order).

While you scroll the Roadmap, the **company** header stays pinned below the main toolbar (title + filters) for the **whole company section**; **goal** and **project** column labels and each **goal** row stack beneath in a cascade (measured toolbar + row heights). Project title rows scroll normally so the company header remains the clear section anchor. **Right-click** a company, goal, project, or milestone row for a **context menu** of common actions (add children, **rename** goal/project titles, expand/collapse, executive signals, goal execution mode, delete with confirmation).


## Prerequisites

- Node.js 20+ (LTS recommended; Node 21 may show engine warnings from some dependencies)

## Setup

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   copy .env.example .env.local
   ```

   On macOS/Linux use `cp .env.example .env.local`.

3. Edit `.env.local`:

   - Set `AUTH_USER_1_USERNAME`, `AUTH_USER_1_PASSWORD`, `AUTH_USER_2_USERNAME`, `AUTH_USER_2_PASSWORD` to long passphrases (the app compares against these values; they are not stored in the JSON file).
   - Set `SESSION_SECRET` to a long random string used only to sign the session cookie.
   - Set `ANTHROPIC_API_KEY` to enable the **AI assistant** (floating button on the dashboard) and **Companies → description generator** (scrape a site via Jina Reader with parallel page fetches, then summarize with Claude). Without a key, assistant requests and description generation return a configuration error. Optionally set `ANTHROPIC_MODEL` to override the default Claude model.
   - **Upstash Redis:** required—copy `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_*`) from Vercel Storage or the Upstash dashboard into `.env.local`. Optionally copy Blob env vars for image hosting. To import an existing JSON export into Redis, run `npm run seed:kv -- path/to/tracker.json` (see **Data** below).

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), sign in with one of the configured accounts. With `ANTHROPIC_API_KEY` set, use the **AI assistant** (floating icon, bottom-right) to ask questions about tracker data. **Sidebar:** **Roadmap** (portfolio tree), **Summary** (key metrics, deadlines, momentum, workloads), **Priority × Complexity** matrix, **Review** (all goals plus projects that need review vs last reviewed — same cadence as Roadmap **Need review**; filter the queue by **company**, **owner**, and **priority** like Roadmap; same inline fields as Roadmap, optional **review notes** per item), **Companies**, **Team**. On **Roadmap** (default: tree **Goals only**; **Focus** on/off is remembered in the browser), filter by **company**, **owner** (including department / employment / autonomy tokens), **priority** (P0–P3), **delivery status** (goal/project status enum), **signals** (At risk, Spotlight, Unassigned, Need review, Close watch, Zombie, High/Low leverage, Time-sensitive), **due date** (project target date buckets), and **search**. Goals and projects are sorted by **priority** (P0 first); **Sync** goals keep project order for the dependency chain. **Confidence** on goals and projects is **auto-calculated** from owner **autonomy** vs project **complexity**, shown as a **bar and percentage**; hover or focus the cell for a formatted breakdown. **Roadmap URL query (optional):** `focusGoal`, `focusProject` (expand one project); `companies`, `owners`, `tags`, `priorities`, `delivery`, `due`, `q` — comma-separated lists (except `q`, full-text search). **Summary** links into these presets; Matrix uses `focusGoal` + `focusProject`. Use **Companies** to edit company names, logos, and add or remove companies. **Team** lists founders first, then groups everyone else by **autonomy** (default), **organization** (department), or **workload**; filters include department, employment, workload, companies, and missing profile fields. People with ids `robby` and `nadav` are **Founders** (read-only Founders department on Team).

## Data

- **Location:** Upstash Redis key `ecc:tracker:data` (same schema everywhere; see `src/lib/schemas/tracker.ts`). Set Redis env vars in `.env.example` / `.env.local` before running the app—there is no local `tracker.json` store.
- **Review notes:** each goal and project may have a **review log** (`reviewLog`: dated entries with text). On the **Review** page, the **Review notes** column is the only place you **mark an item reviewed** (**Mark reviewed & next** — optional note, blank allowed). On **Roadmap**, the **Review notes** popover only **adds notes** to the log (does not update last reviewed). On Roadmap, the project **Review notes** icon pulses when that project is in the Review queue (needs review vs last reviewed).
- **Seed / import:** with Redis credentials in `.env.local`, run `npm run seed:kv -- path/to/tracker.json` to validate and upload a JSON file (for example an export or backup).
- **Backup:** export or snapshot the Redis key with your provider’s tools; keep offline JSON copies before risky bulk edits if needed.
- **Companies:** each company has a **short name** (e.g. VD, 1L) for labels and search, optional **website** (`https://…`), optional **description** (same inline pattern as goal **Description** on Roadmap). When editing the description, **Generate from website…** opens a dialog with a single **starting URL** (the company website is prefilled when set). The server uses **Jina Reader** on the homepage, discovers up to nine same-origin links, then **scrapes those pages in parallel** (up to six at a time, ten pages total), then **Claude** writes the description (`ANTHROPIC_API_KEY` required). You can **Stop** a long run to cancel. **monthly MRR in thousands of USD** (0–999 in JSON, e.g. `220` = $220K; used to sort companies), optional **development start** and **launch** dates (shown relatively on the tracker, like target dates), plus logo files on the Companies page. The Companies page **groups** rows by **MRR tier**: Idea → Startup → PMF → Pre-scale → Scale. You can **Sort by momentum** to order companies by a composite score (active goals/projects, spotlight and at-risk counts, milestone completion, recent reviews); each row shows a **momentum bar**, optional **spotlight/at-risk dots** next to goal and project counts, and a **left border** tint by tier.
- **People / companies:** profile photos and logos are **uploaded image files** saved under `public/uploads/people/` and `public/uploads/companies/`. Paths like `/uploads/people/robby.png` are stored in the tracker JSON in Redis. Each person’s **`name`** is their full name on **Team**; Roadmap owner pickers and filters show **first name** only for compact labels. Each person may include a **department**, optional **`email`** and **`phone`** (simple fields on **Team**; if set, email must be valid and phone must contain **7–15 digits**), optional **`estimatedMonthlySalary`** (whole USD per month, edited on **Team**), optional **`slackHandle`** (Slack **member user ID** only: `U` + 10 characters, e.g. `U09684T0D0X`), and **`employment`** (`inhouse_salaried` — shown as **In-house**, `inhouse_hourly` — **In-house (hourly)**, or `outsourced`) for Roadmap owner filtering. On **Team**, grouping rows by autonomy, department, or workload shows **total** estimated monthly salary per section and **average among members with a salary entered** (empty or $0 excluded; **—** when none). Legacy JSON with **`outsourced`** (boolean) is still accepted and mapped into `employment`. **Founders** are people with **`isFounder: true`** in stored data (set from **Team** via the row **⋯** menu: **Set as Founder** / **Remove founder status**). If `isFounder` is omitted, ids **`robby`** and **`nadav`** still count as founders; **`isFounder: false`** opts out. The label **Founders** is reserved for those people; the repository normalizes their department to **Founders** and clears that label if it appears on anyone else. On Roadmap, the **Owner** column shows photo + first name when a photo exists, otherwise name and department; project **type** is kept in data but not shown on the grid. Goal **DRI** (directly responsible individual — the goal Owner column) may only be assigned to **founders** or people with **autonomy 4 or 5**; project **owners** may be anyone on the roster.
- **Slack:** goals have optional channel + link fields; projects have optional channel, thread label, and link — edited on **Roadmap** when a goal or project is expanded.
- **Goals (Roadmap columns):** beside the goal title and **DRI**, **Description** is the outcome or metric (`measurableTarget`); **Why** is optional rationale (`whyItMatters`); **Current** is progress vs the description (`currentValue`). **Goals** still use the classic **goal status** enum (`GoalStatusEnum` in `tracker.ts`). **Projects** use a separate **project status** pipeline: Idea → Pending → In Progress → Stuck → For Review → Done (`ProjectStatusEnum`); legacy project statuses in JSON are coerced on load. **Priority** (P0–P3) is set per goal and project on the grid. **Confidence / complexity / cost of delay:** **cost of delay** is edited on **goals**; **complexity** on **projects** — dropdowns 1–5. **Confidence** is **computed in the UI** (not stored on projects): **0%** if there is **no owner** (or owner not on Team); otherwise owner **autonomy** vs **complexity** on steps **1–5**, shown overall as **0%–100%**; **goals with no projects** show **0%** until at least one project exists; goal rows **blend** project scores using **cost of delay** so higher delay puts **more weight on high-autonomy** project owners (at minimum cost of delay it matches a straight average). Hover or focus the cell for a short, formatted explanation. Legacy `confidenceScore` may still exist on goals in JSON but is not edited on the Roadmap. Legacy `impactScore` may still exist in stored JSON but is not edited in the app.

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Next.js development server |
| `npm run lint` | ESLint (Next.js config)  |
| `npm run build`| Production build (run when you want a release build) |
| `npm run seed:kv -- <file.json>` | Validate and upload a tracker JSON file to Upstash (needs Redis env in `.env.local`) |

## Documentation

- [docs/strategic-tracker.md](docs/strategic-tracker.md) — Roadmap data model and technical notes
