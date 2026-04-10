import type { EmploymentKind, Person } from "@/lib/types/tracker";
import {
  autonomyShortTitle,
  clampAutonomy,
  type AutonomyLevel,
} from "@/lib/autonomyRoster";

/** Prefix for owner-filter tokens that mean “all people at this autonomy level”. */
export const OWNER_FILTER_AUTONOMY_PREFIX = "autonomy:" as const;

/** Prefix for owner-filter tokens that mean “all people in this department”. */
export const OWNER_FILTER_DEPARTMENT_PREFIX = "department:" as const;

/**
 * Prefix for owner-filter tokens (`employment:*`).
 * Includes legacy `employment:inhouse` (any non-outsourced).
 */
export const OWNER_FILTER_EMPLOYMENT_PREFIX = "employment:" as const;

/** Slug after `employment:` — `inhouse` matches both in-house kinds (legacy). */
export type OwnerFilterEmploymentSlug =
  | "inhouse"
  | EmploymentKind;

export function ownerFilterDepartmentToken(department: string): string {
  const d = department.trim();
  return `${OWNER_FILTER_DEPARTMENT_PREFIX}${encodeURIComponent(d)}`;
}

export function isOwnerFilterDepartmentToken(token: string): boolean {
  return token.startsWith(OWNER_FILTER_DEPARTMENT_PREFIX);
}

export function ownerFilterDepartmentLabel(token: string): string | null {
  if (!isOwnerFilterDepartmentToken(token)) return null;
  const encoded = token.slice(OWNER_FILTER_DEPARTMENT_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded || null;
  }
}

export function ownerFilterEmploymentToken(
  kind: OwnerFilterEmploymentSlug
): string {
  return `${OWNER_FILTER_EMPLOYMENT_PREFIX}${kind}`;
}

export function isOwnerFilterEmploymentToken(token: string): boolean {
  return token.startsWith(OWNER_FILTER_EMPLOYMENT_PREFIX);
}

export function ownerFilterEmploymentKind(
  token: string
): OwnerFilterEmploymentSlug | null {
  if (!isOwnerFilterEmploymentToken(token)) return null;
  const rest = token.slice(OWNER_FILTER_EMPLOYMENT_PREFIX.length);
  if (
    rest === "inhouse" ||
    rest === "inhouse_salaried" ||
    rest === "inhouse_hourly" ||
    rest === "outsourced"
  ) {
    return rest;
  }
  return null;
}

export function ownerFilterEmploymentLabel(token: string): string | null {
  const k = ownerFilterEmploymentKind(token);
  if (k === "inhouse") return "In-house";
  if (k === "inhouse_salaried") return "In-house";
  if (k === "inhouse_hourly") return "In-house (hourly)";
  if (k === "outsourced") return "Outsourced";
  return null;
}

export function ownerFilterAutonomyToken(level: AutonomyLevel): string {
  return `${OWNER_FILTER_AUTONOMY_PREFIX}${level}`;
}

export function isOwnerFilterAutonomyToken(token: string): boolean {
  return token.startsWith(OWNER_FILTER_AUTONOMY_PREFIX);
}

export function ownerFilterAutonomyLevel(
  token: string
): AutonomyLevel | null {
  if (!isOwnerFilterAutonomyToken(token)) return null;
  const rest = token.slice(OWNER_FILTER_AUTONOMY_PREFIX.length);
  const n = Number.parseInt(rest, 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return n as AutonomyLevel;
}

/** Short label for filter chips / button summary (name only; level is in the icon). */
export function ownerFilterAutonomyLabel(token: string): string | null {
  const level = ownerFilterAutonomyLevel(token);
  if (level === null) return null;
  return autonomyShortTitle(level);
}

/**
 * Expands department and employment tokens to person ids; passes through raw ids as goal/project owner ids.
 */
export function resolveOwnerFilterTokensToOwnerIds(
  tokens: string[],
  people: Person[]
): Set<string> {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (isOwnerFilterDepartmentToken(token)) {
      const label = ownerFilterDepartmentLabel(token);
      if (!label?.trim()) continue;
      const want = label.trim().toLowerCase();
      for (const p of people) {
        const d = (p.department ?? "").trim().toLowerCase();
        if (d && d === want) ids.add(p.id);
      }
    } else if (isOwnerFilterEmploymentToken(token)) {
      const kind = ownerFilterEmploymentKind(token);
      if (kind === "inhouse") {
        for (const p of people) {
          if (p.employment !== "outsourced") ids.add(p.id);
        }
      } else if (kind === "inhouse_salaried") {
        for (const p of people) {
          if (p.employment === "inhouse_salaried") ids.add(p.id);
        }
      } else if (kind === "inhouse_hourly") {
        for (const p of people) {
          if (p.employment === "inhouse_hourly") ids.add(p.id);
        }
      } else if (kind === "outsourced") {
        for (const p of people) {
          if (p.employment === "outsourced") ids.add(p.id);
        }
      }
    } else if (isOwnerFilterAutonomyToken(token)) {
      const level = ownerFilterAutonomyLevel(token);
      if (level === null) continue;
      for (const p of people) {
        if (clampAutonomy(p.autonomyScore) === level) ids.add(p.id);
      }
    } else {
      ids.add(token);
    }
  }
  return ids;
}
