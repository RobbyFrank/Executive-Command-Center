import { ProjectStatusEnum } from "@/lib/schemas/tracker";
import type { ProjectStatus } from "@/lib/types/tracker";

export const PROJECT_STATUS_ORDER = [
  "Idea",
  "Pending",
  "In Progress",
  "Stuck",
  "Blocked",
  "For Review",
  "Done",
] as const;

/** Select options in pipeline order (value === stored JSON). */
export const PROJECT_STATUS_SELECT_OPTIONS: { value: string; label: string }[] =
  PROJECT_STATUS_ORDER.map((value) => ({ value, label: value }));

/** Roadmap status dropdown — excludes `Blocked` (set automatically by dependency state). */
export const PROJECT_STATUS_SELECT_OPTIONS_EDITABLE: {
  value: string;
  label: string;
}[] = PROJECT_STATUS_ORDER.filter((s) => s !== "Blocked").map((value) => ({
  value,
  label: value,
}));

/** Roadmap delivery filter: project workflow statuses only ({@link PROJECT_STATUS_ORDER}). */
export const DELIVERY_STATUS_FILTER_OPTIONS: readonly string[] = [
  ...PROJECT_STATUS_ORDER,
];

export function isProjectStatus(s: string): s is ProjectStatus {
  return ProjectStatusEnum.safeParse(s).success;
}
