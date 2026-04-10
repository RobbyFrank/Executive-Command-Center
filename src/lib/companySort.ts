import type { Company } from "@/lib/types/tracker";

/** Highest revenue first; ties broken by name. */
export function sortCompaniesByRevenueDesc(companies: Company[]): Company[] {
  return [...companies].sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return a.name.localeCompare(b.name);
  });
}
