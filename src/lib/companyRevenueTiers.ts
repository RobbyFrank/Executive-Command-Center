import type { Company } from "@/lib/types/tracker";
import { sortCompaniesByRevenueDesc } from "@/lib/companySort";

/** Stored `company.revenue` is monthly MRR in **thousands of USD** (1 = $1K). */
export type RevenueTierId =
  | "scale"
  | "pre-scale"
  | "pmf"
  | "startup"
  | "idea";

/** Render order: largest / most mature first. */
export const REVENUE_TIER_ORDER: RevenueTierId[] = [
  "scale",
  "pre-scale",
  "pmf",
  "startup",
  "idea",
];

export const REVENUE_TIER_META: Record<
  RevenueTierId,
  { title: string; mrrRange: string }
> = {
  scale: { title: "Scale", mrrRange: "$25K+ MRR" },
  "pre-scale": { title: "Pre-scale", mrrRange: "$10K–$25K MRR" },
  pmf: { title: "Product market fit", mrrRange: "$1K–$10K MRR" },
  startup: { title: "Startup", mrrRange: "$1–$1K MRR" },
  idea: { title: "Idea / development", mrrRange: "$0 MRR" },
};

export function getRevenueTierId(revenueThousands: number): RevenueTierId {
  const k = Math.max(0, Math.min(999, Math.floor(revenueThousands)));
  if (k >= 25) return "scale";
  if (k >= 10) return "pre-scale";
  if (k >= 2) return "pmf";
  if (k === 1) return "startup";
  return "idea";
}

/** Groups companies by tier; within each tier, revenue descending. Omits empty tiers when iterating. */
export function groupCompaniesByRevenueTier(
  companies: Company[]
): { tierId: RevenueTierId; companies: Company[] }[] {
  const buckets = new Map<RevenueTierId, Company[]>();
  for (const id of REVENUE_TIER_ORDER) {
    buckets.set(id, []);
  }
  for (const c of companies) {
    const tier = getRevenueTierId(c.revenue);
    buckets.get(tier)!.push(c);
  }
  return REVENUE_TIER_ORDER.map((tierId) => ({
    tierId,
    companies: sortCompaniesByRevenueDesc(buckets.get(tierId)!),
  })).filter((g) => g.companies.length > 0);
}
