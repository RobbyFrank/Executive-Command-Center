import type {
  CompanyWithGoals,
  GoalWithProjects,
  Priority,
  ProjectWithMilestones,
  Person,
} from "@/lib/types/tracker";
import {
  computeMomentumScore,
  isActiveStatus,
} from "@/lib/companyMomentum";
import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";
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

/** Color per project type — keyed by `ProjectType` literal. */
export const PROJECT_TYPE_COLOR: Record<string, string> = {
  Engineering: ATLAS_PALETTE[0]!,
  Product: ATLAS_PALETTE[1]!,
  Sales: ATLAS_PALETTE[2]!,
  Strategic: ATLAS_PALETTE[3]!,
  Operations: ATLAS_PALETTE[7]!,
  Hiring: ATLAS_PALETTE[4]!,
  Marketing: ATLAS_PALETTE[5]!,
};

/**
 * Subtle, semantic colors per priority — chosen so a priority-tinted glow
 * around a goal/project bubble reads as urgency without being garish. Aligns
 * with `priorityFlagIconClass` in `@/lib/prioritySort`.
 */
export const PRIORITY_COLOR: Record<Priority, string> = {
  P0: "#ef4444",
  P1: "#f59e0b",
  P2: "#5f7fa8",
  P3: "#71717a",
};

/**
 * Outer-glow opacity per priority. Used as the alpha on a `drop-shadow`
 * around bubble circles so urgent items quietly draw the eye even when the
 * grouping is not "priority". P3 returns 0 = no glow.
 */
export const PRIORITY_GLOW_ALPHA: Record<Priority, number> = {
  P0: 0.42,
  P1: 0.28,
  P2: 0.12,
  P3: 0,
};

/**
 * Radius multiplier per priority — the "subtle priority hierarchy" called
 * out in the plan. Applied to both goal and project bubbles, on top of the
 * project-count / milestone-count radius modulation.
 */
export const PRIORITY_RADIUS_KICKER: Record<Priority, number> = {
  P0: 1.2,
  P1: 1.1,
  P2: 1.0,
  P3: 0.9,
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
  if (grouping === "priority") {
    return PRIORITY_COLOR[project.priority] ?? PRIORITY_COLOR.P2;
  }
  if (grouping === "owner") {
    return colorForKey(project.ownerId || "unassigned");
  }
  // "goal" — color by goal id so projects in the same goal share a color
  return colorForKey(project.goalId);
}

/**
 * Resolve the (key, label, color) for one goal under the active grouping.
 * Used by the level-1 layout / `AtlasGoal` to color a goal's bubble and
 * decide its priority quadrant when grouping by priority.
 */
export interface GoalCategory {
  /** Stable key for clustering (goalId, ownerId, dept name, priority code). */
  key: string;
  /** Human-readable label for the category (Owner name, Department, Priority label). */
  label: string;
  color: string;
}

export function goalCategoryFor(
  goal: GoalWithProjects,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): GoalCategory {
  if (grouping === "department") {
    const owner = peopleById.get(goal.ownerId);
    const dept = owner?.department?.trim() || "Unassigned";
    return { key: dept, label: dept, color: departmentColor(dept) };
  }
  if (grouping === "owner") {
    const owner = peopleById.get(goal.ownerId);
    const key = goal.ownerId || "unassigned";
    return {
      key,
      label: owner?.name ?? "Unassigned",
      color: colorForKey(key),
    };
  }
  if (grouping === "priority") {
    const code = goal.priority;
    return {
      key: code,
      label: PRIORITY_MENU_LABEL[code] ?? code,
      color: PRIORITY_COLOR[code] ?? PRIORITY_COLOR.P2,
    };
  }
  // "goal" — each goal is its own category, colored uniquely by id.
  return { key: goal.id, label: goal.description, color: colorForKey(goal.id) };
}

/**
 * Status pip color for a goal. Mirrors the verbal hierarchy used elsewhere
 * (emerald = moving, amber = pre-flight, rose = blocked, slate/zinc = idle).
 */
export function goalStatusColor(status: string): string {
  switch (status) {
    case "In Progress":
    case "Ongoing":
      return "#10b981";
    case "Demand Testing":
    case "Evaluating":
    case "Planning":
      return "#d4a857";
    case "Blocked":
      return "#c06a6a";
    case "Idea":
      return "#a1a1aa";
    case "Not Started":
    default:
      return "#71717a";
  }
}

/**
 * Outer ring stroke color for a project, based on its workflow status. Used
 * by `AtlasProject` so the project bubble's status reads instantly off the
 * ring without needing the user to hover.
 */
export function projectStatusStrokeColor(status: string): string {
  switch (status) {
    case "Done":
      return "#7ba68a";
    case "In Progress":
      return "#10b981";
    case "For Review":
      return "#d4a857";
    case "Stuck":
    case "Blocked":
      return "#c06a6a";
    case "Idea":
    case "Pending":
    default:
      return "#71717a";
  }
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
