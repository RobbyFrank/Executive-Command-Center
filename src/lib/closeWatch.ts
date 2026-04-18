import { clampAutonomy } from "@/lib/autonomyRoster";
import type { Person, ProjectWithMilestones } from "@/lib/types/tracker";

/** P0/P1 owned by someone with autonomy ≤ 2 (includes 0 = not assessed) — stay closer. */
export function projectMatchesCloseWatch(
  p: ProjectWithMilestones,
  people: Person[]
): boolean {
  if (!p.ownerId) return false;
  if (p.priority !== "P0" && p.priority !== "P1") return false;
  const owner = people.find((x) => x.id === p.ownerId);
  if (!owner) return false;
  return clampAutonomy(owner.autonomyScore) <= 2;
}

export function projectMatchesCloseWatchByOwnerMap(
  p: ProjectWithMilestones,
  peopleById: Map<string, Person>
): boolean {
  if (!p.ownerId) return false;
  if (p.priority !== "P0" && p.priority !== "P1") return false;
  const owner = peopleById.get(p.ownerId);
  if (!owner) return false;
  return clampAutonomy(owner.autonomyScore) <= 2;
}
