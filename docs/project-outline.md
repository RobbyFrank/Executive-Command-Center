# MLabs Roadmap: Full Spec

## Purpose

A strategic command center for Robby and Nadav to maintain a top-down view of all goals, projects, and progress across the MLabs portfolio of companies. This is NOT a daily task manager or Slack replacement. It's an alignment and prioritization layer that ensures all work maps to goals, surfaces high-leverage opportunities, and catches drift or busy work early.

## Core Problem

- Hard to track what's going on across multiple companies and teams
- Team sometimes engages in busy work rather than focused, high-leverage work
- Lack of structured push and direction from leadership
- No shared view of strategic intentions, goals, and whether current work maps to them

## Primary Users

Robby and Nadav. Team members may be asked to help update project status, but the tool is designed for leadership-level visibility and decision-making.

---

## Data Model

### Hierarchy

```
Company → Goal → Project → Milestone
```

### Company

Top-level grouping by business entity.

Current companies: VoiceDrop, 1Lookup, 1Capture, Prymatica, MVP Products (BitPredict, TeamPredict, KeyWiz), General (cross-company ops/hiring/strategy).

### Goal

A strategic objective with multiple workstreams. The test: "Does this have multiple projects with different owners?" If yes, it's a Goal.

| Field | Type | Notes |
|---|---|---|
| ID | String | UUID (v4). Older seed data may still use legacy prefixed ids (e.g. VD-1). |
| Created At | YYYY-MM-DD (internal) | Local calendar date when the goal was created (always “today” on create); stored as `createdAt`, not shown in the UI. Legacy rows may be empty. |
| Description | Text | e.g., "Grow VoiceDrop to $1M MRR" |
| Measurable Target | Text | e.g., "$1M MRR," "250 trials/month" |
| Current Value | Text (optional) | For KPI-type goals, e.g., "$380K MRR" |
| Impact Score | Number (1-5) | How useful/amazing it would be if achieved |
| Cost of Delay | High / Medium / Low | High = perishable opportunity (market window closes, competitor wins if delayed). Medium = meaningful advantage lost by waiting. Low = evergreen, valuable whenever we get to it. |
| Owner | Person | Single owner |
| Priority | P0 / P1 / P2 / P3 | |
| Slack Channel | Text | Primary channel for this goal (e.g. `#vd-sales`) |
| Last Reviewed | Date | Manual check-in date (last time Robby/Nadav confirmed accuracy) |
| Status | In Progress / Not Started / Planning / Blocked / Ongoing / Demand Testing / Evaluating / Idea | |

**Example Goals:**
- VD-1: "Grow VoiceDrop to $1M MRR" (Impact: 5, Cost of Delay: High, Owner: Robby)
- VD-3: "Complete NextJS Migration" (Impact: 5, Cost of Delay: Medium, Owner: Andrés — milestones: migrate dashboard → migrate billing → deprecate Bubble)
- 1L-7: "Add 10+ data products to 1Lookup" (Impact: 4, Cost of Delay: Low, Owner: Afaq)

### Project

A single deliverable or workstream with a clear owner and definition of done.

| Field | Type | Notes |
|---|---|---|
| Created At | YYYY-MM-DD (internal) | Local calendar date when the project was created (always “today” on create); stored as `createdAt`, not shown in the UI. Legacy rows may be empty. |
| Name | Text | e.g., "AI SDR Leon V1 Launch" |
| Owner | Person | Single owner, accountable for delivery |
| Assignees | List of People | Contributors beyond the owner |
| Type | Engineering / Product / Sales / Strategic / Operations / Hiring / Marketing | |
| Priority | P0 / P1 / P2 / P3 | |
| Status | In Progress / Not Started / Planning / Blocked / Ongoing / Demand Testing / Evaluating / Idea | |
| Complexity Score | Number (1-5) | How complex/difficult to implement |
| Confidence Score | Number (1-5) | Manual slider: how confident Robby/Nadav are that this will hit its Target Date and Definition of Done. Updated during reviews. |
| Next Critical Step | Text (max ~15 words) | The single immediate bottleneck or action needed right now. Forces clarity on what's actually holding things up. |
| Definition of Done | Text | Clear completion criteria, e.g., "Leon booking 20+ qualified meetings/month" |
| Start Date | Date | |
| Target Date | Date | In the app, the Roadmap **Due date** column is **derived** from the chronologically **last milestone** that has a target date (not edited on the project row). The field may still exist in JSON for compatibility. |
| Slack URL | URL | Link to relevant thread or channel |
| Last Reviewed | Date | Manual check-in date |
| Progress | Auto-calculated | Derived from milestones (e.g., 3 of 5 done = 60%) |

**Example Projects:**
- "Person Enrichment Product" (Owner: Afaq, Complexity: 3, Confidence: 3, Type: Product, Status: Blocked)
- "Scale Paid Ads to $100K/mo" (Owner: Ghulam, Complexity: 2, Confidence: 4, Type: Marketing, Status: In Progress)
- "Hire Chief of Staff / Ops Manager" (Owner: Robby, Complexity: 4, Confidence: 2, Type: Hiring, Status: Not Started)

**Confidence Score Guidelines:**
- **5:** On track, high certainty. No concerns.
- **4:** Likely to land. Minor risks but manageable.
- **3:** Uncertain. Some real risks or unknowns that could derail it.
- **2:** Worried. Significant blockers, wrong person, or scope creep.
- **1:** This is going off the rails. Needs immediate intervention.

Why: Data (milestones/progress) often lags behind reality. A project might show 80% complete on paper but the leader has a gut feeling it's going sideways. The Confidence Score surfaces "quiet" risks before they become Blocked status items.

**Next Critical Step (Anti-Stall Mechanism):**
A short text field (max ~15 words) that forces the project owner to name the single immediate bottleneck or action needed right now. Example: "Waiting on PDL API keys to test enrichment quality."

During weekly reviews, if the Next Critical Step hasn't changed in two weeks, the project is drifting, even if it's technically still "In Progress." This is the earliest signal of a stalling project.

### Milestone

Intermediate checkpoints within a project. Progress is calculated from milestone completion.

| Field | Type | Notes |
|---|---|---|
| Name | Text | e.g., "Phase 1: Dashboard migrated" |
| Status | Done / Not Done | |
| Target Date | Date | |

**Example Milestones (for a "NextJS Dashboard Migration" project):**
1. Core dashboard pages ported (Target: March 15)
2. Billing and payments migrated (Target: April 1)
3. All customers transitioned off Bubble (Target: April 30)

---

## Team

A list of all team members, used for easy assignment and risk assessment.

| Field | Type | Notes |
|---|---|---|
| Name | Text | |
| Role / Title | Text | |
| Department | Text | Optional; used for Roadmap filters |
| Team (employment) | Enum | `inhouse_salaried` (In-house), `inhouse_hourly` (In-house hourly), or `outsourced` (external) |
| Company Affiliation(s) | List | Some people work across multiple companies |
| Autonomy Score | Number (1-5) | 5 = "give them the goal, they figure it out." 1 = "needs daily check-ins and explicit instructions." |
| Slack user ID | Text | Slack member ID (`U` + 10 alphanumerics, e.g. `U09684T0D0X`), or empty |

**Autonomy Score Guidelines:**
- **5:** Fully autonomous. Set the goal, they deliver.
- **4:** Needs light direction. Weekly check-in sufficient.
- **3:** Solid executor but needs clear specs and periodic oversight.
- **2:** Needs frequent check-ins, detailed instructions, and regular QA.
- **1:** New, unproven, or inconsistent. Daily oversight required.

**Note:** Autonomy scores are sensitive. If the tool is ever opened to team members for self-service updates, consider visibility/permissions so individuals don't see their own scores.

---

## Prioritization Framework

### Impact × Complexity Matrix

Each goal has an Impact Score (1-5) and each project has a Complexity Score (1-5). The ratio (Impact / Complexity) surfaces the highest-leverage work.

| | Low Complexity (1-2) | Medium Complexity (3) | High Complexity (4-5) |
|---|---|---|---|
| **High Impact (4-5)** | DO FIRST (best ROI) | Strong priority | Worth it, but plan carefully |
| **Medium Impact (3)** | Easy win, do it | Evaluate timing | Probably defer |
| **Low Impact (1-2)** | Only if trivial | Deprioritize | Cut or kill |

### Cost of Delay Layer

The Impact × Complexity matrix tells you WHAT to work on. Cost of Delay tells you WHEN.

Two goals might both be High Impact / Low Complexity, but:
- "CPaaS Customer Acquisition" has a High Cost of Delay because competitors are entering the market now.
- "OAuth Signup (Google)" has a Low Cost of Delay because it's an evergreen conversion improvement that's equally valuable next quarter.

When prioritizing across equally-scored items, High Cost of Delay wins. This prevents the trap of always doing easy evergreen work while perishable opportunities expire.

---

## Views & Filters

### Default View
Everything grouped by Company → Goal → Project, with collapsible sections.

### Key Filters
- **By Company:** Show only VoiceDrop, only 1Lookup, etc.
- **By Owner:** "Show me everything owned by Saulat"
- **By Priority:** "Show me all P0s across all companies"
- **By Status:** "Show me everything that's Blocked"
- **By Type:** "Show me all Hiring projects"
- **Stale:** Items where Last Reviewed is 2+ weeks ago
- **Unassigned:** Projects with no owner (stuck, needs hiring or delegation)
- **Close watch (computed):** Projects where the owner's autonomy score is ≤ 2 and priority is P0 or P1 — surfaced as a **Close watch** status filter and pill on the Roadmap (distinct from the manual **At risk** exec flag below).
- **At risk (manual):** Exec-flagged goal or project (`atRisk`) when leadership marks work as needing attention for any reason.
- **Low Confidence:** Projects where Confidence Score is ≤ 2 (quiet risks, gut-feel problems)
- **Zombie:** Status is "In Progress" + no milestone completed in 3+ weeks + Last Reviewed not updated. These are projects people have stopped working on but haven't had the heart to kill or pause yet.
- **Drifting:** "Next Critical Step" field unchanged for 2+ weeks. Early warning signal before a project becomes a Zombie.
- **High Leverage:** P0 or P1 goals with low complexity projects (1-2)
- **Low Leverage:** P3 goals with high complexity projects (4-5), candidates to cut
- **Time-Sensitive:** Goals with High Cost of Delay that are not yet In Progress

### Resource Bottleneck View

The **Team** page aggregates workload per person across all companies. The toolbar supports **search** (name, role, department, Slack ID) and multi-select filters: **department** (including no department), **employment type**, **workload** bands (idle through heavy, plus “has P0”), **companies** where the person owns projects, and **missing profile fields** (e.g. no photo). Options show **counts** for the current facet; **Reset filters** clears everything.

Each row includes a **workload bar**: length is relative to the busiest teammate so you can compare load at a glance; color segments show P0, P1, and other priorities, with the total count at the end of the bar. Company logos still show which companies their projects span, alongside autonomy for context.

**Why:** Prevents accidentally overloading a high-autonomy person (like Afaq or Andrés) with three P0s across three different companies. Also surfaces when too much critical work depends on a single person (bus factor risk).

---

## Project due date vs milestones

Project **due date** on the Roadmap is **read-only** and matches the **last milestone** (by target date) that has a date set. Use **milestone** target dates to plan the timeline; filters and summaries use the derived project date.

---

## What This Is NOT

- **Not a daily task manager.** Individual tasks and to-dos live in Slack and developer workflows.
- **Not a standup tool.** Day-to-day communication happens in Slack.
- **Not a time tracker.** No hours logging or timesheets.
- **Not a full activity log.** Slack threads (linked via URL) serve as the detailed history. This tool captures status snapshots and manual review check-ins.

---

## Review Cadence (Suggested)

- **Weekly:** Robby and Nadav review all P0 and P1 items. Update Last Reviewed dates. Update Confidence Scores. Check "Next Critical Step" for staleness (unchanged = drifting). Flag Zombies.
- **Bi-weekly / Monthly:** Full portfolio review across all companies. Check Resource Bottleneck view for overloaded team members. Review the Impact × Complexity × Cost of Delay stack to ensure highest-leverage work is prioritized. Identify low-leverage work to cut. Surface unassigned projects.
- **Ad hoc:** Use filters to prep for 1:1s with team members (filter by owner before a check-in). Use Confidence Score filter to quickly find "quiet risks" that need a conversation.
