import {
  getHierarchy,
  getPeople,
  getPersonWorkloads,
  getCompanyStatsByCompanyId,
} from "@/server/actions/tracker";
import { SummaryDashboard } from "@/components/tracker/SummaryDashboard";

export default async function SummaryPage() {
  const [hierarchy, people, workloads, companyStatsByCompanyId] =
    await Promise.all([
      getHierarchy(),
      getPeople(),
      getPersonWorkloads(),
      getCompanyStatsByCompanyId(),
    ]);

  return (
    <div className="-mx-6 -mb-6 min-h-0">
      <SummaryDashboard
        hierarchy={hierarchy}
        people={people}
        workloads={workloads}
        companyStatsByCompanyId={companyStatsByCompanyId}
      />
    </div>
  );
}
