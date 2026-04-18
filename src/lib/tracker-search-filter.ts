import { milestoneProgressPercent } from "@/lib/milestone-progress";
import type {
  CompanyWithGoals,
  GoalWithProjects,
  Milestone,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";
import { scoreBandSearchTokens } from "@/lib/tracker-score-bands";
import { resolveOwnerFilterTokensToOwnerIds } from "@/lib/owner-filter";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";
import { projectMatchesCloseWatchByOwnerMap } from "@/lib/closeWatch";
import { isProjectZombie } from "@/lib/zombie";

/** Multi-select status filters on the tracker (OR within selection). */
export type TrackerStatusTagId =
  | "at_risk"
  | "spotlight"
  | "unassigned"
  | "zombie"
  | "stalled";

export function normalizeTrackerSearchQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function personName(peopleById: Map<string, Person>, id: string): string {
  if (!id) return "";
  return peopleById.get(id)?.name ?? "";
}

function joinAssigneeNames(
  peopleById: Map<string, Person>,
  ids: string[]
): string {
  return ids.map((id) => personName(peopleById, id)).filter(Boolean).join(" ");
}

/** Text for matching a milestone row (names, dates, status, id). */
function milestoneSearchText(m: Milestone): string {
  return [m.id, m.name, m.status, m.targetDate, m.slackUrl].join(" ");
}

/** Project fields only — excludes milestone bodies (handled in filter). */
function projectSearchTextSelf(
  p: ProjectWithMilestones,
  peopleById: Map<string, Person>
): string {
  return [
    p.id,
    p.name,
    p.description,
    p.goalId,
    personName(peopleById, p.ownerId),
    joinAssigneeNames(peopleById, p.assigneeIds),
    p.type,
    p.priority,
    p.status,
    scoreBandSearchTokens(p.complexityScore),
    p.definitionOfDone,
    p.startDate,
    p.targetDate,
    p.milestones.map((m) => m.slackUrl).join(" "),
    p.atRisk ? "at risk" : "",
    p.spotlight ? "spotlight momentum win" : "",
    projectMatchesCloseWatchByOwnerMap(p, peopleById)
      ? "close watch low autonomy oversight"
      : "",
  ].join(" ");
}

/** Goal fields only — excludes projects (handled in filter). */
function goalSearchTextSelf(
  g: GoalWithProjects,
  peopleById: Map<string, Person>
): string {
  return [
    g.id,
    g.companyId,
    g.description,
    g.measurableTarget,
    g.whyItMatters,
    g.currentValue,
    scoreBandSearchTokens(g.confidenceScore),
    scoreBandSearchTokens(g.costOfDelay),
    personName(peopleById, g.ownerId),
    g.priority,
    g.slackChannel,
    g.status,
    g.atRisk ? "at risk" : "",
    g.spotlight ? "spotlight momentum win" : "",
  ].join(" ");
}

/** Company header fields only — excludes goals. */
function companySearchTextSelf(c: CompanyWithGoals): string {
  return [
    c.id,
    c.name,
    c.shortName,
    String(c.revenue),
    c.logoPath,
    c.developmentStartDate,
    c.launchDate,
  ].join(" ");
}

function filterProject(
  p: ProjectWithMilestones,
  q: string,
  peopleById: Map<string, Person>
): ProjectWithMilestones | null {
  const self = projectSearchTextSelf(p, peopleById).toLowerCase();
  if (self.includes(q)) return p;

  const milestones = p.milestones.filter((m) =>
    milestoneSearchText(m).toLowerCase().includes(q)
  );
  if (milestones.length === 0) return null;

  return {
    ...p,
    milestones,
    progress: milestoneProgressPercent(milestones),
  };
}

function filterGoal(
  g: GoalWithProjects,
  q: string,
  peopleById: Map<string, Person>
): GoalWithProjects | null {
  const self = goalSearchTextSelf(g, peopleById).toLowerCase();
  if (self.includes(q)) return g;

  const projects = g.projects
    .map((p) => filterProject(p, q, peopleById))
    .filter((p): p is ProjectWithMilestones => p !== null);
  if (projects.length === 0) return null;

  return { ...g, projects };
}

function filterCompany(
  c: CompanyWithGoals,
  q: string,
  peopleById: Map<string, Person>
): CompanyWithGoals | null {
  const self = companySearchTextSelf(c).toLowerCase();
  if (self.includes(q)) return c;

  const goals = c.goals
    .map((g) => filterGoal(g, q, peopleById))
    .filter((g): g is GoalWithProjects => g !== null);
  if (goals.length === 0) return null;

  return { ...c, goals };
}

/**
 * Returns a pruned copy of the hierarchy: a node is kept if it matches the
 * query or has a matching descendant. If a company/goal/project matches, its
 * full subtree stays visible; otherwise milestones may be pruned to matches only.
 */
export function filterTrackerHierarchy(
  hierarchy: CompanyWithGoals[],
  people: Person[],
  rawQuery: string
): CompanyWithGoals[] {
  const q = normalizeTrackerSearchQuery(rawQuery);
  if (!q) return hierarchy;

  const peopleById = new Map(people.map((p) => [p.id, p]));

  return hierarchy
    .map((c) => filterCompany(c, q, peopleById))
    .filter((c): c is CompanyWithGoals => c !== null);
}

function filterProjectByOwner(
  p: ProjectWithMilestones,
  ownerIds: Set<string>
): ProjectWithMilestones | null {
  if (ownerIds.has(p.ownerId)) return p;
  return null;
}

function filterGoalByOwner(
  g: GoalWithProjects,
  ownerIds: Set<string>
): GoalWithProjects | null {
  if (ownerIds.has(g.ownerId)) return g;

  const projects = g.projects
    .map((p) => filterProjectByOwner(p, ownerIds))
    .filter((p): p is ProjectWithMilestones => p !== null);
  if (projects.length === 0) return null;

  return { ...g, projects };
}

function filterCompanyByOwner(
  c: CompanyWithGoals,
  ownerIds: Set<string>
): CompanyWithGoals | null {
  const goals = c.goals
    .map((g) => filterGoalByOwner(g, ownerIds))
    .filter((g): g is GoalWithProjects => g !== null);
  if (goals.length === 0) return null;

  return { ...c, goals };
}

/**
 * Keeps goals/projects where any selected person is goal owner or project owner (OR).
 * Selection tokens may be person ids or department tokens (`department:…` from
 * {@link resolveOwnerFilterTokensToOwnerIds}). If the goal owner matches one of the
 * resolved ids, the full goal (all projects) is kept; otherwise only projects owned
 * by a selected person remain.
 */
export function filterTrackerHierarchyByOwner(
  hierarchy: CompanyWithGoals[],
  ownerFilterTokens: string[] | null,
  people: Person[]
): CompanyWithGoals[] {
  if (!ownerFilterTokens || ownerFilterTokens.length === 0) return hierarchy;

  const ownerSet = resolveOwnerFilterTokensToOwnerIds(ownerFilterTokens, people);

  return hierarchy
    .map((c) => filterCompanyByOwner(c, ownerSet))
    .filter((c): c is CompanyWithGoals => c !== null);
}

/**
 * Keeps only companies whose id is in the set (OR). Empty selection means no filter.
 */
export function filterTrackerHierarchyByCompanyIds(
  hierarchy: CompanyWithGoals[],
  companyIds: string[] | null
): CompanyWithGoals[] {
  if (!companyIds || companyIds.length === 0) return hierarchy;

  const idSet = new Set(companyIds);
  return hierarchy.filter((c) => idSet.has(c.id));
}

/**
 * Keeps goals whose priority matches OR projects whose priority matches (OR).
 * If the goal matches, the full goal is kept; otherwise only matching projects.
 */
export function filterTrackerHierarchyByPriority(
  hierarchy: CompanyWithGoals[],
  priorities: string[] | null
): CompanyWithGoals[] {
  if (!priorities || priorities.length === 0) return hierarchy;

  const set = new Set(priorities);

  function filterGoal(g: GoalWithProjects): GoalWithProjects | null {
    if (set.has(g.priority)) return g;
    const projects = g.projects.filter((p) => set.has(p.priority));
    if (projects.length === 0) return null;
    return { ...g, projects };
  }

  return hierarchy
    .map((c) => {
      const goals = c.goals
        .map((g) => filterGoal(g))
        .filter((g): g is GoalWithProjects => g !== null);
      if (goals.length === 0) return null;
      return { ...c, goals };
    })
    .filter((c): c is CompanyWithGoals => c !== null);
}

/**
 * Keeps goals whose status matches OR projects whose status matches (OR).
 */
export function filterTrackerHierarchyByStatusEnum(
  hierarchy: CompanyWithGoals[],
  statuses: string[] | null
): CompanyWithGoals[] {
  if (!statuses || statuses.length === 0) return hierarchy;

  const set = new Set(statuses);

  function filterGoal(g: GoalWithProjects): GoalWithProjects | null {
    if (set.has(g.status)) return g;
    const projects = g.projects.filter((p) => set.has(p.status));
    if (projects.length === 0) return null;
    return { ...g, projects };
  }

  return hierarchy
    .map((c) => {
      const goals = c.goals
        .map((g) => filterGoal(g))
        .filter((g): g is GoalWithProjects => g !== null);
      if (goals.length === 0) return null;
      return { ...c, goals };
    })
    .filter((c): c is CompanyWithGoals => c !== null);
}

/**
 * When `hideDone` is true: removes projects with status `Done` (except those with no
 * milestones — those stay visible), drops goals that only had completed work but keeps
 * goals with an empty project list. Companies that still have no goals (never had any)
 * stay visible; companies whose goals were all removed as completed-only are dropped.
 * Done milestone rows are hidden separately in `ProjectRow` via the same toolbar toggle.
 */
export function filterTrackerHierarchyHideDoneProjects(
  hierarchy: CompanyWithGoals[],
  hideDone: boolean
): CompanyWithGoals[] {
  if (!hideDone) return hierarchy;

  return hierarchy
    .map((c) => ({
      ...c,
      goals: c.goals.flatMap((g) => {
        const hadNoProjects = g.projects.length === 0;
        const projects = g.projects.filter(
          (p) => p.milestones.length === 0 || p.status !== "Done"
        );
        if (projects.length === 0 && !hadNoProjects) return [];
        return [{ ...g, projects }];
      }),
    }))
    .filter(
      (c, idx) =>
        hierarchy[idx]!.goals.length === 0 || c.goals.length > 0
    );
}

function goalMatchesStatusTags(
  g: GoalWithProjects,
  tags: Set<TrackerStatusTagId>
): boolean {
  if (tags.has("at_risk") && g.atRisk) return true;
  if (tags.has("spotlight") && g.spotlight) return true;
  if (tags.has("unassigned") && !g.ownerId) return true;
  if (
    tags.has("stalled") &&
    g.costOfDelay >= 4 &&
    g.status !== "In Progress"
  )
    return true;
  if (tags.has("zombie") && g.projects.some((proj) => isProjectZombie(proj)))
    return true;
  return false;
}

function projectMatchesStatusTags(
  p: ProjectWithMilestones,
  tags: Set<TrackerStatusTagId>
): boolean {
  if (tags.has("at_risk") && p.atRisk) return true;
  if (tags.has("spotlight") && p.spotlight) return true;
  if (tags.has("unassigned") && !p.ownerId) return true;
  if (tags.has("zombie") && isProjectZombie(p)) return true;
  return false;
}

function filterGoalByStatusTags(
  g: GoalWithProjects,
  tags: Set<TrackerStatusTagId>
): GoalWithProjects | null {
  const goalMatches = goalMatchesStatusTags(g, tags);
  const projects = g.projects.filter((p) =>
    projectMatchesStatusTags(p, tags)
  );
  if (goalMatches) return g;
  if (projects.length > 0) return { ...g, projects };
  return null;
}

function filterCompanyByStatusTags(
  c: CompanyWithGoals,
  tags: Set<TrackerStatusTagId>
): CompanyWithGoals | null {
  const goals = c.goals
    .map((g) => filterGoalByStatusTags(g, tags))
    .filter((g): g is GoalWithProjects => g !== null);
  if (goals.length === 0) return null;
  return { ...c, goals };
}

/**
 * Keeps goals/projects where **any** selected tag applies to that row (OR).
 * If the goal row matches, the full goal (all projects) is kept; otherwise only
 * projects that match at least one selected tag remain.
 */
export function filterTrackerHierarchyByStatusTags(
  hierarchy: CompanyWithGoals[],
  tagIds: TrackerStatusTagId[] | null
): CompanyWithGoals[] {
  if (!tagIds || tagIds.length === 0) return hierarchy;

  const tags = new Set(tagIds);
  return hierarchy
    .map((c) => filterCompanyByStatusTags(c, tags))
    .filter((c): c is CompanyWithGoals => c !== null);
}

/**
 * Projects that would remain if only `tagId` were selected (same OR semantics as
 * {@link filterTrackerHierarchyByStatusTags}). Use with a hierarchy that already has
 * other tracker filters applied but **not** the status-tag filter (faceted counts).
 */
function countProjectsMatchingSingleStatusTag(
  hierarchy: CompanyWithGoals[],
  tagId: TrackerStatusTagId
): number {
  const tags = new Set<TrackerStatusTagId>([tagId]);
  let n = 0;
  for (const c of hierarchy) {
    for (const g of c.goals) {
      const goalMatches = goalMatchesStatusTags(g, tags);
      for (const p of g.projects) {
        if (goalMatches || projectMatchesStatusTags(p, tags)) {
          n++;
        }
      }
    }
  }
  return n;
}

/**
 * Per-option project counts for the Signals filter (same shape as
 * {@link countProjectsByDueDateBucket}).
 */
export function countProjectsByStatusTagBucket(
  hierarchy: CompanyWithGoals[]
): Record<TrackerStatusTagId, number> {
  return {
    at_risk: countProjectsMatchingSingleStatusTag(hierarchy, "at_risk"),
    spotlight: countProjectsMatchingSingleStatusTag(hierarchy, "spotlight"),
    unassigned: countProjectsMatchingSingleStatusTag(hierarchy, "unassigned"),
    zombie: countProjectsMatchingSingleStatusTag(hierarchy, "zombie"),
    stalled: countProjectsMatchingSingleStatusTag(hierarchy, "stalled"),
  };
}

// ---------------------------------------------------------------------------
// Due-date proximity filter
// ---------------------------------------------------------------------------

export type DueDateFilterId =
  | "overdue"
  | "next_7d"
  | "next_2w"
  | "next_month"
  | "next_3m"
  | "later"
  | "no_date";

export const DUE_DATE_FILTER_OPTIONS: {
  id: DueDateFilterId;
  label: string;
}[] = [
  { id: "overdue", label: "Overdue" },
  { id: "next_7d", label: "7 days" },
  { id: "next_2w", label: "2 weeks" },
  { id: "next_month", label: "30 days" },
  { id: "next_3m", label: "3 months" },
  { id: "later", label: "After 3 months" },
  { id: "no_date", label: "No date" },
];

function calendarDayDiff(target: Date, today: Date): number {
  const t = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const r = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((t - r) / 86400000);
}

/**
 * Calendar days from today to target (local): negative = past.
 * `null` = missing or unparseable target date.
 */
function dueDateDiffDays(
  targetDate: string,
  now: Date
): number | null {
  if (!targetDate.trim()) return null;
  const d = parseCalendarDateString(targetDate);
  if (!d) return null;
  return calendarDayDiff(d, now);
}

/** Whether a project’s target date matches one filter option (cumulative horizons for future due dates). */
export function projectMatchesDueDateOption(
  targetDate: string,
  id: DueDateFilterId,
  now?: Date
): boolean {
  const today = now ?? new Date();
  const diff = dueDateDiffDays(targetDate, today);

  switch (id) {
    case "no_date":
      return diff === null;
    case "overdue":
      return diff !== null && diff < 0;
    case "next_7d":
      return diff !== null && diff >= 0 && diff <= 7;
    case "next_2w":
      return diff !== null && diff >= 0 && diff <= 14;
    case "next_month":
      return diff !== null && diff >= 0 && diff <= 30;
    case "next_3m":
      return diff !== null && diff >= 0 && diff <= 90;
    case "later":
      return diff !== null && diff > 90;
    default:
      return false;
  }
}

/**
 * Counts per option: future horizons are **cumulative** (a project due in 3 days
 * increments the 7 days, 2 weeks, 30 days, and 3 months counts).
 */
export function countProjectsByDueDateBucket(
  hierarchy: CompanyWithGoals[],
  now?: Date
): Record<DueDateFilterId, number> {
  const counts: Record<DueDateFilterId, number> = {
    overdue: 0,
    next_7d: 0,
    next_2w: 0,
    next_month: 0,
    next_3m: 0,
    later: 0,
    no_date: 0,
  };
  const today = now ?? new Date();
  for (const c of hierarchy) {
    for (const g of c.goals) {
      for (const p of g.projects) {
        const diff = dueDateDiffDays(p.targetDate, today);
        if (diff === null) {
          counts.no_date++;
          continue;
        }
        if (diff < 0) counts.overdue++;
        if (diff >= 0 && diff <= 7) counts.next_7d++;
        if (diff >= 0 && diff <= 14) counts.next_2w++;
        if (diff >= 0 && diff <= 30) counts.next_month++;
        if (diff >= 0 && diff <= 90) counts.next_3m++;
        if (diff > 90) counts.later++;
      }
    }
  }
  return counts;
}

function projectMatchesDueDateFilter(
  p: ProjectWithMilestones,
  selected: Set<DueDateFilterId>,
  now: Date
): boolean {
  for (const id of selected) {
    if (projectMatchesDueDateOption(p.targetDate, id, now)) return true;
  }
  return false;
}

function filterGoalByDueDate(
  g: GoalWithProjects,
  selected: Set<DueDateFilterId>,
  now: Date
): GoalWithProjects | null {
  const projects = g.projects.filter((p) =>
    projectMatchesDueDateFilter(p, selected, now)
  );
  if (projects.length === 0) return null;
  return { ...g, projects };
}

function filterCompanyByDueDate(
  c: CompanyWithGoals,
  selected: Set<DueDateFilterId>,
  now: Date
): CompanyWithGoals | null {
  const goals = c.goals
    .map((g) => filterGoalByDueDate(g, selected, now))
    .filter((g): g is GoalWithProjects => g !== null);
  if (goals.length === 0) return null;
  return { ...c, goals };
}

export function filterTrackerHierarchyByDueDate(
  hierarchy: CompanyWithGoals[],
  filterIds: DueDateFilterId[] | null,
  now?: Date
): CompanyWithGoals[] {
  if (!filterIds || filterIds.length === 0) return hierarchy;

  const buckets = new Set(filterIds);
  const today = now ?? new Date();
  return hierarchy
    .map((c) => filterCompanyByDueDate(c, buckets, today))
    .filter((c): c is CompanyWithGoals => c !== null);
}
