import {
  getCachedCompanies,
  getCachedCompanyStatsByCompanyId,
} from "@/server/tracker-page-data";
import { CompaniesManager } from "@/components/tracker/CompaniesManager";

export default async function CompaniesPage() {
  const [companies, companyStatsByCompanyId] = await Promise.all([
    getCachedCompanies(),
    getCachedCompanyStatsByCompanyId(),
  ]);

  return (
    <div className="-mx-6 -mb-6 min-h-0 min-w-0">
      <CompaniesManager
        initialCompanies={companies}
        companyStatsByCompanyId={companyStatsByCompanyId}
      />
    </div>
  );
}
