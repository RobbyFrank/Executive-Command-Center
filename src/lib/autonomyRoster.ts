import type { Person } from "@/lib/types/tracker";

/** Highest autonomy first (5 → 1), matching “strongest signal at top”. */
export const AUTONOMY_LEVEL_ORDER_DESC = [5, 4, 3, 2, 1] as const;

export type AutonomyLevel = (typeof AUTONOMY_LEVEL_ORDER_DESC)[number];

function clampAutonomy(n: number): AutonomyLevel {
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

/** Shown at the top of Team; stable person ids from data. */
const FOUNDER_PERSON_IDS = new Set(["robby", "nadav"]);
const FOUNDER_ORDER = ["robby", "nadav"] as const;

/** Reserved department label for founders only (not assignable to others). */
export const FOUNDERS_DEPARTMENT = "Founders";

export function isFounderPersonId(personId: string): boolean {
  return FOUNDER_PERSON_IDS.has(personId);
}

/**
 * Founders always have `FOUNDERS_DEPARTMENT`; no one else may use that label.
 * Call on read and after merging person updates before persist.
 */
export function withFounderDepartmentRules(person: Person): Person {
  if (isFounderPersonId(person.id)) {
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

export type TeamRosterDisplayGroup =
  | { kind: "founders"; people: Person[] }
  | { kind: "autonomy"; level: AutonomyLevel; people: Person[] };

function sortFounders(a: Person, b: Person): number {
  const ia = FOUNDER_ORDER.indexOf(a.id as (typeof FOUNDER_ORDER)[number]);
  const ib = FOUNDER_ORDER.indexOf(b.id as (typeof FOUNDER_ORDER)[number]);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return sortPeopleByName(a, b);
}

/** Founders (fixed ids) first, then everyone else grouped by autonomy. */
export function buildTeamRosterDisplayGroups(
  people: Person[]
): TeamRosterDisplayGroup[] {
  const founders: Person[] = [];
  const rest: Person[] = [];
  for (const p of people) {
    if (FOUNDER_PERSON_IDS.has(p.id)) founders.push(p);
    else rest.push(p);
  }
  founders.sort(sortFounders);

  const out: TeamRosterDisplayGroup[] = [];
  if (founders.length > 0) {
    out.push({ kind: "founders", people: founders });
  }
  for (const g of groupPeopleByAutonomy(rest)) {
    out.push({ kind: "autonomy", level: g.level, people: g.people });
  }
  return out;
}

/** Same person order as Team: founders first, then autonomy 5 → 1, name within each section. */
export function sortPeopleLikeTeamRoster(people: Person[]): Person[] {
  return buildTeamRosterDisplayGroups(people).flatMap((g) => g.people);
}
