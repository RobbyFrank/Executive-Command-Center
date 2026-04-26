import type {
  CompanyWithGoals,
  GoalWithProjects,
  Milestone,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";

/**
 * How items are color-coded in the atlas. The `"goal"` key means **no
 * grouping** (a single free pack at goals L1 and projects L2). For
 * "priority" at L1, goals are softly sectioned. Department / owner /
 * priority apply to goals at L1 and to projects at L2.
 * `goalCategoryFor` / `projectCategoryFor` in `atlas-activity.ts` supply
 * labels and colors. Project type is always shown on each project bubble
 * (Engineering, Product, …), not as a group axis.
 */
export type GroupingKey = "goal" | "department" | "owner" | "priority";

export const GROUPING_OPTIONS: { key: GroupingKey; label: string }[] = [
  { key: "goal", label: "Ungrouped" },
  { key: "department", label: "Department" },
  { key: "owner", label: "Owner" },
  { key: "priority", label: "Priority" },
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

/**
 * Circle inside a focused company — one per **goal**, freely placed in the
 * ether. The `categoryKey` / `categoryLabel` / `color` reflect the active
 * `GroupingKey` (e.g. owner name when grouping by owner, priority label when
 * grouping by priority). The goal itself is always the unit; the grouping
 * only controls how the bubble is colored / clustered.
 */
export interface LaidGoal {
  /** Composite id: `${companyId}:${goal.id}`. */
  id: string;
  /** Raw goal id (matches `Goal.id`). Kept on `bucketKey` for back-compat with
   *  components that still read the old `LaidGroup.bucketKey` slot. */
  bucketKey: string;
  /** Goal description used as the bubble title. */
  label: string;
  /** Category color (depends on `GroupingKey`). */
  color: string;
  /** Category key (goalId / department / ownerId / priority code). */
  categoryKey: string;
  /** Category display label (department name, owner name, priority label, etc.). */
  categoryLabel: string;
  cx: number;
  cy: number;
  r: number;
  /** Number of non-mirror projects on this goal. */
  projectCount: number;
  /** Projects on this goal (flattened). */
  projects: ProjectWithMilestones[];
  /** The underlying goal record. */
  goal: GoalWithProjects;
}

/**
 * @deprecated Use `LaidGoal`. Retained only as a structural type alias for
 * any caller that still consumes the old shape.
 */
export type LaidGroup = LaidGoal;

/** Circle inside a focused goal — one per project. */
export interface LaidProject {
  id: string;
  /** Owning company id (parsed from the parent `LaidGoal.id`). */
  companyId: string;
  /** Composite parent goal id (`${companyId}:${goalId}`). */
  groupId: string;
  /** Raw goal id this project belongs to (matches `LaidGoal.bucketKey`). */
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

/**
 * One visual section at goals L1 or projects L2 when grouping is not
 * "Ungrouped" (`"goal"`). Renders as a large soft-tinted rounded
 * rectangle with a header (category + count). Bubbles in this category
 * are placed inside and never overlap.
 */
export interface AtlasSection {
  /** Stable category key (priority code, dept name, owner id). */
  key: string;
  /** Display label in the section header (e.g. "URGENT", "ENGINEERING"). */
  label: string;
  /** Section tint color (typically the category color). */
  color: string;
  /** Rectangle in canvas viewBox coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Number of goals (L1) or projects (L2) in this section. */
  goalCount: number;
}

export type { CompanyWithGoals, GoalWithProjects, ProjectWithMilestones, Milestone, Person };
