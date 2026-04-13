import { ProjectStatusEnum } from "@/lib/schemas/tracker";
import type { ProjectStatus } from "@/lib/types/tracker";

export const PROJECT_STATUS_ORDER = [
  "Idea",
  "Pending",
  "In Progress",
  "Stuck",
  "For Review",
  "Done",
] as const;

/** Select options in pipeline order (value === stored JSON). */
export const PROJECT_STATUS_SELECT_OPTIONS: { value: string; label: string }[] =
  PROJECT_STATUS_ORDER.map((value) => ({ value, label: value }));

/**
 * Goal-level statuses that are not in {@link PROJECT_STATUS_ORDER} but can appear
 * on goals and in the Roadmap delivery filter (OR match on goal or project status).
 */
export const GOAL_DELIVERY_STATUSES_FOR_FILTER = [
  "Not Started",
  "Planning",
  "Blocked",
  "Ongoing",
  "Demand Testing",
  "Evaluating",
] as const;

/** Single ordered list for the delivery filter: project pipeline first, then goal-only. */
export const DELIVERY_STATUS_FILTER_OPTIONS: readonly string[] = [
  ...PROJECT_STATUS_ORDER,
  ...GOAL_DELIVERY_STATUSES_FOR_FILTER,
];

export function isProjectStatus(s: string): s is ProjectStatus {
  return ProjectStatusEnum.safeParse(s).success;
}
