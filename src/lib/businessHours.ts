/**
 * Business time = elapsed wall time excluding full Saturday and Sunday (local timezone).
 * Used for "48 business hours without reply" on the Followups page.
 */

function isWeekendLocal(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Returns milliseconds of "business time" between `from` and `to` (exclusive of weekend days).
 * If `to <= from`, returns 0.
 *
 * Weekends: any instant where the local calendar day is Saturday or Sunday contributes 0
 * for that entire local day (we skip crossing weekend by advancing day-by-day).
 */
export function businessMsBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;

  let ms = 0;
  let cursor = new Date(from.getTime());

  // Walk in 1-hour chunks for precision within days; skip weekend hours.
  const HOUR = 3600_000;
  const end = to.getTime();

  while (cursor.getTime() < end) {
    const nextHour = Math.min(cursor.getTime() + HOUR, end);
    if (!isWeekendLocal(cursor)) {
      ms += nextHour - cursor.getTime();
    }
    cursor = new Date(nextHour);
  }

  return ms;
}

/** Business hours as a decimal (48.0 = 48 business hours). */
export function businessHoursBetween(from: Date, to: Date): number {
  return businessMsBetween(from, to) / 3600_000;
}
