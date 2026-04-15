const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` as a local calendar date; invalid combinations return null. */
export function parseCalendarDateString(s: string): Date | null {
  const m = s.trim().match(YMD);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Today's calendar date in local time as `YYYY-MM-DD` (same convention as target/start dates). */
export function calendarDateTodayLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar-day difference: `target − reference` in whole days (local). */
function calendarDaysBetween(target: Date, reference: Date): number {
  const t = Date.UTC(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );
  const r = Date.UTC(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate()
  );
  return Math.round((t - r) / 86400000);
}

/**
 * True when `ymd` is a valid calendar date strictly before today (local).
 * Empty or invalid input is treated as not past due.
 */
export function isCalendarDatePastDue(ymd: string, now = new Date()): boolean {
  const target = parseCalendarDateString(ymd);
  if (!target) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return calendarDaysBetween(target, today) < 0;
}

/**
 * Target-date urgency for open milestones (local calendar days until due).
 * - `none`: empty or invalid date
 * - `overdue`: before today
 * - `today`: due today
 * - `soon`: due in 1–3 days
 * - `this_week`: due in 4–7 days
 * - `later`: due in 8+ days
 */
export type MilestoneDueHorizon =
  | "none"
  | "overdue"
  | "today"
  | "soon"
  | "this_week"
  | "later";

export function getMilestoneDueHorizon(
  ymd: string,
  now = new Date()
): MilestoneDueHorizon {
  const target = parseCalendarDateString(ymd);
  if (!target) return "none";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = calendarDaysBetween(target, today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  if (diff <= 7) return "this_week";
  return "later";
}

/**
 * Human-friendly relative label for a calendar date (e.g. target dates).
 * Examples: today, yesterday, in 6 days (under 2 weeks), in 5 weeks, 3 months ago, in 1 year.
 */
export function formatRelativeCalendarDate(
  ymd: string,
  now = new Date()
): string {
  const target = parseCalendarDateString(ymd);
  if (!target) return ymd;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = calendarDaysBetween(target, today);

  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";

  const abs = Math.abs(diff);
  const future = diff > 0;

  /** Near-term only — past ~2 weeks we switch to rounded weeks. */
  if (abs < 14) {
    if (abs === 7) {
      return future ? "in 1 week" : "1 week ago";
    }
    const dayWord = abs === 1 ? "day" : "days";
    return future ? `in ${abs} ${dayWord}` : `${abs} ${dayWord} ago`;
  }

  if (abs < 60) {
    const w = Math.max(1, Math.round(abs / 7));
    return future
      ? w === 1
        ? "in 1 week"
        : `in ${w} weeks`
      : w === 1
        ? "1 week ago"
        : `${w} weeks ago`;
  }

  if (abs < 365) {
    const months = Math.max(1, Math.round(abs / 30));
    return future
      ? months === 1
        ? "in 1 month"
        : `in ${months} months`
      : months === 1
        ? "1 month ago"
        : `${months} months ago`;
  }

  const years = Math.max(1, Math.round(abs / 365));
  return future
    ? years === 1
      ? "in 1 year"
      : `in ${years} years`
    : years === 1
      ? "1 year ago"
      : `${years} years ago`;
}

/**
 * Ultra-compact horizon for tight grid cells (e.g. Next milestone badge).
 * Signed calendar offset: `-3D` = 3 days ago, `5D` = in 5 days, `2W`, `-1M`, `1Y`.
 * Invalid / empty input: returns `null`.
 */
export function formatRelativeCalendarDateCompact(
  ymd: string,
  now = new Date()
): string | null {
  const target = parseCalendarDateString(ymd);
  if (!target) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = calendarDaysBetween(target, today);
  const abs = Math.abs(diff);

  if (abs < 14) {
    return `${diff}D`;
  }
  if (abs < 60) {
    const w = Math.max(1, Math.round(abs / 7));
    const sign = diff >= 0 ? 1 : -1;
    return `${sign * w}W`;
  }
  if (abs < 365) {
    const mo = Math.max(1, Math.round(abs / 30));
    const sign = diff >= 0 ? 1 : -1;
    return `${sign * mo}M`;
  }
  const y = Math.max(1, Math.round(abs / 365));
  const sign = diff >= 0 ? 1 : -1;
  return `${sign * y}Y`;
}

/** Absolute date for tooltips (locale-aware). */
export function formatCalendarDateHint(ymd: string): string {
  const d = parseCalendarDateString(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
