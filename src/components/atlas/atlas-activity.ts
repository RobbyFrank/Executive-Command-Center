import type {
  CompanyWithGoals,
  GoalWithProjects,
  ProjectWithMilestones,
  Person,
} from "@/lib/types/tracker";
import {
  computeMomentumScore,
  isActiveStatus,
} from "@/lib/companyMomentum";
import { ATLAS_PALETTE, colorForKey, type GroupingKey } from "./atlas-types";

/**
 * Activity score for a company (0–100). Reuses `computeMomentumScore` so the
 * Atlas circle size agrees with the Companies directory's momentum column.
 */
export function companyActivityScore(company: CompanyWithGoals): number {
  const goals = company.goals;
  const projects = goals.flatMap((g) => g.projects);
  const activeGoals = goals.filter((g) => isActiveStatus(g.status)).length;
  const activeProjects = projects.filter((p) => isActiveStatus(p.status)).length;
  const goalsWithSpotlight = goals.filter((g) => g.spotlight).length;
  const goalsWithAtRisk = goals.filter((g) => g.atRisk).length;
  const projectsWithSpotlight = projects.filter((p) => p.spotlight).length;
  const projectsWithAtRisk = projects.filter((p) => p.atRisk).length;
  const milestonesDone = projects.reduce(
    (sum, p) => sum + p.milestones.filter((m) => m.status === "Done").length,
    0
  );
  const milestonesTotal = projects.reduce(
    (sum, p) => sum + p.milestones.length,
    0
  );

  return computeMomentumScore({
    goals: goals.length,
    projects: projects.length,
    activeGoals,
    activeProjects,
    goalsWithSpotlight,
    goalsWithAtRisk,
    projectsWithSpotlight,
    projectsWithAtRisk,
    milestonesDone,
    milestonesTotal,
  });
}

export function isProjectAtRisk(project: ProjectWithMilestones): boolean {
  return (
    project.atRisk ||
    project.status === "Stuck" ||
    project.status === "Blocked"
  );
}

/**
 * "Stale" for atlas purposes: project is idle (not moving, not shipped) — i.e.
 * status Idea / Pending. Used to render faded/dashed circles.
 */
export function isProjectStale(project: ProjectWithMilestones): boolean {
  return project.status === "Idea" || project.status === "Pending";
}

export interface GroupBucket {
  key: string;
  label: string;
  color: string;
  projects: ProjectWithMilestones[];
}

/** Flatten every project in a company with its goal reference. */
function flattenCompanyProjects(
  company: CompanyWithGoals
): { goal: GoalWithProjects; project: ProjectWithMilestones }[] {
  const out: { goal: GoalWithProjects; project: ProjectWithMilestones }[] = [];
  for (const goal of company.goals) {
    for (const project of goal.projects) {
      out.push({ goal, project });
    }
  }
  return out;
}

/**
 * Deterministic, stable color map for departments so the same department is
 * always the same color across companies.
 */
const DEPARTMENT_COLOR_CACHE = new Map<string, string>();
function departmentColor(name: string): string {
  const key = name.trim().toLowerCase() || "unassigned";
  const cached = DEPARTMENT_COLOR_CACHE.get(key);
  if (cached) return cached;
  const color = colorForKey(key);
  DEPARTMENT_COLOR_CACHE.set(key, color);
  return color;
}

const PROJECT_TYPE_COLOR: Record<string, string> = {
  Engineering: ATLAS_PALETTE[0]!,
  Product: ATLAS_PALETTE[1]!,
  Sales: ATLAS_PALETTE[2]!,
  Strategic: ATLAS_PALETTE[3]!,
  Operations: ATLAS_PALETTE[7]!,
  Hiring: ATLAS_PALETTE[4]!,
  Marketing: ATLAS_PALETTE[5]!,
};

/** Color assigned to a project circle based on the active grouping key. */
export function projectColor(
  project: ProjectWithMilestones,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): string {
  if (grouping === "department") {
    const owner = peopleById.get(project.ownerId);
    return departmentColor(owner?.department ?? "");
  }
  if (grouping === "type") {
    return PROJECT_TYPE_COLOR[project.type] ?? ATLAS_PALETTE[7]!;
  }
  if (grouping === "owner") {
    return colorForKey(project.ownerId || "unassigned");
  }
  // "goal" — color by goal id so projects in the same goal share a color
  return colorForKey(project.goalId);
}

/** Group every project in the company into buckets for the chosen grouping. */
export function bucketsForCompany(
  company: CompanyWithGoals,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): GroupBucket[] {
  const entries = flattenCompanyProjects(company);
  const byKey = new Map<string, GroupBucket>();

  for (const { goal, project } of entries) {
    let key: string;
    let label: string;
    let color: string;
    if (grouping === "goal") {
      key = goal.id;
      label = goal.description;
      color = colorForKey(goal.id);
    } else if (grouping === "department") {
      const owner = peopleById.get(project.ownerId);
      const dept = owner?.department?.trim() || "Unassigned";
      key = dept;
      label = dept;
      color = departmentColor(dept);
    } else if (grouping === "owner") {
      const owner = peopleById.get(project.ownerId);
      key = project.ownerId || "unassigned";
      label = owner?.name ?? "Unassigned";
      color = colorForKey(key);
    } else {
      // type
      key = project.type;
      label = project.type;
      color = PROJECT_TYPE_COLOR[project.type] ?? ATLAS_PALETTE[7]!;
    }

    const bucket = byKey.get(key);
    if (bucket) {
      bucket.projects.push(project);
    } else {
      byKey.set(key, { key, label, color, projects: [project] });
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => b.projects.length - a.projects.length || a.label.localeCompare(b.label)
  );
}

/** Progress of a milestone as a proportion 0–1 (Done = 1, Not Done = 0). */
export function milestoneProgress(status: string): number {
  return status === "Done" ? 1 : 0;
}

/**
 * Color for a milestone circle based on status and (if not done) its target date.
 */
export function milestoneColor(status: string, targetDate: string): string {
  if (status === "Done") return "#7ba68a"; // emerald-muted
  if (targetDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = targetDate.split("-").map((x) => Number(x));
    if (y && m && d) {
      const target = new Date(y, m - 1, d);
      if (target.getTime() < today.getTime()) return "#c06a6a"; // overdue
      const diffDays = (target.getTime() - today.getTime()) / 86_400_000;
      if (diffDays <= 14) return "#d4a857"; // soon
    }
  }
  return "#5f7fa8"; // default in-flight
}
