# Executive Command Center

**Roadmap** for MLabs portfolio companies: goals, projects, milestones, and leadership review signals. Data lives in a single JSON file (`data/tracker.json`) with atomic writes; a database can replace the repository layer later. On the project grid, **Next milestone** is computed from milestones (first not done in list order), not stored separately.


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

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), sign in with one of the configured accounts. Use **Roadmap** for goals/projects (including **Companies**, **Owner** — filter by **In-house** / **Outsourced**, **department**, or specific people — and **status** multi-select filters — At risk, Spotlight, Unassigned, Need review — plus the search box for company, goal, project, milestone, and people names); use **Companies** in the sidebar to edit company names, logos, and add or remove companies. **Team** lists founders first, then groups the rest by autonomy; each member has **department** (dropdown), **In-house / Outsourced**, and workload; the page shows company logos from firms where they own projects. People with ids `robby` and `nadav` are **Founders** and always use the **Founders** department (read-only on Team); no one else can be assigned that department.

## Data

- **Location:** `data/tracker.json` (committed so changes are versioned).
- **Backup:** copy this file before risky bulk edits.
- **Companies:** each company has a **short name** (e.g. VD, 1L) for labels and search, **monthly MRR in thousands of USD** (0–999 in JSON, e.g. `220` = $220K; used to sort companies), optional **development start** and **launch** dates (shown relatively on the tracker, like target dates), plus logo files on the Companies page. The Companies page **groups** rows by **MRR tier**: Idea → Startup → PMF → Pre-scale → Scale.
- **People / companies:** profile photos and logos are **uploaded image files** saved under `public/uploads/people/` and `public/uploads/companies/`. Paths like `/uploads/people/robby.png` are stored in `data/tracker.json`. Each person may include a **department** and **`outsourced`** (boolean — contractors vs in-house) for Roadmap owner filtering. The label **Founders** is reserved for persons `robby` and `nadav` only; the repository normalizes their department to **Founders** and clears that label if it appears on anyone else. On Roadmap, the **Owner** column shows photo + department when a photo exists, otherwise name and department; project **type** is kept in data but not shown on the grid.
- **Slack:** goals have optional channel + link fields; projects have optional channel, thread label, and link — edited on **Roadmap** when a goal or project is expanded.
- **Impact / confidence / complexity:** **impact** and **confidence** are edited on **goals**; **complexity** on **projects** — dropdowns (Minimal, Low, Medium, High, Very high); integers 1–5 in JSON (`impactScore`, `confidenceScore` on goals; `complexityScore` on projects).

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Next.js development server |
| `npm run lint` | ESLint (Next.js config)  |
| `npm run build`| Production build (run when you want a release build) |

## Documentation

- [docs/strategic-tracker.md](docs/strategic-tracker.md) — Roadmap data model and technical notes
