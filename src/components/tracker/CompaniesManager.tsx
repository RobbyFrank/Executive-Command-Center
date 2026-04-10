"use client";

import { useMemo } from "react";
import type { Company, CompanyDirectoryStats } from "@/lib/types/tracker";
import {
  groupCompaniesByRevenueTier,
  REVENUE_TIER_META,
} from "@/lib/companyRevenueTiers";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { LocalImageField } from "./LocalImageField";
import { createCompany, updateCompany, deleteCompany } from "@/server/actions/tracker";
import { Plus } from "lucide-react";

const EMPTY_STATS: CompanyDirectoryStats = {
  goals: 0,
  projects: 0,
  owners: 0,
};

interface CompaniesManagerProps {
  initialCompanies: Company[];
  /** Per-company goals, projects, and distinct owner counts. */
  companyStatsByCompanyId: Record<string, CompanyDirectoryStats>;
}

function formatRevenueThousandsDisplay(value: string): string {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "$0";
  return `$${n}K`;
}

export function CompaniesManager({
  initialCompanies,
  companyStatsByCompanyId,
}: CompaniesManagerProps) {
  const companies = initialCompanies;
  const tierGroups = useMemo(
    () => groupCompaniesByRevenueTier(companies),
    [companies]
  );

  const companyRowGridClass =
    "grid grid-cols-[3rem_minmax(0,1fr)_7.25rem_7.25rem_4rem_4.25rem_3rem_3rem_3rem_auto] gap-x-3 gap-y-2 items-center px-4 py-3";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 max-w-full overflow-x-auto">
        <div
          className={`${companyRowGridClass} border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium text-zinc-500`}
        >
          <div className="text-left">Logo</div>
          <div className="text-left min-w-0">Company</div>
          <div className="text-left">Started</div>
          <div className="text-left">Launched</div>
          <div className="text-left">Short</div>
          <div className="text-left">Revenue</div>
          <div className="text-right tabular-nums">Goals</div>
          <div className="text-right tabular-nums">Projects</div>
          <div className="text-right tabular-nums">Owners</div>
          <div className="text-right">
            <span className="sr-only">Actions</span>
          </div>
        </div>
        {tierGroups.map(({ tierId, companies: tierCompanies }) => {
          const meta = REVENUE_TIER_META[tierId];
          return (
            <section key={tierId}>
              <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80">
                <h2 className="text-sm font-semibold text-zinc-200">
                  {meta.title}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">{meta.mrrRange}</p>
              </div>
              <div className="divide-y divide-zinc-800">
                {tierCompanies.map((company) => {
                  const st = companyStatsByCompanyId[company.id] ?? EMPTY_STATS;
                  const hasGoals = st.goals > 0;
                  return (
                  <div
                    key={company.id}
                    className={`group ${companyRowGridClass}`}
                  >
                    <div className="shrink-0">
                      <LocalImageField
                        variant="company"
                        entityId={company.id}
                        path={company.logoPath ?? ""}
                      />
                    </div>

                    <div className="min-w-0">
                      <InlineEditCell
                        value={company.name}
                        onSave={(name) => updateCompany(company.id, { name })}
                        displayClassName="font-medium text-zinc-100"
                      />
                    </div>
                    <div className="w-[7.25rem] shrink-0 justify-self-start">
                      <InlineEditCell
                        type="date"
                        value={company.developmentStartDate ?? ""}
                        onSave={(developmentStartDate) =>
                          updateCompany(company.id, { developmentStartDate })
                        }
                        displayClassName="text-zinc-300 text-sm"
                        emptyLabel="Set date"
                      />
                    </div>
                    <div className="w-[7.25rem] shrink-0 justify-self-start">
                      <InlineEditCell
                        type="date"
                        value={company.launchDate ?? ""}
                        onSave={(launchDate) =>
                          updateCompany(company.id, { launchDate })
                        }
                        displayClassName="text-zinc-300 text-sm"
                        emptyLabel="Set date"
                      />
                    </div>
                    <div className="w-14 shrink-0 sm:w-16 justify-self-start">
                      <InlineEditCell
                        value={company.shortName}
                        onSave={(shortName) =>
                          updateCompany(company.id, { shortName })
                        }
                        displayClassName="text-zinc-400 font-mono text-sm"
                        placeholder="VD"
                      />
                    </div>
                    <div className="w-[4.25rem] shrink-0 justify-self-start">
                      <InlineEditCell
                        type="number"
                        min={0}
                        max={999}
                        step={1}
                        value={String(company.revenue)}
                        onSave={(s) => {
                          const n = parseInt(s, 10);
                          const revenue = Number.isFinite(n)
                            ? Math.min(999, Math.max(0, n))
                            : 0;
                          updateCompany(company.id, { revenue });
                        }}
                        formatDisplay={formatRevenueThousandsDisplay}
                        displayClassName="text-zinc-300 tabular-nums text-sm"
                        placeholder="0"
                      />
                    </div>

                    <div className="text-right text-zinc-300 tabular-nums text-sm">
                      {st.goals}
                    </div>
                    <div className="text-right text-zinc-300 tabular-nums text-sm">
                      {st.projects}
                    </div>
                    <div className="text-right text-zinc-300 tabular-nums text-sm">
                      {st.owners}
                    </div>

                    <div className="justify-self-end">
                      <ConfirmDeletePopover
                        entityName={company.name}
                        disabled={hasGoals}
                        disabledReason={
                          hasGoals
                            ? `This company has ${st.goals} goal${st.goals === 1 ? "" : "s"}. Delete or move those goals first.`
                            : undefined
                        }
                        onConfirm={() => deleteCompany(company.id)}
                      />
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() =>
          createCompany({
            name: "New Company",
            shortName: "NEW",
            revenue: 0,
            logoPath: "",
            developmentStartDate: "",
            launchDate: "",
          })
        }
        className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-600 hover:text-zinc-400 transition-colors w-full border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
      >
        <Plus className="h-4 w-4" />
        Add company
      </button>
    </div>
  );
}
