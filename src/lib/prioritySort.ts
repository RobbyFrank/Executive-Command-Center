import type { Priority } from "@/lib/types/tracker";

const PRIORITY_ORDER: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Sort key: P0 first, then P1, P2, P3. Unknown values sort last. */
export function comparePriority(a: string, b: string): number {
  const ia = PRIORITY_ORDER[a as Priority];
  const ib = PRIORITY_ORDER[b as Priority];
  const na = ia === undefined ? 99 : ia;
  const nb = ib === undefined ? 99 : ib;
  return na - nb;
}

/** Tailwind text color for inline priority selects (subtle). */
export function prioritySelectTextClass(priority: string): string {
  switch (priority) {
    case "P0":
      return "text-red-400";
    case "P1":
      return "text-orange-400";
    case "P2":
      return "text-blue-400";
    case "P3":
      return "text-zinc-400";
    default:
      return "text-zinc-300";
  }
}
