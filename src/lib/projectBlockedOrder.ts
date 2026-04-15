import type { Project } from "@/lib/types/tracker";
import { comparePriority } from "@/lib/prioritySort";

/**
 * Orders projects shown under a goal so that when `blockedByProjectId` points to
 * another project in the same list, the blocked project appears directly under that
 * blocker (depth-first among siblings: priority order).
 */
export function sortProjectsBlockedUnderBlocker<
  T extends Pick<Project, "id" | "priority" | "blockedByProjectId">,
>(projects: T[]): T[] {
  if (projects.length <= 1) return [...projects];

  const ids = new Set(projects.map((p) => p.id));
  const children = new Map<string, T[]>();

  for (const p of projects) {
    const bid = (p.blockedByProjectId ?? "").trim();
    if (bid && ids.has(bid)) {
      const list = children.get(bid);
      if (list) list.push(p);
      else children.set(bid, [p]);
    }
  }
  for (const [, arr] of children) {
    arr.sort((a, b) => comparePriority(a.priority, b.priority));
  }

  const roots = projects
    .filter((p) => {
      const bid = (p.blockedByProjectId ?? "").trim();
      return !bid || !ids.has(bid);
    })
    .sort((a, b) => comparePriority(a.priority, b.priority));

  const result: T[] = [];

  function visit(p: T) {
    result.push(p);
    const kids = children.get(p.id);
    if (kids) {
      for (const k of kids) visit(k);
    }
  }

  for (const r of roots) visit(r);

  if (result.length < projects.length) {
    const seen = new Set(result.map((p) => p.id));
    const tail = projects
      .filter((p) => !seen.has(p.id))
      .sort((a, b) => comparePriority(a.priority, b.priority));
    result.push(...tail);
  }

  return result;
}
