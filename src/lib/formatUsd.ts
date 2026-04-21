/** Whole US dollars (e.g. monthly salary, group rollups). */
export function formatUsdWhole(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Compact thousands for tight UI (e.g. `$3k`, `$1.5k`). Under $1k uses whole dollars (`$500`).
 */
export function formatUsdCompactK(amount: number): string {
  const n = Math.round(Math.max(0, amount));
  if (n === 0) return "—";
  if (n < 1000) return `$${n}`;
  const thousands = n / 1000;
  const rounded = Math.round(thousands * 10) / 10;
  const whole = rounded === Math.floor(rounded);
  const body = whole
    ? String(Math.round(rounded))
    : String(rounded).replace(/\.0$/, "");
  return `$${body}k`;
}
