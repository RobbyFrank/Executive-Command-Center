import {
  getCompanies,
  getCompanyStatsByCompanyId,
} from "@/server/actions/tracker";
import { CompaniesManager } from "@/components/tracker/CompaniesManager";

export default async function CompaniesPage() {
  const [companies, companyStatsByCompanyId] = await Promise.all([
    getCompanies(),
    getCompanyStatsByCompanyId(),
  ]);

  return (
    <div className="pt-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Companies</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage company names, website, description, logos, development and
          launch dates, and adding or removing companies. Momentum reflects
          active goals and projects, spotlight and at-risk signals, milestones,
          and recent reviews.
        </p>
      </div>

      <CompaniesManager
        initialCompanies={companies}
        companyStatsByCompanyId={companyStatsByCompanyId}
      />
    </div>
  );
}
