/** 3×3 matrix: band index 0 = best quadrant for that axis. */

export function impactBand(impactScore: number): 0 | 1 | 2 {
  if (impactScore >= 4) return 0;
  if (impactScore === 3) return 1;
  return 2;
}

export function complexityBand(complexityScore: number): 0 | 1 | 2 {
  if (complexityScore <= 2) return 0;
  if (complexityScore === 3) return 1;
  return 2;
}

export const IMPACT_ROW_LABELS = ["High (4–5)", "Mid (3)", "Low (1–2)"] as const;
export const COMPLEXITY_COL_LABELS = ["Low (1–2)", "Mid (3)", "High (4–5)"] as const;

/** Short strategic label per cell (high impact = row 0, low complexity = col 0). */
export const MATRIX_QUADRANT_LABELS = [
  ["Quick wins", "Major bets", "Moonshots"],
  ["Fill-ins", "Standard work", "Reconsider"],
  ["Nice to have", "Low yield", "Cut or defer"],
] as const;

/**
 * Diagonal “priority heat” from top-left (best) to bottom-right (worst),
 * using Manhattan distance from (0,0).
 */
export function matrixCellToneClasses(ri: 0 | 1 | 2, ci: 0 | 1 | 2): string {
  const sum = ri + ci;
  switch (sum) {
    case 0:
      return "bg-emerald-950/38 border-emerald-800/42";
    case 1:
      return "bg-teal-950/28 border-teal-800/38";
    case 2:
      return "bg-amber-950/22 border-amber-900/32";
    case 3:
      return "bg-orange-950/24 border-orange-900/36";
    case 4:
    default:
      return "bg-red-950/28 border-red-900/40";
  }
}
