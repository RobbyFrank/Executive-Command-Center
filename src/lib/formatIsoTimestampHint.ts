/**
 * Format ISO or calendar-date strings for review-log UI (medium date + short time).
 */
export function formatIsoTimestampHint(raw: string): string {
  const s = raw.trim();
  if (!s) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split("-").map(Number);
    return new Date(y, m - 1, day, 12, 0, 0, 0).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
