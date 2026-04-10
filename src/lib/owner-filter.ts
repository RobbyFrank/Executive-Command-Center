import type { Person } from "@/lib/types/tracker";

/** Prefix for owner-filter tokens that mean “all people in this department”. */
export const OWNER_FILTER_DEPARTMENT_PREFIX = "department:" as const;

/** Prefix for owner-filter tokens: in-house vs outsourced (`employment:inhouse` | `employment:outsourced`). */
export const OWNER_FILTER_EMPLOYMENT_PREFIX = "employment:" as const;

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
  kind: "inhouse" | "outsourced"
): string {
  return `${OWNER_FILTER_EMPLOYMENT_PREFIX}${kind}`;
}

export function isOwnerFilterEmploymentToken(token: string): boolean {
  return token.startsWith(OWNER_FILTER_EMPLOYMENT_PREFIX);
}

export function ownerFilterEmploymentKind(
  token: string
): "inhouse" | "outsourced" | null {
  if (!isOwnerFilterEmploymentToken(token)) return null;
  const rest = token.slice(OWNER_FILTER_EMPLOYMENT_PREFIX.length);
  if (rest === "inhouse" || rest === "outsourced") return rest;
  return null;
}

export function ownerFilterEmploymentLabel(token: string): string | null {
  const k = ownerFilterEmploymentKind(token);
  if (k === "inhouse") return "In-house";
  if (k === "outsourced") return "Outsourced";
  return null;
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
          if (!p.outsourced) ids.add(p.id);
        }
      } else if (kind === "outsourced") {
        for (const p of people) {
          if (p.outsourced) ids.add(p.id);
        }
      }
    } else {
      ids.add(token);
    }
  }
  return ids;
}
