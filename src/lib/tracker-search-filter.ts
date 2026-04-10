import type {
  CompanyWithGoals,
  GoalWithProjects,
  Milestone,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";
import { isReviewStale } from "@/lib/reviewStaleness";
import { scoreBandSearchTokens } from "@/lib/tracker-score-bands";
import { resolveOwnerFilterTokensToOwnerIds } from "@/lib/owner-filter";

/** Multi-select status filters on the tracker (OR within selection). */
export type TrackerStatusTagId =
  | "at_risk"
  | "spotlight"
  | "unassigned"
  | "need_review";

export function normalizeTrackerSearchQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function personName(peopleById: Map<string, string>, id: string): string {
  if (!id) return "";
  return peopleById.get(id) ?? "";
}

function joinAssigneeNames(
  peopleById: Map<string, string>,
  ids: string[]
): string {
  return ids.map((id) => personName(peopleById, id)).filter(Boolean).join(" ");
}

/** Text for matching a milestone row (names, dates, status, id). */
function milestoneSearchText(m: Milestone): string {
  return [m.id, m.name, m.status, m.targetDate].join(" ");
}

/** Project fields only — excludes milestone bodies (handled in filter). */
function projectSearchTextSelf(
  p: ProjectWithMilestones,
  peopleById: Map<string, string>
): string {
  return [
    p.id,
    p.name,
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
    p.slackUrl,
    p.lastReviewed,
    p.atRisk ? "at risk" : "",
    p.spotlight ? "spotlight momentum win" : "",
  ].join(" ");
}

/** Goal fields only — excludes projects (handled in filter). */
function goalSearchTextSelf(
  g: GoalWithProjects,
  peopleById: Map<string, string>
): string {
  return [
    g.id,
    g.companyId,
    g.description,
    g.measurableTarget,
    g.currentValue,
    scoreBandSearchTokens(g.impactScore),
    scoreBandSearchTokens(g.confidenceScore),
    g.costOfDelay,
    personName(peopleById, g.ownerId),
    g.priority,
    g.executionMode,
    g.slackChannel,
    g.lastReviewed,
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

function computeProgress(milestones: Milestone[]): number {
  const total = milestones.length;
  if (total === 0) return 0;
  const done = milestones.filter((m) => m.status === "Done").length;
  return Math.round((done / total) * 100);
}

function filterProject(
  p: ProjectWithMilestones,
  q: string,
  peopleById: Map<string, string>
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
    progress: computeProgress(milestones),
  };
}

function filterGoal(
  g: GoalWithProjects,
  q: string,
  peopleById: Map<string, string>
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
  peopleById: Map<string, string>
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

  const peopleById = new Map(people.map((p) => [p.id, p.name]));

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

function goalMatchesStatusTags(
  g: GoalWithProjects,
  tags: Set<TrackerStatusTagId>
): boolean {
  if (tags.has("at_risk") && g.atRisk) return true;
  if (tags.has("spotlight") && g.spotlight) return true;
  if (tags.has("unassigned") && !g.ownerId) return true;
  if (tags.has("need_review") && isReviewStale(g.lastReviewed, "goal"))
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
  if (tags.has("need_review") && isReviewStale(p.lastReviewed, "project"))
    return true;
  return false;
}

function filterGoalByStatusTags(
  g: GoalWithProjects,
  tags: Set<TrackerStatusTagId>
): GoalWithProjects | null {
  const goalMatches = goalMatchesStatusTags(g, tags);
  const projects = g.projects.filter((p) => projectMatchesStatusTags(p, tags));
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
