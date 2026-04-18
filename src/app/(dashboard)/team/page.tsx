import {
  getCachedCompanies,
  getCachedPeople,
  getCachedPersonWorkloads,
} from "@/server/tracker-page-data";
import { TeamRosterManager } from "@/components/tracker/TeamRosterManager";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";
import { isFounderPerson } from "@/lib/autonomyRoster";

export default async function TeamPage() {
  const [people, companies, workloads, session] = await Promise.all([
    getCachedPeople(),
    getCachedCompanies(),
    getCachedPersonWorkloads(),
    getSession(),
  ]);

  let canManageLoginPasswords = false;
  if (session) {
    const me = await getRepository().getPerson(session.personId);
    canManageLoginPasswords = Boolean(me && isFounderPerson(me));
  }

  return (
    <div className="-mx-6 -mb-6 min-h-0 min-w-0">
      <TeamRosterManager
        initialPeople={people}
        companies={companies}
        workloads={workloads}
        canManageLoginPasswords={canManageLoginPasswords}
      />
    </div>
  );
}
