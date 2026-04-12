import type { Person, PersonWorkload } from "@/lib/types/tracker";

/** Highest autonomy first (5 → 1), matching “strongest signal at top”. */
export const AUTONOMY_LEVEL_ORDER_DESC = [5, 4, 3, 2, 1] as const;

export type AutonomyLevel = (typeof AUTONOMY_LEVEL_ORDER_DESC)[number];

/** Clamp stored score to 1–5 (used for roster grouping and owner filter). */
export function clampAutonomy(n: number): AutonomyLevel {
  const r = Math.round(Number(n));
  if (r >= 5) return 5;
  if (r <= 1) return 1;
  return r as AutonomyLevel;
}

function sortPeopleByName(a: Person, b: Person): number {
  return a.name.localeCompare(b.name);
}

/** Neutral section chrome — autonomy level is in the label, not rainbow row paint. */
const AUTONOMY_SECTION_HEADER =
  "border-b border-zinc-800 bg-zinc-900/60";
const AUTONOMY_SECTION_ROW = "hover:bg-zinc-800/35";

export const AUTONOMY_GROUP_VISUAL: Record<
  AutonomyLevel,
  { header: string; dataRow: string }
> = {
  5: { header: AUTONOMY_SECTION_HEADER, dataRow: AUTONOMY_SECTION_ROW },
  4: { header: AUTONOMY_SECTION_HEADER, dataRow: AUTONOMY_SECTION_ROW },
  3: { header: AUTONOMY_SECTION_HEADER, dataRow: AUTONOMY_SECTION_ROW },
  2: { header: AUTONOMY_SECTION_HEADER, dataRow: AUTONOMY_SECTION_ROW },
  1: { header: AUTONOMY_SECTION_HEADER, dataRow: AUTONOMY_SECTION_ROW },
};

export const AUTONOMY_GROUP_LABEL: Record<
  AutonomyLevel,
  { title: string; hint: string }
> = {
  5: {
    title: "5. Full ownership — sets direction and executes",
    hint: "",
  },
  4: {
    title: "4. High ownership — owns major workstreams with light steering",
    hint: "",
  },
  3: {
    title: "3. Balanced — executes with periodic alignment",
    hint: "",
  },
  2: {
    title: "2. Guided — needs clearer priorities and check-ins",
    hint: "",
  },
  1: {
    title: "1. Directed — close coordination and task-level clarity",
    hint: "",
  },
};

/** Team roster autonomy `<select>` option text (5 = highest). */
export const AUTONOMY_LEVEL_SELECT_LABEL: Record<AutonomyLevel, string> = {
  5: "5. Full ownership",
  4: "4. High ownership",
  3: "3. Balanced",
  2: "2. Guided",
  1: "1. Directed",
};

export const AUTONOMY_LEVEL_SELECT_OPTIONS: { value: string; label: string }[] =
  AUTONOMY_LEVEL_ORDER_DESC.map((level) => ({
    value: String(level),
    label: AUTONOMY_LEVEL_SELECT_LABEL[level],
  }));

/**
 * Name only (no leading "5." — level is shown on the autonomy filter icon).
 * Drops the clause after the em dash.
 */
export function autonomyShortTitle(level: AutonomyLevel): string {
  const full = AUTONOMY_GROUP_LABEL[level].title;
  const cut = full.indexOf(" — ");
  const head = cut === -1 ? full : full.slice(0, cut);
  return head.replace(/^\d+\.\s*/, "").trim();
}

export function groupPeopleByAutonomy(
  people: Person[]
): { level: AutonomyLevel; people: Person[] }[] {
  const buckets = new Map<AutonomyLevel, Person[]>();
  for (const level of AUTONOMY_LEVEL_ORDER_DESC) {
    buckets.set(level, []);
  }
  for (const p of people) {
    const level = clampAutonomy(p.autonomyScore);
    buckets.get(level)!.push(p);
  }
  for (const level of AUTONOMY_LEVEL_ORDER_DESC) {
    buckets.get(level)!.sort(sortPeopleByName);
  }
  return AUTONOMY_LEVEL_ORDER_DESC.map((level) => ({
    level,
    people: buckets.get(level)!,
  })).filter((g) => g.people.length > 0);
}

/**
 * Historical default founders when `Person.isFounder` is omitted. Explicit
 * `isFounder: false` on these ids opts out.
 */
const LEGACY_FOUNDER_IDS = new Set(["robby", "nadav"]);
const LEGACY_FOUNDER_ORDER = ["robby", "nadav"] as const;

/** Reserved department label for founders only (not assignable to others). */
export const FOUNDERS_DEPARTMENT = "Founders";

/**
 * Founders are marked in data (`isFounder`) or match legacy ids when the flag
 * is unset. Explicit `isFounder: false` overrides legacy ids.
 */
export function isFounderPerson(person: Person): boolean {
  if (person.isFounder === false) return false;
  if (person.isFounder === true) return true;
  return LEGACY_FOUNDER_IDS.has(person.id);
}

/**
 * Goal DRI on Roadmap: founders, or non-founders with autonomy 4 or 5 only.
 */
export function isGoalDriEligiblePerson(person: Person): boolean {
  if (isFounderPerson(person)) return true;
  const a = clampAutonomy(person.autonomyScore);
  return a === 5 || a === 4;
}

/**
 * Founders always have `FOUNDERS_DEPARTMENT`; no one else may use that label.
 * Call on read and after merging person updates before persist.
 */
export function withFounderDepartmentRules(person: Person): Person {
  if (isFounderPerson(person)) {
    return { ...person, department: FOUNDERS_DEPARTMENT };
  }
  if (person.department?.trim() === FOUNDERS_DEPARTMENT) {
    return { ...person, department: "" };
  }
  return person;
}

export const FOUNDER_GROUP_VISUAL: {
  header: string;
  dataRow: string;
} = {
  header: AUTONOMY_SECTION_HEADER,
  dataRow: AUTONOMY_SECTION_ROW,
};

export const FOUNDER_GROUP_LABEL = {
  title: "Founders",
  hint: "",
} as const;

/** Groups used for owner picker and default Team ordering (autonomy sections). */
export type TeamRosterAutonomyGroup =
  | { kind: "founders"; people: Person[] }
  | { kind: "autonomy"; level: AutonomyLevel; people: Person[] };

export type TeamRosterDisplayGroup =
  | TeamRosterAutonomyGroup
  | { kind: "department"; departmentKey: string; people: Person[] }
  | { kind: "workload"; tier: WorkloadSortTier; people: Person[] };

/** Team table: how rows are grouped under section headers. */
export type TeamRosterSortMode = "autonomy" | "department" | "workload";

/** Exclusive workload bands (project count), same tiers as Team workload filters. */
export const TEAM_ROSTER_WORKLOAD_SORT_ORDER = [
  "idle",
  "light",
  "moderate",
  "heavy",
] as const;

export type WorkloadSortTier =
  (typeof TEAM_ROSTER_WORKLOAD_SORT_ORDER)[number];

/** Section order when grouping Team by workload: high → low load. */
export const TEAM_ROSTER_WORKLOAD_DISPLAY_ORDER: readonly WorkloadSortTier[] =
  ["heavy", "moderate", "light", "idle"];

export const TEAM_ROSTER_WORKLOAD_SORT_LABEL: Record<
  WorkloadSortTier,
  string
> = {
  idle: "Idle (0 projects)",
  light: "Light (1–2)",
  moderate: "Moderate (3–5)",
  heavy: "Heavy (6+)",
};

/** Section headers when grouping Team by workload (title + clarifying subtitle). */
export const TEAM_ROSTER_WORKLOAD_HEADER: Record<
  WorkloadSortTier,
  { title: string; subtitle: string }
> = {
  heavy: {
    title: "Heavy workload",
    subtitle: "6 or more owned projects",
  },
  moderate: {
    title: "Moderate workload",
    subtitle: "3–5 owned projects",
  },
  light: {
    title: "Light workload",
    subtitle: "1–2 owned projects",
  },
  idle: {
    title: "Idle",
    subtitle: "No owned projects",
  },
};

function sortFounders(a: Person, b: Person): number {
  const ia = LEGACY_FOUNDER_ORDER.indexOf(
    a.id as (typeof LEGACY_FOUNDER_ORDER)[number]
  );
  const ib = LEGACY_FOUNDER_ORDER.indexOf(
    b.id as (typeof LEGACY_FOUNDER_ORDER)[number]
  );
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return sortPeopleByName(a, b);
}

/** Founders first, then everyone else grouped by autonomy. */
export function buildTeamRosterDisplayGroups(
  people: Person[]
): TeamRosterAutonomyGroup[] {
  const founders: Person[] = [];
  const rest: Person[] = [];
  for (const p of people) {
    if (isFounderPerson(p)) founders.push(p);
    else rest.push(p);
  }
  founders.sort(sortFounders);

  const out: TeamRosterAutonomyGroup[] = [];
  if (founders.length > 0) {
    out.push({ kind: "founders", people: founders });
  }
  for (const g of groupPeopleByAutonomy(rest)) {
    out.push({ kind: "autonomy", level: g.level, people: g.people });
  }
  return out;
}

function workloadTierFromTotals(totalProjects: number): WorkloadSortTier {
  const t = totalProjects;
  if (t === 0) return "idle";
  if (t <= 2) return "light";
  if (t <= 5) return "moderate";
  return "heavy";
}

/**
 * Group Team roster rows: founders first when sorting by autonomy or department;
 * when sorting by workload, everyone (including founders) is grouped only by
 * workload tier.
 * `workloadByPersonId` is required when `mode === "workload"`.
 */
export function buildTeamRosterGroups(
  people: Person[],
  mode: TeamRosterSortMode,
  workloadByPersonId: Map<string, PersonWorkload>
): TeamRosterDisplayGroup[] {
  if (mode === "autonomy") {
    return buildTeamRosterDisplayGroups(people);
  }

  if (mode === "workload") {
    const buckets = new Map<WorkloadSortTier, Person[]>();
    for (const tier of TEAM_ROSTER_WORKLOAD_SORT_ORDER) {
      buckets.set(tier, []);
    }
    for (const p of people) {
      const w = workloadByPersonId.get(p.id);
      const total = w?.totalProjects ?? 0;
      const tier = workloadTierFromTotals(total);
      buckets.get(tier)!.push(p);
    }
    for (const tier of TEAM_ROSTER_WORKLOAD_SORT_ORDER) {
      buckets.get(tier)!.sort(sortPeopleByName);
    }
    const out: TeamRosterDisplayGroup[] = [];
    for (const tier of TEAM_ROSTER_WORKLOAD_DISPLAY_ORDER) {
      const groupPeople = buckets.get(tier)!;
      if (groupPeople.length === 0) continue;
      out.push({ kind: "workload", tier, people: groupPeople });
    }
    return out;
  }

  const founders: Person[] = [];
  const rest: Person[] = [];
  for (const p of people) {
    if (isFounderPerson(p)) founders.push(p);
    else rest.push(p);
  }
  founders.sort(sortFounders);

  const out: TeamRosterDisplayGroup[] = [];
  if (founders.length > 0) {
    out.push({ kind: "founders", people: founders });
  }

  const byDept = new Map<string, Person[]>();
  for (const p of rest) {
    const key = (p.department ?? "").trim();
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key)!.push(p);
  }
  for (const arr of byDept.values()) {
    arr.sort(sortPeopleByName);
  }
  const keys = [...byDept.keys()].sort((a, b) => {
    if (a === "" && b !== "") return -1;
    if (b === "" && a !== "") return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  for (const key of keys) {
    const groupPeople = byDept.get(key)!;
    if (groupPeople.length === 0) continue;
    out.push({ kind: "department", departmentKey: key, people: groupPeople });
  }
  return out;
}

/** Same person order as Team: founders first, then autonomy 5 → 1, name within each section. */
export function sortPeopleLikeTeamRoster(people: Person[]): Person[] {
  return buildTeamRosterDisplayGroups(people).flatMap((g) => g.people);
}
