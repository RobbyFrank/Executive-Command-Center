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
    <TeamRosterManager
      initialPeople={people}
      companies={companies}
      workloads={workloads}
    />
  );
}
