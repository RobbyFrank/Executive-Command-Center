import type { Person, Project } from "@/lib/types/tracker";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

const NEW_HIRE_WINDOW_DAYS = 30;

/** True when joinDate is set and within the last NEW_HIRE_WINDOW_DAYS calendar days. */
export function isNewHire(person: Person, todayYmd: string): boolean {
  const jd = person.joinDate?.trim();
  if (!jd) return false;
  const days = daysBetweenYmd(jd, todayYmd);
  if (days === null) return false;
  return days >= 0 && days <= NEW_HIRE_WINDOW_DAYS;
}

/** Days since join (0 = joined today). Null if joinDate missing or invalid. */
export function daysSinceJoined(
  person: Person,
  todayYmd: string
): number | null {
  const jd = person.joinDate?.trim();
  if (!jd) return null;
  return daysBetweenYmd(jd, todayYmd);
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = parseCalendarDateString(fromYmd);
  const b = parseCalendarDateString(toYmd);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Pilot projects for this person: owner or assignee, created on or after join date.
 */
export function findPilotProjectsFor(
  person: Person,
  projects: Project[]
): Project[] {
  const join = person.joinDate?.trim();
  if (!join) return [];
  return projects.filter((p) => {
    const created = (p.createdAt ?? "").trim();
    if (created && created < join) return false;
    const isOwner = p.ownerId === person.id;
    const isAssignee = (p.assigneeIds ?? []).includes(person.id);
    return isOwner || isAssignee;
  });
}

/**
 * True when someone on the project is still a new hire (≤30 days since join) and the project
 * was created within 30 days after their join date.
 */
export function isPilotProject(
  project: Project,
  people: Person[],
  todayYmd: string
): boolean {
  const byId = new Map(people.map((p) => [p.id, p]));
  const candidates: Person[] = [];
  const owner = project.ownerId ? byId.get(project.ownerId) : undefined;
  if (owner) candidates.push(owner);
  for (const aid of project.assigneeIds ?? []) {
    const a = byId.get(aid);
    if (a) candidates.push(a);
  }
  const created = (project.createdAt ?? "").trim();
  for (const p of candidates) {
    if (!isNewHire(p, todayYmd)) continue;
    const jd = p.joinDate?.trim();
    if (!jd || !created) continue;
    const daysFromJoinToCreate = daysBetweenYmd(jd, created);
    if (
      daysFromJoinToCreate !== null &&
      daysFromJoinToCreate >= 0 &&
      daysFromJoinToCreate <= NEW_HIRE_WINDOW_DAYS
    ) {
      return true;
    }
  }
  return false;
}

/** New hires with no pilot project assigned (owner or assignee on a post-join project). */
export function countUnattendedNewHires(
  people: Person[],
  projects: Project[],
  todayYmd: string
): number {
  return people.filter((p) => {
    if (!isNewHire(p, todayYmd)) return false;
    return findPilotProjectsFor(p, projects).length === 0;
  }).length;
}

/**
 * Lines for the executive digest prompt: new hires without a pilot project, or just joined.
 */
export function buildOnboardingSignalLines(
  people: Person[],
  projects: Project[],
  todayYmd: string
): string[] {
  const lines: string[] = [];
  for (const p of people) {
    if (!isNewHire(p, todayYmd)) continue;
    if (findPilotProjectsFor(p, projects).length > 0) continue;
    const days = daysSinceJoined(p, todayYmd);
    if (days === null) continue;
    const role = (p.role ?? "").trim() || "role TBD";
    if (days >= 2) {
      lines.push(
        `New hire: ${p.name} (${role}) joined ${days} days ago - no pilot project assigned yet.`
      );
    } else {
      lines.push(
        `New hire: ${p.name} (${role}) - pilot project not assigned yet (joined ${days === 0 ? "today" : "yesterday"}).`
      );
    }
  }
  return lines;
}

/** First pilot person on the project for tooltip (prefers owner if new hire). */
export function pilotNewHirePerson(
  project: Project,
  people: Person[],
  todayYmd: string
): Person | null {
  const byId = new Map(people.map((p) => [p.id, p]));
  const owner = project.ownerId ? byId.get(project.ownerId) : undefined;
  if (owner && isNewHire(owner, todayYmd)) return owner;
  for (const aid of project.assigneeIds ?? []) {
    const a = byId.get(aid);
    if (a && isNewHire(a, todayYmd)) return a;
  }
  return null;
}
