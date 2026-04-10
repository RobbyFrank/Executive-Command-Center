const HOUR_MS = 60 * 60 * 1000;

/** Goals need a check-in less often than active project work. */
export const REVIEW_STALE_HOURS: Record<"goal" | "project", number> = {
  goal: 72,
  project: 24,
};

/**
 * `lastReviewed` is ISO from mark-as-reviewed (legacy rows may be date-only).
 * Returns true if missing, unparseable, or past the window for that entity
 * (72h goals, 24h projects).
 */
export function isReviewStale(
  lastReviewed: string | undefined,
  kind: "goal" | "project"
): boolean {
  if (!lastReviewed?.trim()) return true;
  const d = parseLastReviewed(lastReviewed);
  if (!d) return true;
  const maxAgeMs = REVIEW_STALE_HOURS[kind] * HOUR_MS;
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
