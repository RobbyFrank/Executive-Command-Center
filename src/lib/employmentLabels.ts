import type { EmploymentKind } from "@/lib/types/tracker";

/** UI labels for Team and Roadmap owner filter (stored values stay stable). */
export function employmentLabel(kind: EmploymentKind): string {
  switch (kind) {
    case "inhouse_salaried":
      return "In-house";
    case "inhouse_hourly":
      return "In-house (hourly)";
    case "outsourced":
      return "Outsourced";
  }
}

export const EMPLOYMENT_KIND_ORDER: readonly EmploymentKind[] = [
  "inhouse_salaried",
  "inhouse_hourly",
  "outsourced",
] as const;
