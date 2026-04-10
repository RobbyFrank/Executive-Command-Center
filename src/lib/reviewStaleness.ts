import { clampAutonomy } from "@/lib/autonomyRoster";

const HOUR_MS = 60 * 60 * 1000;

/** Baseline when owner autonomy is unknown — matches previous fixed windows. */
export const REVIEW_STALE_HOURS: Record<"goal" | "project", number> = {
  goal: 72,
  project: 24,
};

/**
 * Review cadence by owner autonomy: lower autonomy → shorter stale window
 * (goal/project). Unassigned owners use level 3 (baseline).
 */
export function getReviewStaleWindowHours(
  kind: "goal" | "project",
  ownerAutonomy: number | null | undefined
): number {
  const level =
    ownerAutonomy === undefined || ownerAutonomy === null
      ? 3
      : clampAutonomy(ownerAutonomy);
  if (kind === "project") {
    switch (level) {
      case 1:
        return 12;
      case 2:
        return 18;
      case 3:
        return 24;
      case 4:
        return 48;
      case 5:
        return 72;
      default:
        return REVIEW_STALE_HOURS.project;
    }
  }
  switch (level) {
    case 1:
      return 48;
    case 2:
      return 60;
    case 3:
      return 72;
    case 4:
      return 96;
    case 5:
      return 120;
    default:
      return REVIEW_STALE_HOURS.goal;
  }
}

/**
 * `lastReviewed` is ISO from mark-as-reviewed (legacy rows may be date-only).
 * Returns true if missing, unparseable, or past the window for that entity.
 * Optional `ownerAutonomy` tightens or relaxes the window vs baseline.
 */
export function isReviewStale(
  lastReviewed: string | undefined,
  kind: "goal" | "project",
  ownerAutonomy?: number | null
): boolean {
  if (!lastReviewed?.trim()) return true;
  const d = parseLastReviewed(lastReviewed);
  if (!d) return true;
  const hours = getReviewStaleWindowHours(kind, ownerAutonomy);
  const maxAgeMs = hours * HOUR_MS;
  return Date.now() - d.getTime() > maxAgeMs;
}

export function parseLastReviewed(s: string): Date | null {
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, day] = trimmed.split("-").map(Number);
    return new Date(y, m - 1, day, 12, 0, 0, 0);
  }
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/** Short label for tooltips (handles legacy date-only and ISO). */
export function formatLastReviewedHint(lastReviewed: string): string {
  const d = parseLastReviewed(lastReviewed);
  if (!d) return lastReviewed;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
