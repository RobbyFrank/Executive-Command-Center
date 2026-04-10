# Executive Command Center

**Roadmap** for MLabs portfolio companies: goals, projects, milestones, and leadership review signals. Data lives in a single JSON file (`data/tracker.json`) with atomic writes; a database can replace the repository layer later. On the project grid, **Next milestone** is computed from milestones (first not done in list order), not stored separately.

While you scroll the Roadmap, the **company** header stays pinned below the main toolbar (title + filters) for the **whole company section**; **goal** and **project** column labels and each **goal** row stack beneath in a cascade (measured toolbar + row heights). Project title rows scroll normally so the company header remains the clear section anchor.

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

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), sign in with one of the configured accounts. With `ANTHROPIC_API_KEY` set, use the **AI assistant** (floating icon, bottom-right) to ask questions about tracker data. **Sidebar:** **Roadmap** (portfolio tree), **Summary** (key metrics, deadlines, momentum, workloads), **Impact × Complexity** matrix, **Review mode** (P0/P1 walkthrough: stale-first order, context, milestones, keyboard nav, saved position), **Companies**, **Team**. On **Roadmap**, filter by **company**, **owner** (including department / employment / autonomy tokens), **priority** (P0–P3), **delivery status** (goal/project status enum), **signals** (At risk, Spotlight, Unassigned, Need review, Close watch, Zombie, High/Low leverage, Time-sensitive), **due date** (project target date buckets), and **search**. Goals and projects are sorted by **priority** (P0 first); **Sync** goals keep project order for the dependency chain. **Confidence** on goals and projects is **auto-calculated** from owner **autonomy** vs project **complexity**, shown as a **bar and percentage**; hover or focus the cell for a formatted breakdown. **Roadmap URL query (optional):** `focusGoal`, `focusProject` (expand one project); `companies`, `owners`, `tags`, `priorities`, `delivery`, `due`, `q` — comma-separated lists (except `q`, full-text search). **Summary** links into these presets; Matrix uses `focusGoal` + `focusProject`. Use **Companies** to edit company names, logos, and add or remove companies. **Team** lists founders first, then groups everyone else by **autonomy** (default), **organization** (department), or **workload**; filters include department, employment, workload, companies, and missing profile fields. People with ids `robby` and `nadav` are **Founders** (read-only Founders department on Team).

## Data

- **Location:** `data/tracker.json` (committed so changes are versioned).
- **Backup:** copy this file before risky bulk edits.
- **Companies:** each company has a **short name** (e.g. VD, 1L) for labels and search, optional **website** (`https://…`), optional **description** (same inline pattern as goal **Description** on Roadmap). When editing the description, **Generate from website…** opens a dialog with a single **starting URL** (the company website is prefilled when set). The server uses **Jina Reader** on the homepage, discovers up to nine same-origin links, then **scrapes those pages in parallel** (up to six at a time, ten pages total), then **Claude** writes the description (`ANTHROPIC_API_KEY` required). You can **Stop** a long run to cancel. **monthly MRR in thousands of USD** (0–999 in JSON, e.g. `220` = $220K; used to sort companies), optional **development start** and **launch** dates (shown relatively on the tracker, like target dates), plus logo files on the Companies page. The Companies page **groups** rows by **MRR tier**: Idea → Startup → PMF → Pre-scale → Scale. You can **Sort by momentum** to order companies by a composite score (active goals/projects, spotlight and at-risk counts, milestone completion, recent reviews); each row shows a **momentum bar**, optional **spotlight/at-risk dots** next to goal and project counts, and a **left border** tint by tier.
- **People / companies:** profile photos and logos are **uploaded image files** saved under `public/uploads/people/` and `public/uploads/companies/`. Paths like `/uploads/people/robby.png` are stored in `data/tracker.json`. Each person’s **`name`** is their full name on **Team**; Roadmap owner pickers and filters show **first name** only for compact labels. Each person may include a **department**, optional **`slackHandle`** (Slack **member user ID** only: `U` + 10 characters, e.g. `U09684T0D0X`), and **`employment`** (`inhouse_salaried` — shown as **In-house**, `inhouse_hourly` — **In-house (hourly)**, or `outsourced`) for Roadmap owner filtering. Legacy JSON with **`outsourced`** (boolean) is still accepted and mapped into `employment`. The label **Founders** is reserved for persons `robby` and `nadav` only; the repository normalizes their department to **Founders** and clears that label if it appears on anyone else. On Roadmap, the **Owner** column shows photo + department when a photo exists, otherwise name and department; project **type** is kept in data but not shown on the grid.
- **Slack:** goals have optional channel + link fields; projects have optional channel, thread label, and link — edited on **Roadmap** when a goal or project is expanded.
- **Impact / confidence / complexity:** **impact** and **cost of delay** are edited on **goals**; **complexity** on **projects** — dropdowns 1–5. **Confidence** is **computed in the UI** (not stored on projects): owner **autonomy** vs project **complexity**, clamped to steps 1–5 and shown as **20%–100%** with a compact bar; goal rows use the **average** of project scores. Hover or focus the cell for a short, formatted explanation. Legacy `confidenceScore` may still exist on goals in JSON but is not edited on the Roadmap.

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Next.js development server |
| `npm run lint` | ESLint (Next.js config)  |
| `npm run build`| Production build (run when you want a release build) |

## Documentation

- [docs/strategic-tracker.md](docs/strategic-tracker.md) — Roadmap data model and technical notes
