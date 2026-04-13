"use client";

import { useMemo, useState } from "react";
import type { Company, CompanyDirectoryStats } from "@/lib/types/tracker";
import {
  groupCompaniesByRevenueTier,
  REVENUE_TIER_META,
} from "@/lib/companyRevenueTiers";
import {
  buildMomentumTooltip,
  momentumTierBorderClass,
  momentumTierFromScore,
} from "@/lib/companyMomentum";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { LocalImageField } from "./LocalImageField";
import { MomentumBar } from "./MomentumBar";
import {
  createCompany,
  updateCompany,
  deleteCompany,
} from "@/server/actions/tracker";
import { CompanyDescriptionGenerateExtras } from "./CompanyDescriptionGenerateExtras";
import { Building2, Plus, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWebsiteFaviconDisplay } from "@/lib/formatWebsiteDisplay";

const EMPTY_STATS: CompanyDirectoryStats = {
  goals: 0,
  projects: 0,
  owners: 0,
  activeGoals: 0,
  activeProjects: 0,
  goalsWithSpotlight: 0,
  goalsWithAtRisk: 0,
  projectsWithSpotlight: 0,
  projectsWithAtRisk: 0,
  milestonesDone: 0,
  milestonesTotal: 0,
  recentlyReviewed: 0,
  momentumScore: 0,
};

const MOMENTUM_SECTION = {
  title: "By momentum",
  mrrRange:
    "Highest composite score first (active work, spotlight, milestones, recent reviews; at-risk reduces score)",
} as const;

type CompaniesViewMode = "mrr_tier" | "momentum";

interface CompaniesManagerProps {
  initialCompanies: Company[];
  /** Per-company goals, projects, distinct owners, and momentum aggregates. */
  companyStatsByCompanyId: Record<string, CompanyDirectoryStats>;
}

function formatRevenueThousandsDisplay(value: string): string {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "$0";
  return `$${n}K`;
}

const NEW_COMPANY_DEFAULT = {
  name: "New Company",
  shortName: "NEW",
  revenue: 0,
  logoPath: "",
  developmentStartDate: "",
  launchDate: "",
  website: "",
  description: "",
} as const;

export function CompaniesManager({
  initialCompanies,
  companyStatsByCompanyId,
}: CompaniesManagerProps) {
  const companies = initialCompanies;
  const [viewMode, setViewMode] = useState<CompaniesViewMode>("mrr_tier");
  /** After adding a company, name cell opens in edit mode so the user can type immediately. */
  const [newCompanyNameFocusId, setNewCompanyNameFocusId] = useState<
    string | null
  >(null);

  async function handleAddCompany() {
    const company = await createCompany({ ...NEW_COMPANY_DEFAULT });
    setNewCompanyNameFocusId(company.id);
  }

  const tierGroups = useMemo(
    () => groupCompaniesByRevenueTier(companies),
    [companies]
  );

  const sections = useMemo(() => {
    if (viewMode === "mrr_tier") {
      return tierGroups.map(({ tierId, companies: tierCompanies }) => ({
        key: tierId,
        title: REVENUE_TIER_META[tierId].title,
        subtitle: REVENUE_TIER_META[tierId].mrrRange,
        companies: tierCompanies,
      }));
    }
    const sorted = [...companies].sort((a, b) => {
      const sa = companyStatsByCompanyId[a.id] ?? EMPTY_STATS;
      const sb = companyStatsByCompanyId[b.id] ?? EMPTY_STATS;
      const d = sb.momentumScore - sa.momentumScore;
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
    return [
      {
        key: "by-momentum",
        title: MOMENTUM_SECTION.title,
        subtitle: MOMENTUM_SECTION.mrrRange,
        companies: sorted,
      },
    ];
  }, [viewMode, companies, tierGroups, companyStatsByCompanyId]);

  const companyRowGridClass =
    "grid grid-cols-[3rem_minmax(8rem,10.5rem)_minmax(8rem,10.5rem)_minmax(11rem,1fr)_8.5rem_8.5rem_4rem_5rem_3.5rem_3.5rem_3.5rem_minmax(8rem,1fr)_minmax(2.75rem,auto)] gap-x-4 gap-y-2 items-center pl-3 pr-4 py-3 border-l-2";

  function validateWebsite(draft: string): string | undefined {
    const t = draft.trim();
    if (!t) return undefined;
    if (!/^https?:\/\//i.test(t)) {
      return "Use a full URL starting with https://";
    }
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return "Invalid URL";
      }
    } catch {
      return "Invalid URL";
    }
    return undefined;
  }

  if (companies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 px-6 py-20">
        <div className="flex items-center justify-center h-14 w-14 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 mb-5">
          <Building2 className="h-7 w-7 text-zinc-500" />
        </div>
        <h2 className="text-base font-semibold text-zinc-200 mb-1.5">No companies yet</h2>
        <p className="text-sm text-zinc-500 text-center max-w-sm mb-6">
          Companies are the building blocks of your portfolio. Add your first company to start tracking revenue, goals, and momentum.
        </p>
        <button
          type="button"
          onClick={() => void handleAddCompany()}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          <Rocket className="h-4 w-4" />
          Add your first company
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          id="companies-view-mode"
          value={viewMode}
          onChange={(e) =>
            setViewMode(e.target.value as CompaniesViewMode)
          }
          aria-label="Group companies by MRR tier or momentum"
          className={cn(
            "cursor-pointer rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200",
            "transition-colors hover:border-zinc-600 hover:text-zinc-100",
            "focus:outline-none focus:ring-2 focus:ring-zinc-500/50"
          )}
        >
          <option value="mrr_tier">Group by MRR tier</option>
          <option value="momentum">Sort by momentum</option>
        </select>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 max-w-full overflow-x-auto">
        <div
          className={`${companyRowGridClass} border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium text-zinc-500 border-l-zinc-800`}
        >
          <div className="text-left" aria-hidden="true" />
          <div className="text-left min-w-0" aria-hidden="true" />
          <div className="text-left min-w-0">Website</div>
          <div
            className="text-left min-w-0"
            title="Same pattern as goal Description on Roadmap"
          >
            Description
          </div>
          <div className="text-left">Started</div>
          <div className="text-left">Launched</div>
          <div className="text-left">Short</div>
          <div className="text-left">Revenue</div>
          <div className="text-center tabular-nums">Goals</div>
          <div className="text-center tabular-nums">Projects</div>
          <div className="text-center tabular-nums">Owners</div>
          <div className="text-left min-w-0 text-zinc-400">Momentum</div>
          <div className="text-right">
            <span className="sr-only">Actions</span>
          </div>
        </div>
        {sections.map(({ key, title, subtitle, companies: tierCompanies }) => (
          <section key={key}>
            <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80">
              <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
              <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {tierCompanies.map((company) => {
                const descriptionRaw = company.description ?? "";
                const st = companyStatsByCompanyId[company.id] ?? EMPTY_STATS;
                const hasGoals = st.goals > 0;
                const tier = momentumTierFromScore(st.momentumScore);
                const borderAccent = momentumTierBorderClass(tier);
                const momentumTip = buildMomentumTooltip(st);
                return (
                  <div
                    key={company.id}
                    className={cn(
                      `group ${companyRowGridClass}`,
                      borderAccent
                    )}
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
                        startInEditMode={
                          company.id === newCompanyNameFocusId
                        }
                      />
                    </div>
                    <div className="min-w-0 justify-self-start">
                      <InlineEditCell
                        value={company.website ?? ""}
                        onSave={(website) =>
                          updateCompany(company.id, { website })
                        }
                        placeholder="https://…"
                        formatDisplay={formatWebsiteFaviconDisplay}
                        displayClassName="min-w-0 max-w-full text-sm"
                        linkBehavior
                        validate={validateWebsite}
                        displayTruncateSingleLine
                      />
                    </div>
                    <div className="min-w-0 w-full">
                      <InlineEditCell
                        value={descriptionRaw}
                        onSave={(description) =>
                          updateCompany(company.id, { description })
                        }
                        placeholder="Add description"
                        displayClassName="text-zinc-100 font-medium"
                        displayTruncateSingleLine
                        truncateTooltipEditExtras={(extras) => (
                          <CompanyDescriptionGenerateExtras
                            ctx={extras}
                            defaultWebsiteUrl={company.website?.trim() ?? ""}
                          />
                        )}
                      />
                    </div>
                    <div className="min-w-0 w-full justify-self-stretch">
                      <InlineEditCell
                        type="date"
                        value={company.developmentStartDate ?? ""}
                        onSave={(developmentStartDate) =>
                          updateCompany(company.id, { developmentStartDate })
                        }
                        displayClassName="text-zinc-300 text-sm"
                      />
                    </div>
                    <div className="min-w-0 w-full justify-self-stretch">
                      <InlineEditCell
                        type="date"
                        value={company.launchDate ?? ""}
                        onSave={(launchDate) =>
                          updateCompany(company.id, { launchDate })
                        }
                        displayClassName="text-zinc-300 text-sm"
                      />
                    </div>
                    <div className="min-w-0 w-full justify-self-start">
                      <InlineEditCell
                        value={company.shortName}
                        onSave={(shortName) =>
                          updateCompany(company.id, { shortName })
                        }
                        displayClassName="text-zinc-400 font-mono text-sm"
                        placeholder="VD"
                      />
                    </div>
                    <div className="min-w-0 w-full justify-self-start">
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

                    <div className="flex items-center justify-center gap-1 text-zinc-300 tabular-nums text-sm min-w-0">
                      <span>{st.goals}</span>
                      {(st.goalsWithSpotlight > 0 || st.goalsWithAtRisk > 0) && (
                        <span className="flex shrink-0 gap-0.5" aria-hidden>
                          {st.goalsWithSpotlight > 0 && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                              title="At least one spotlight goal"
                            />
                          )}
                          {st.goalsWithAtRisk > 0 && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-amber-500"
                              title="At least one at-risk goal"
                            />
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-1 text-zinc-300 tabular-nums text-sm min-w-0">
                      <span>{st.projects}</span>
                      {(st.projectsWithSpotlight > 0 ||
                        st.projectsWithAtRisk > 0) && (
                        <span className="flex shrink-0 gap-0.5" aria-hidden>
                          {st.projectsWithSpotlight > 0 && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                              title="At least one spotlight project"
                            />
                          )}
                          {st.projectsWithAtRisk > 0 && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-amber-500"
                              title="At least one at-risk project"
                            />
                          )}
                        </span>
                      )}
                    </div>
                    <div className="text-center text-zinc-300 tabular-nums text-sm">
                      {st.owners}
                    </div>

                    <div className="min-w-0 w-full">
                      <MomentumBar
                        score={st.momentumScore}
                        tooltip={momentumTip}
                      />
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
        ))}
      </div>

      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => void handleAddCompany()}
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add company
        </button>
      </div>
    </div>
  );
}
