import type {
  CompanyWithGoals,
  GoalWithProjects,
  Milestone,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";

/** What the second-level ring groups projects by inside a focused company. */
export type GroupingKey = "goal" | "department" | "owner" | "type";

export const GROUPING_OPTIONS: { key: GroupingKey; label: string }[] = [
  { key: "goal", label: "Goal" },
  { key: "department", label: "Department" },
  { key: "owner", label: "Owner" },
  { key: "type", label: "Project type" },
];

/** Stable color palette reused by department / project-type / owner bucket colors. */
export const ATLAS_PALETTE = [
  "#5f7fa8", // slate blue
  "#7ba68a", // sage
  "#c49958", // amber
  "#8879b0", // muted violet
  "#b07495", // dusty pink
  "#5a9ca6", // teal
  "#a88e5f", // ochre
  "#7a7a7a", // neutral grey
] as const;

/** Pick a deterministic palette color from a string key. */
export function colorForKey(key: string): string {
  if (!key) return ATLAS_PALETTE[ATLAS_PALETTE.length - 1]!;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return ATLAS_PALETTE[hash % ATLAS_PALETTE.length]!;
}

/** Circle placed on the main canvas — one per company. */
export interface LaidCompany {
  id: string;
  name: string;
  cx: number;
  cy: number;
  r: number;
  activity: number;
  projectCount: number;
  atRiskCount: number;
  stuckCount: number;
  company: CompanyWithGoals;
}

/** Circle inside a focused company — one per grouping bucket (goal / department / owner / type). */
export interface LaidGroup {
  /** Composite id: `${companyId}:${groupingKey}:${bucketKey}`. */
  id: string;
  /** Raw bucket key (goalId, department name, ownerId, or project type). */
  bucketKey: string;
  label: string;
  color: string;
  cx: number;
  cy: number;
  r: number;
  projectCount: number;
  projects: ProjectWithMilestones[];
}

/** Circle inside a group — one per project. */
export interface LaidProject {
  id: string;
  companyId: string;
  groupId: string;
  /** The grouping bucket this project belongs to (goalId, department, ownerId, or type). */
  bucketKey: string;
  cx: number;
  cy: number;
  r: number;
  project: ProjectWithMilestones;
  /** Resolved color (from department or project type palette). */
  color: string;
  /** True when the project has been quiet for a while (derived from status). */
  isStale: boolean;
  /** True when Project.atRisk or status is Stuck/Blocked. */
  isAtRisk: boolean;
}

/** Circle inside a project — one per milestone. */
export interface LaidMilestone {
  id: string;
  projectId: string;
  cx: number;
  cy: number;
  r: number;
  milestone: Milestone;
  /** Color bucket derived from status + target date. */
  color: string;
}

/** Camera anchor for the CSS transform. */
export interface CameraTarget {
  cx: number;
  cy: number;
  r: number;
}

export type { CompanyWithGoals, GoalWithProjects, ProjectWithMilestones, Milestone, Person };
