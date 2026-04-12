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

export function isProjectStatus(s: string): s is ProjectStatus {
  return ProjectStatusEnum.safeParse(s).success;
}
