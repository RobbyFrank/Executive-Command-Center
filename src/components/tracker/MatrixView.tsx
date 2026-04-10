"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { CompanyWithGoals, Person, ProjectWithMilestones } from "@/lib/types/tracker";
import { CompanyFilterMultiSelect } from "./CompanyFilterMultiSelect";
import { OwnerFilterMultiSelect } from "./OwnerFilterMultiSelect";
import { PriorityBadge } from "./PriorityBadge";
import {
  filterTrackerHierarchyByCompanyIds,
  filterTrackerHierarchyByOwner,
} from "@/lib/tracker-search-filter";
import { groupCompaniesByRevenueTier } from "@/lib/companyRevenueTiers";
import { sortPeopleLikeTeamRoster } from "@/lib/autonomyRoster";
import {
  complexityBand,
  impactBand,
  IMPACT_ROW_LABELS,
  COMPLEXITY_COL_LABELS,
  matrixCellToneClasses,
  MATRIX_QUADRANT_LABELS,
} from "@/lib/matrix-bands";
import { cn } from "@/lib/utils";
import { Building2 } from "lucide-react";
import { firstNameFromFullName } from "@/lib/personDisplayName";

export interface MatrixProjectCell {
  project: ProjectWithMilestones;
  goalId: string;
  goalDescription: string;
  impactScore: number;
  companyId: string;
  companyName: string;
  companyLogoPath: string;
}

function collectProjects(
  hierarchy: CompanyWithGoals[]
): MatrixProjectCell[] {
  const out: MatrixProjectCell[] = [];
  for (const c of hierarchy) {
    for (const g of c.goals) {
      for (const p of g.projects) {
        out.push({
          project: p,
          goalId: g.id,
          goalDescription: g.description,
          impactScore: g.impactScore,
          companyId: c.id,
          companyName: c.name,
          companyLogoPath: c.logoPath ?? "",
        });
      }
    }
  }
  return out;
}

interface MatrixViewProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
}

export function MatrixView({ hierarchy, people }: MatrixViewProps) {
  const [companyFilterIds, setCompanyFilterIds] = useState<string[]>([]);
  const [ownerFilterIds, setOwnerFilterIds] = useState<string[]>([]);

  const peopleSorted = useMemo(
    () => sortPeopleLikeTeamRoster(people),
    [people]
  );

  const companiesForFilter = useMemo(
    () =>
      groupCompaniesByRevenueTier(hierarchy)
        .flatMap((g) => g.companies)
        .map((c) => ({
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          logoPath: c.logoPath,
          revenue: c.revenue,
        })),
    [hierarchy]
  );

  const hierarchyFiltered = useMemo(() => {
    let h = hierarchy;
    h = filterTrackerHierarchyByCompanyIds(
      h,
      companyFilterIds.length > 0 ? companyFilterIds : null
    );
    h = filterTrackerHierarchyByOwner(
      h,
      ownerFilterIds.length > 0 ? ownerFilterIds : null,
      people
    );
    return h;
  }, [hierarchy, companyFilterIds, ownerFilterIds, people]);

  const cells = useMemo(
    () => collectProjects(hierarchyFiltered),
    [hierarchyFiltered]
  );

  const grid = useMemo(() => {
    const g: MatrixProjectCell[][][] = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => [] as MatrixProjectCell[])
    );
    for (const item of cells) {
      const ri = impactBand(item.impactScore);
      const ci = complexityBand(item.project.complexityScore);
      g[ri][ci].push(item);
    }
    return g;
  }, [cells]);

  const roadmapLink = useCallback((goalId: string, projectId: string) => {
    const q = new URLSearchParams({
      focusGoal: goalId,
      focusProject: projectId,
    });
    return `/?${q.toString()}`;
  }, []);

  return (
    <div className="px-6 pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Impact × Complexity</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Projects positioned by goal impact (rows) and project complexity (columns).
          Top-left is highest leverage; bottom-right is cut-or-defer territory.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 max-w-3xl">
          <div className="min-w-0 flex-1 sm:max-w-[20rem]">
            <CompanyFilterMultiSelect
              companies={companiesForFilter}
              selectedIds={companyFilterIds}
              onChange={setCompanyFilterIds}
            />
          </div>
          <div className="min-w-0 flex-1 sm:max-w-[20rem]">
            <OwnerFilterMultiSelect
              people={peopleSorted}
              selectedIds={ownerFilterIds}
              onChange={setOwnerFilterIds}
            />
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-x-1 gap-y-1 min-w-[720px]"
          style={{
            gridTemplateColumns: "auto auto repeat(3, minmax(0, 1fr))",
            gridTemplateRows: "auto auto repeat(3, minmax(120px, auto))",
          }}
        >
          {/* Top-left corner over Y-axis + row-label columns */}
          <div
            className="min-w-0"
            style={{ gridColumn: "1 / 3", gridRow: "1 / 3" }}
          />
          <div
            className="flex flex-col items-center justify-end gap-0.5 px-1 pb-1 text-center"
            style={{ gridColumn: "3 / 6", gridRow: 1 }}
          >
            <span className="text-xs font-semibold text-zinc-400">
              Project complexity
            </span>
            <span className="text-[10px] font-medium text-zinc-500">
              ← lower · higher →
            </span>
          </div>
          {COMPLEXITY_COL_LABELS.map((label, ci) => (
            <div
              key={label}
              className="text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500 px-1 pb-2"
              style={{ gridColumn: 3 + ci, gridRow: 2 }}
            >
              {label}
            </div>
          ))}

          <div
            className="flex h-full min-h-0 flex-col items-center justify-between gap-1 py-2 pr-1"
            style={{ gridColumn: 1, gridRow: "3 / 6" }}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              High
            </span>
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 [writing-mode:vertical-rl] rotate-180">
              Goal impact
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Low
            </span>
          </div>

          {IMPACT_ROW_LABELS.map((rowLabel, ri) => (
            <Fragment key={rowLabel}>
              <div
                className="flex items-start justify-end pr-2 pt-2 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 max-w-[7rem]"
                style={{ gridColumn: 2, gridRow: 3 + ri }}
              >
                {rowLabel}
              </div>
              {[0, 1, 2].map((ci) => {
                const bucket = grid[ri][ci];
                const quadrantClass = matrixCellToneClasses(
                  ri as 0 | 1 | 2,
                  ci as 0 | 1 | 2
                );
                const quadrantLabel = MATRIX_QUADRANT_LABELS[ri][ci];
                return (
                  <div
                    key={`c-${ri}-${ci}`}
                    style={{ gridColumn: 3 + ci, gridRow: 3 + ri }}
                    className={cn(
                      "relative rounded-lg border p-2 min-h-[120px] flex flex-col",
                      quadrantClass
                    )}
                  >
                    <div className="pointer-events-none absolute left-2 right-2 top-2 flex items-start justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500/70 leading-tight max-w-[70%]">
                        {quadrantLabel}
                      </span>
                      {bucket.length > 0 ? (
                        <span className="shrink-0 rounded bg-zinc-950/45 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-400">
                          {bucket.length}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-7 flex min-h-0 flex-1 flex-col gap-1.5">
                      {bucket.length === 0 ? (
                        <p className="flex flex-1 items-center justify-center py-4 text-center text-xs italic text-zinc-600">
                          —
                        </p>
                      ) : (
                        bucket.map((item) => {
                          const owner = people.find(
                            (p) => p.id === item.project.ownerId
                          );
                          return (
                            <Link
                              key={item.project.id}
                              href={roadmapLink(item.goalId, item.project.id)}
                              className="block rounded-md border border-zinc-800/80 bg-zinc-950/60 px-2 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                            >
                              <div className="flex items-start gap-2 min-w-0">
                                {item.companyLogoPath ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.companyLogoPath}
                                    alt=""
                                    className="mt-0.5 h-5 w-5 shrink-0 rounded object-cover"
                                  />
                                ) : (
                                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium text-zinc-200">
                                    {item.project.name}
                                  </p>
                                  <p className="truncate text-[10px] text-zinc-500">
                                    {item.goalDescription}
                                  </p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <PriorityBadge priority={item.project.priority} />
                                    {owner ? (
                                      <span className="truncate text-[10px] text-zinc-400">
                                        {firstNameFromFullName(owner.name)}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-violet-400/90">
                                        Unassigned
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
