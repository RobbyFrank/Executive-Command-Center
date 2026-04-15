import type { Company } from "@/lib/types/tracker";

/** Pinned first, then highest revenue; ties broken by name. */
export function compareCompaniesDisplayOrder(a: Company, b: Company): number {
  const ap = a.pinned ? 1 : 0;
  const bp = b.pinned ? 1 : 0;
  if (bp !== ap) return bp - ap;
  if (b.revenue !== a.revenue) return b.revenue - a.revenue;
  return a.name.localeCompare(b.name);
}

/** Pinned companies first, then highest revenue; ties broken by name. */
export function sortCompaniesByRevenueDesc(companies: Company[]): Company[] {
  return [...companies].sort(compareCompaniesDisplayOrder);
}
