import type { Person } from "@/lib/types/tracker";
import {
  FOUNDERS_DEPARTMENT,
  isFounderPerson,
} from "@/lib/autonomyRoster";

/**
 * Baseline labels for the roster department dropdown, merged with every distinct
 * non-empty `department` on the team so the list grows as you add new labels
 * on any member.
 */
const DEPARTMENT_CATALOG: readonly string[] = [
  "Sales",
  "Marketing",
  "Development",
  "Operations",
  "Product",
];

/**
 * Options for `InlineEditCell` `type="select"`: None, then sorted union of
 * catalog + departments in use + current value (if set).
 */
export function departmentSelectOptions(
  people: Person[],
  currentDepartment: string,
  forPersonId: string
): { value: string; label: string }[] {
  const set = new Set<string>(DEPARTMENT_CATALOG);
  for (const p of people) {
    const d = p.department?.trim();
    if (!d) continue;
    if (d === FOUNDERS_DEPARTMENT && !isFounderPerson(p)) continue;
    set.add(d);
  }
  const cur = currentDepartment.trim();
  if (cur) {
    if (cur === FOUNDERS_DEPARTMENT) {
      const who = people.find((x) => x.id === forPersonId);
      if (who && isFounderPerson(who)) set.add(cur);
    } else {
      set.add(cur);
    }
  }
  const sorted = [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const options = [
    { value: "", label: "No Department" },
    ...sorted.map((d) => ({ value: d, label: d })),
  ];
  const who = people.find((x) => x.id === forPersonId);
  const forTargetIsFounder = who ? isFounderPerson(who) : false;
  return options.filter(
    (o) =>
      o.value === "" ||
      o.value !== FOUNDERS_DEPARTMENT ||
      forTargetIsFounder
  );
}
