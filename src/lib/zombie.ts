import type { ProjectWithMilestones } from "@/lib/types/tracker";
import { parseLastReviewed } from "@/lib/reviewStaleness";

/** Days without review update to flag stalled in-progress work (approx. spec "3+ weeks"). */
export const ZOMBIE_STALE_REVIEW_DAYS = 21;

/**
 * Heuristic "zombie" project: In Progress, no milestone progress yet, and review
 * not updated recently (we don't store milestone completion timestamps).
 */
export function isProjectZombie(p: ProjectWithMilestones): boolean {
  if (p.status !== "In Progress") return false;
  if (p.progress > 0) return false;

  const raw = p.lastReviewed?.trim();
  if (!raw) return true;

  const d = parseLastReviewed(raw);
  if (!d) return true;

  const days = (Date.now() - d.getTime()) / 86400000;
  return days > ZOMBIE_STALE_REVIEW_DAYS;
}
