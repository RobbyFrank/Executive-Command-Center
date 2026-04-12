import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar day `ymd` + `deltaDays` as `YYYY-MM-DD`, or null if `ymd` is invalid. */
export function calendarDateYmdPlusDays(
  ymd: string,
  deltaDays: number
): string | null {
  const d = parseCalendarDateString(ymd.trim());
  if (!d) return null;
  d.setDate(d.getDate() + deltaDays);
  return formatLocalYmd(d);
}

/**
 * Minimum due date (inclusive) for a project in a Sync goal: the first calendar day
 * **strictly after** the previous project’s due date. Undefined if there is no valid previous due date.
 */
export function minDueDateYmdAfterPreviousProject(
  previousProjectTargetDate: string
): string | undefined {
  const t = previousProjectTargetDate.trim();
  if (!t) return undefined;
  const min = calendarDateYmdPlusDays(t, 1);
  return min ?? undefined;
}

/**
 * Server/client guard: for Sync goals, a non-empty due date must be strictly after
 * the previous project’s due date when that previous date is set and valid.
 */
export function validateSyncDueDateVsPrevious(options: {
  executionMode: string;
  previousProjectTargetDate: string;
  newTargetDate: string;
}): string | undefined {
  if (options.executionMode !== "Sync") return undefined;
  const next = options.newTargetDate.trim();
  if (!next) return undefined;
  const prev = options.previousProjectTargetDate.trim();
  if (!prev) return undefined;
  const dPrev = parseCalendarDateString(prev);
  const dNext = parseCalendarDateString(next);
  if (!dNext) return "Due date must be a valid calendar date.";
  if (!dPrev) return undefined;
  if (dNext.getTime() <= dPrev.getTime()) {
    return "In Sync goals, due date must be later than the previous project’s due date.";
  }
  return undefined;
}
