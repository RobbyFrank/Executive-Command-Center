import type { EmploymentKind, Person, PersonWorkload } from "@/lib/types/tracker";
import {
  FOUNDERS_DEPARTMENT,
  isFounderPersonId,
} from "@/lib/autonomyRoster";
import { normalizeTrackerSearchQuery } from "@/lib/tracker-search-filter";

/** Workload bucket filters (OR within selection). */
export type TeamWorkloadFilterId =
  | "idle"
  | "light"
  | "moderate"
  | "heavy"
  | "has_p0";

/** Profile completeness checks (OR within selection). */
export type TeamMissingDetailId =
  | "no_department"
  | "no_role"
  | "no_photo"
  | "no_join_date"
  | "no_slack";

/** Which filter dimension to ignore when computing faceted counts. */
export type TeamRosterFilterOmit =
  | "search"
  | "department"
  | "employment"
  | "workload"
  | "company"
  | "missing";

export interface TeamRosterFilterState {
  searchQuery: string;
  /** `""` = no department; include `FOUNDERS_DEPARTMENT` for founders. */
  departmentValues: string[];
  employmentKinds: EmploymentKind[];
  workloadIds: TeamWorkloadFilterId[];
  companyIds: string[];
  missingDetailIds: TeamMissingDetailId[];
}

const EMPTY_STATE: TeamRosterFilterState = {
  searchQuery: "",
  departmentValues: [],
  employmentKinds: [],
  workloadIds: [],
  companyIds: [],
  missingDetailIds: [],
};

export function teamRosterSearchText(p: Person): string {
  return [
    p.name,
    p.role ?? "",
    p.department ?? "",
    p.slackHandle ?? "",
    String(p.estimatedMonthlySalary ?? ""),
  ]
    .join(" ")
    .toLowerCase();
}

export function personMatchesTeamSearch(p: Person, query: string): boolean {
  const q = normalizeTrackerSearchQuery(query);
  if (!q) return true;
  return teamRosterSearchText(p).includes(q);
}

function matchesWorkload(
  w: PersonWorkload | undefined,
  ids: TeamWorkloadFilterId[]
): boolean {
  if (ids.length === 0) return true;
  const total = w?.totalProjects ?? 0;
  const p0 = w?.p0Projects ?? 0;
  return ids.some((id) => {
    if (id === "idle") return total === 0;
    if (id === "light") return total >= 1 && total <= 2;
    if (id === "moderate") return total >= 3 && total <= 5;
    if (id === "heavy") return total >= 6;
    if (id === "has_p0") return p0 > 0;
    return false;
  });
}

function matchesMissing(
  p: Person,
  ids: TeamMissingDetailId[]
): boolean {
  if (ids.length === 0) return true;
  const founder = isFounderPersonId(p.id);
  return ids.some((id) => {
    if (founder) {
      if (id === "no_photo") return !p.profilePicturePath?.trim();
      if (id === "no_slack") return !p.slackHandle?.trim();
      return false;
    }
    if (id === "no_department") return !p.department?.trim();
    if (id === "no_role") return !p.role?.trim();
    if (id === "no_photo") return !p.profilePicturePath?.trim();
    if (id === "no_join_date") return !p.joinDate?.trim();
    if (id === "no_slack") return !p.slackHandle?.trim();
    return false;
  });
}

function matchesDepartment(p: Person, values: string[]): boolean {
  if (values.length === 0) return true;
  const d = (p.department ?? "").trim();
  const normalized = d === "" ? "" : d;
  return values.some((v) => {
    if (v === "") return normalized === "";
    return normalized === v.trim();
  });
}

function matchesEmployment(p: Person, kinds: EmploymentKind[]): boolean {
  if (kinds.length === 0) return true;
  if (isFounderPersonId(p.id)) return true;
  return kinds.includes(p.employment);
}

function matchesCompany(
  p: Person,
  companyIds: string[],
  workloadById: Map<string, PersonWorkload>
): boolean {
  if (companyIds.length === 0) return true;
  if (isFounderPersonId(p.id)) return true;
  const w = workloadById.get(p.id);
  const set = new Set(companyIds);
  return (w?.projectCompanyIds ?? []).some((cid) => set.has(cid));
}

/**
 * Apply Team roster filters. Pass `omit` to skip one dimension (faceted counts).
 */
export function applyTeamRosterFilters(
  people: Person[],
  workloadById: Map<string, PersonWorkload>,
  state: TeamRosterFilterState,
  omit?: TeamRosterFilterOmit
): Person[] {
  const search =
    omit === "search" ? "" : state.searchQuery;
  const dept =
    omit === "department" ? [] : state.departmentValues;
  const emp =
    omit === "employment" ? [] : state.employmentKinds;
  const wl =
    omit === "workload" ? [] : state.workloadIds;
  const co =
    omit === "company" ? [] : state.companyIds;
  const miss =
    omit === "missing" ? [] : state.missingDetailIds;

  return people.filter((p) => {
    if (!personMatchesTeamSearch(p, search)) return false;
    if (!matchesDepartment(p, dept)) return false;
    if (!matchesEmployment(p, emp)) return false;
    if (!matchesWorkload(workloadById.get(p.id), wl)) return false;
    if (!matchesCompany(p, co, workloadById)) return false;
    if (!matchesMissing(p, miss)) return false;
    return true;
  });
}

/** Distinct department labels for filter options: sorted named depts + empty + Founders if present. */
export function teamRosterDepartmentFilterOptions(people: Person[]): string[] {
  const set = new Set<string>();
  for (const p of people) {
    const d = p.department?.trim() ?? "";
    if (d) set.add(d);
  }
  const sorted = [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const hasEmpty = people.some((p) => !(p.department?.trim()));
  const out: string[] = [];
  if (hasEmpty) out.push("");
  out.push(...sorted);
  return out;
}

export function countByDepartmentValue(
  people: Person[],
  value: string
): number {
  return people.filter((p) => {
    const d = (p.department ?? "").trim();
    if (value === "") return d === "";
    return d === value;
  }).length;
}

export function countByEmployment(
  people: Person[],
  kind: EmploymentKind
): number {
  return people.filter(
    (p) => !isFounderPersonId(p.id) && p.employment === kind
  ).length;
}

export function countByWorkloadId(
  people: Person[],
  workloadById: Map<string, PersonWorkload>,
  id: TeamWorkloadFilterId
): number {
  return people.filter((p) =>
    matchesWorkload(workloadById.get(p.id), [id])
  ).length;
}

export function countByCompany(
  people: Person[],
  workloadById: Map<string, PersonWorkload>,
  companyId: string
): number {
  return people.filter((p) => {
    if (isFounderPersonId(p.id)) return false;
    const w = workloadById.get(p.id);
    return (w?.projectCompanyIds ?? []).includes(companyId);
  }).length;
}

export function countByMissingDetail(
  people: Person[],
  id: TeamMissingDetailId
): number {
  return people.filter((p) => matchesMissing(p, [id])).length;
}

export function isTeamRosterFilterActive(state: TeamRosterFilterState): boolean {
  return (
    normalizeTrackerSearchQuery(state.searchQuery).length > 0 ||
    state.departmentValues.length > 0 ||
    state.employmentKinds.length > 0 ||
    state.workloadIds.length > 0 ||
    state.companyIds.length > 0 ||
    state.missingDetailIds.length > 0
  );
}

export function emptyTeamRosterFilterState(): TeamRosterFilterState {
  return { ...EMPTY_STATE };
}

/** Human label for department filter value (empty = No Department). */
export function teamDepartmentFilterLabel(value: string): string {
  if (value === "") return "No Department";
  if (value === FOUNDERS_DEPARTMENT) return FOUNDERS_DEPARTMENT;
  return value;
}

export const TEAM_WORKLOAD_OPTIONS: { id: TeamWorkloadFilterId; label: string }[] =
  [
    { id: "idle", label: "Idle (0 projects)" },
    { id: "light", label: "Light (1–2)" },
    { id: "moderate", label: "Moderate (3–5)" },
    { id: "heavy", label: "Heavy (6+)" },
    { id: "has_p0", label: "Has P0 projects" },
  ];

export const TEAM_MISSING_OPTIONS: { id: TeamMissingDetailId; label: string }[] =
  [
    { id: "no_department", label: "No department" },
    { id: "no_role", label: "No role" },
    { id: "no_photo", label: "No profile photo" },
    { id: "no_join_date", label: "No join date" },
    { id: "no_slack", label: "No Slack ID" },
  ];

export const TEAM_EMPLOYMENT_OPTIONS: {
  kind: EmploymentKind;
  label: string;
}[] = [
  { kind: "inhouse_salaried", label: "In-house" },
  { kind: "inhouse_hourly", label: "In-house (hourly)" },
  { kind: "outsourced", label: "Outsourced" },
];
