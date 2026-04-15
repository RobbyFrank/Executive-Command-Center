import {
  getCompanies,
  getPeople,
  getPersonWorkloads,
} from "@/server/actions/tracker";
import { TeamRosterManager } from "@/components/tracker/TeamRosterManager";

export default async function TeamPage() {
  const [people, companies, workloads] = await Promise.all([
    getPeople(),
    getCompanies(),
    getPersonWorkloads(),
  ]);

  return (
    <div className="-mx-6 -mb-6 min-h-0 min-w-0">
      <TeamRosterManager
        initialPeople={people}
        companies={companies}
        workloads={workloads}
      />
    </div>
  );
}
