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
    <div className="pt-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Team</h1>
      </div>

      <TeamRosterManager
        initialPeople={people}
        companies={companies}
        workloads={workloads}
      />
    </div>
  );
}
