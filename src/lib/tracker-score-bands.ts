/** 1–5 scale stored in JSON; labels shown in tracker dropdowns (highest first). */
export const SCORE_BAND_OPTIONS: { value: string; label: string }[] = [
  { value: "5", label: "Very high" },
  { value: "4", label: "High" },
  { value: "3", label: "Medium" },
  { value: "2", label: "Low" },
  { value: "1", label: "Minimal" },
];

export function scoreBandLabel(score: number): string {
  const opt = SCORE_BAND_OPTIONS.find((o) => o.value === String(score));
  return opt?.label ?? String(score);
}

/** Compact labels for narrow grid cells (Cost of delay / Complexity bar readouts). Dropdowns keep full `scoreBandLabel`. */
export function scoreBandLabelShort(score: number): string {
  const n = Math.round(score);
  if (n === 5) return "V. High";
  if (n === 4) return "High";
  if (n === 3) return "Med";
  if (n === 2) return "Low";
  if (n === 1) return "Min";
  return scoreBandLabel(score);
}

/** Lowercase tokens for search (includes common variants). */
export function scoreBandSearchTokens(score: number): string {
  const label = scoreBandLabel(score).toLowerCase();
  const extra = score === 5 ? "very-high very high" : "";
  return `${String(score)} ${label} ${extra}`.trim();
}

export function parseScoreBand(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return 3;
  return n;
}
