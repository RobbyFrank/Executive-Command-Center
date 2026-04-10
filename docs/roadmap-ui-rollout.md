# Roadmap UI improvements — rollout steps

Implement and review **one step at a time** (merge or test after each).

| Step | What | Key files |
| ---- | ---- | --------- |
| **1** | **`RoadmapViewProvider` + `useRoadmapView()`** — context wraps the Roadmap tree; `columnMode` is always `"full"` (same layout as before). No toolbar toggles or `localStorage` yet. | `src/components/tracker/roadmap-view-context.tsx`, `TrackerView.tsx` |
| **2** | **Compact / full columns** — `useRoadmapView()`, `columnMode`, toolbar toggle, `localStorage` (`ecc-roadmap-column-mode`), hide secondary columns in compact mode on goals + projects + column headers. | `roadmap-view-context.tsx`, `TrackerView.tsx`, `GoalSection.tsx`, `ProjectRow.tsx`, `TrackerColumnHeaders.tsx` |
| **3** | **Sticky Roadmap chrome** — measure sticky toolbar height; `position: sticky` + `top` on column label rows; **cascade**: company header (for the whole `CompanySection`) → goals labels → goal row → projects labels. Z-order keeps the company bar above other in-section stickies but below the main toolbar. | **Done:** `roadmap-view-context.tsx` (`stickyTopPx`), `RoadmapStickyToolbar.tsx`, `TrackerView.tsx`, `TrackerColumnHeaders.tsx`, `CompanySection.tsx`, `GoalSection.tsx`, `src/lib/tracker-sticky-layout.ts` |
| **4** | **“More filters” toolbar** — primary row: search, company, owner; expandable row: priority, delivery status, signals, due date; active dot on control. | `TrackerView.tsx` or extracted chrome component |
| **5** | **Priority accent borders** — optional left border tint for P0/P1 when not at-risk/spotlight. | `GoalSection.tsx`, `ProjectRow.tsx` |

After each step: run `npx tsc --noEmit` and smoke-test Roadmap (`/`).
