"use client";

import { useCallback, useMemo, useState } from "react";
import type { Company, EmploymentKind, Person, PersonWorkload } from "@/lib/types/tracker";
import {
  buildTeamRosterGroups,
  AUTONOMY_GROUP_LABEL,
  AUTONOMY_GROUP_VISUAL,
  FOUNDER_GROUP_LABEL,
  FOUNDER_GROUP_VISUAL,
  FOUNDERS_DEPARTMENT,
  isFounderPersonId,
  AUTONOMY_LEVEL_SELECT_OPTIONS,
  clampAutonomy,
  TEAM_ROSTER_WORKLOAD_HEADER,
  type TeamRosterSortMode,
} from "@/lib/autonomyRoster";
import { DepartmentOptionIcon } from "@/lib/departmentIcons";
import { WorkloadTierHeaderIcon } from "./WorkloadTierHeaderIcon";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { LocalImageField } from "./LocalImageField";
import { CompanyAffiliationLogos } from "./CompanyAffiliationLogos";
import {
  createPerson,
  updatePerson,
  deletePerson,
} from "@/server/actions/tracker";
import { departmentSelectOptions } from "@/lib/trackerDepartmentOptions";
import { DepartmentSelect } from "./DepartmentSelect";
import { EmploymentSelect } from "./EmploymentSelect";
import {
  Plus,
  FilterX,
  Search,
  Building2,
  Briefcase,
  Clock,
  Layers,
  UserX,
  Activity,
} from "lucide-react";
import { SlackLogo } from "./SlackLogo";
import { WorkloadBar } from "./WorkloadBar";
import {
  parseSlackUserIdInput,
  SLACK_USER_ID_PLACEHOLDER,
  slackUserIdValidationError,
} from "@/lib/slackUserId";
import { groupCompaniesByRevenueTier } from "@/lib/companyRevenueTiers";
import type { CompanyFilterOption } from "./CompanyFilterMultiSelect";
import { CompanyFilterMultiSelect } from "./CompanyFilterMultiSelect";
import { TeamFacetMultiSelect } from "./TeamFacetMultiSelect";
import {
  applyTeamRosterFilters,
  countByCompany,
  countByDepartmentValue,
  countByEmployment,
  countByMissingDetail,
  countByWorkloadId,
  emptyTeamRosterFilterState,
  isTeamRosterFilterActive,
  teamDepartmentFilterLabel,
  teamRosterDepartmentFilterOptions,
  TEAM_EMPLOYMENT_OPTIONS,
  TEAM_MISSING_OPTIONS,
  TEAM_WORKLOAD_OPTIONS,
  type TeamRosterFilterState,
} from "@/lib/team-roster-filter";
import { normalizeTrackerSearchQuery as normalizeSearch } from "@/lib/tracker-search-filter";

function EmploymentMiniIcon({ label }: { label: string }) {
  if (label === "Outsourced") {
    return <Briefcase className="h-3.5 w-3.5 text-orange-400/90" aria-hidden />;
  }
  if (label === "In-house (hourly)") {
    return <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
  }
  return <Building2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
}

interface TeamRosterManagerProps {
  initialPeople: Person[];
  companies: Company[];
  workloads: PersonWorkload[];
}

export function TeamRosterManager({
  initialPeople,
  companies,
  workloads,
}: TeamRosterManagerProps) {
  const [filterState, setFilterState] = useState<TeamRosterFilterState>(() =>
    emptyTeamRosterFilterState()
  );
  const [rosterSortMode, setRosterSortMode] =
    useState<TeamRosterSortMode>("autonomy");

  const workloadByPersonId = useMemo(() => {
    const m = new Map<string, PersonWorkload>();
    for (const w of workloads) m.set(w.person.id, w);
    return m;
  }, [workloads]);

  const peopleForDeptFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        initialPeople,
        workloadByPersonId,
        filterState,
        "department"
      ),
    [initialPeople, workloadByPersonId, filterState]
  );
  const peopleForEmpFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        initialPeople,
        workloadByPersonId,
        filterState,
        "employment"
      ),
    [initialPeople, workloadByPersonId, filterState]
  );
  const peopleForWlFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        initialPeople,
        workloadByPersonId,
        filterState,
        "workload"
      ),
    [initialPeople, workloadByPersonId, filterState]
  );
  const peopleForCoFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        initialPeople,
        workloadByPersonId,
        filterState,
        "company"
      ),
    [initialPeople, workloadByPersonId, filterState]
  );
  const peopleForMissFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        initialPeople,
        workloadByPersonId,
        filterState,
        "missing"
      ),
    [initialPeople, workloadByPersonId, filterState]
  );

  const filteredPeople = useMemo(
    () =>
      applyTeamRosterFilters(
        initialPeople,
        workloadByPersonId,
        filterState
      ),
    [initialPeople, workloadByPersonId, filterState]
  );

  const filterActive = useMemo(
    () => isTeamRosterFilterActive(filterState),
    [filterState]
  );

  const searchActive =
    normalizeSearch(filterState.searchQuery).length > 0;

  const departmentFacetOptions = useMemo(() => {
    const keys = teamRosterDepartmentFilterOptions(initialPeople);
    return keys.map((id) => ({
      id,
      label: teamDepartmentFilterLabel(id),
      count: countByDepartmentValue(peopleForDeptFacet, id),
      icon: (
        <DepartmentOptionIcon
          label={id ? id : ""}
          className="h-7 w-7 shrink-0"
          iconClassName="h-3.5 w-3.5"
        />
      ),
      labelClassName:
        id === ""
          ? "text-amber-200/95 font-medium"
          : id === FOUNDERS_DEPARTMENT
            ? "text-zinc-100"
            : undefined,
    }));
  }, [initialPeople, peopleForDeptFacet]);

  const employmentFacetOptions = useMemo(
    () =>
      TEAM_EMPLOYMENT_OPTIONS.map(({ kind, label }) => ({
        id: kind,
        label,
        count: countByEmployment(peopleForEmpFacet, kind),
        icon: (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
            <EmploymentMiniIcon label={label} />
          </span>
        ),
      })),
    [peopleForEmpFacet]
  );

  const workloadFacetOptions = useMemo(
    () =>
      TEAM_WORKLOAD_OPTIONS.map(({ id, label }) => ({
        id,
        label,
        count: countByWorkloadId(peopleForWlFacet, workloadByPersonId, id),
      })),
    [peopleForWlFacet, workloadByPersonId]
  );

  const missingFacetOptions = useMemo(
    () =>
      TEAM_MISSING_OPTIONS.map(({ id, label }) => ({
        id,
        label,
        count: countByMissingDetail(peopleForMissFacet, id),
      })),
    [peopleForMissFacet]
  );

  const companiesForFilter = useMemo((): CompanyFilterOption[] => {
    return groupCompaniesByRevenueTier(companies).flatMap((g) =>
      g.companies.map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        logoPath: c.logoPath,
        revenue: c.revenue,
      }))
    );
  }, [companies]);

  const companyOptionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of companiesForFilter) {
      m.set(c.id, countByCompany(peopleForCoFacet, workloadByPersonId, c.id));
    }
    return m;
  }, [companiesForFilter, peopleForCoFacet, workloadByPersonId]);

  const rosterGroups = useMemo(
    () =>
      buildTeamRosterGroups(
        filteredPeople,
        rosterSortMode,
        workloadByPersonId
      ),
    [filteredPeople, rosterSortMode, workloadByPersonId]
  );

  const departmentOptionsByPersonId = useMemo(() => {
    const m = new Map<string, { value: string; label: string }[]>();
    for (const p of initialPeople) {
      if (isFounderPersonId(p.id)) continue;
      m.set(
        p.id,
        departmentSelectOptions(initialPeople, p.department ?? "", p.id)
      );
    }
    return m;
  }, [initialPeople]);

  const maxWorkloadAcrossTeam = useMemo(
    () =>
      workloads.reduce((m, w) => Math.max(m, w.totalProjects), 0),
    [workloads]
  );

  const resetFilters = useCallback(() => {
    setFilterState(emptyTeamRosterFilterState());
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 min-h-[2.25rem]">
        <div
          className={cn(
            "relative flex-1 min-w-[10rem] max-w-[19rem] transition-[max-width] duration-200 ease-out",
            filterState.searchQuery.trim() === "" &&
              "max-w-[11rem] focus-within:max-w-[19rem]"
          )}
        >
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={filterState.searchQuery}
            onChange={(e) =>
              setFilterState((s) => ({ ...s, searchQuery: e.target.value }))
            }
            placeholder="Search name, role, department…"
            className="w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-900/80 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            aria-label="Search team"
            autoComplete="off"
          />
        </div>

        <TeamFacetMultiSelect
          ariaLabel="Filter by department"
          emptySummary="All departments"
          summaryIcon={<Layers className="h-3.5 w-3.5" aria-hidden />}
          options={departmentFacetOptions}
          selectedIds={filterState.departmentValues}
          onChange={(departmentValues) =>
            setFilterState((s) => ({ ...s, departmentValues }))
          }
          enableSearch
          searchPlaceholder="Search departments…"
        />

        <TeamFacetMultiSelect
          ariaLabel="Filter by employment type"
          emptySummary="All types"
          summaryIcon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
          options={employmentFacetOptions}
          selectedIds={filterState.employmentKinds}
          onChange={(ids) =>
            setFilterState((s) => ({
              ...s,
              employmentKinds: ids as EmploymentKind[],
            }))
          }
        />

        <TeamFacetMultiSelect
          ariaLabel="Filter by workload"
          emptySummary="All workloads"
          summaryIcon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          options={workloadFacetOptions}
          selectedIds={filterState.workloadIds}
          onChange={(workloadIds) =>
            setFilterState((s) => ({
              ...s,
              workloadIds: workloadIds as TeamRosterFilterState["workloadIds"],
            }))
          }
        />

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[18rem]">
          <CompanyFilterMultiSelect
            companies={companiesForFilter}
            selectedIds={filterState.companyIds}
            onChange={(companyIds) =>
              setFilterState((s) => ({ ...s, companyIds }))
            }
            optionCounts={companyOptionCounts}
          />
        </div>

        <TeamFacetMultiSelect
          ariaLabel="Filter by missing profile fields"
          emptySummary="All profiles"
          summaryIcon={<UserX className="h-3.5 w-3.5" aria-hidden />}
          options={missingFacetOptions}
          selectedIds={filterState.missingDetailIds}
          onChange={(missingDetailIds) =>
            setFilterState((s) => ({
              ...s,
              missingDetailIds:
                missingDetailIds as TeamRosterFilterState["missingDetailIds"],
            }))
          }
          enableSearch
          searchPlaceholder="Search missing fields…"
        />

        {filterActive ? (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors shrink-0"
            title="Clear search and all team filters"
          >
            <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Reset filters
          </button>
        ) : null}

        <div className="ml-auto shrink-0">
          <select
            id="team-roster-sort-mode"
            value={rosterSortMode}
            onChange={(e) =>
              setRosterSortMode(e.target.value as TeamRosterSortMode)
            }
            aria-label="Group team by autonomy, organization, or workload"
            className={cn(
              "cursor-pointer rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200",
              "transition-colors hover:border-zinc-600 hover:text-zinc-100",
              "focus:outline-none focus:ring-2 focus:ring-zinc-500/50"
            )}
          >
            <option value="autonomy">By Autonomy</option>
            <option value="department">By organization</option>
            <option value="workload">By workload</option>
          </select>
        </div>
      </div>

      {filterActive ? (
        <p className="text-xs text-zinc-500">
          Showing{" "}
          <span className="tabular-nums text-zinc-400">{filteredPeople.length}</span>
          {" of "}
          <span className="tabular-nums text-zinc-400">{initialPeople.length}</span>{" "}
          members
          {searchActive ? (
            <>
              {" "}
              matching &quot;{filterState.searchQuery.trim()}&quot;
            </>
          ) : null}
        </p>
      ) : null}

      <div className="bg-zinc-900/40 rounded-lg border border-zinc-800 overflow-x-auto">
        {filterActive && filteredPeople.length === 0 ? (
          <p className="text-sm text-zinc-500 py-10 px-4 text-center border-b border-zinc-800">
            {searchActive ? (
              <>
                No team members match &quot;{filterState.searchQuery.trim()}
                &quot; with the current filters. Try another keyword or reset filters.
              </>
            ) : (
              <>
                No team members match your filters. Adjust or reset filters.
              </>
            )}
          </p>
        ) : null}
        {!(filterActive && filteredPeople.length === 0) ? (
        <table className="w-full text-sm min-w-[1040px]">
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-500">
              <th
                className="text-left px-3 py-3 font-medium min-w-[220px]"
                scope="col"
              >
                Member
              </th>
              <th className="text-left px-3 py-3 font-medium">Role</th>
              <th className="text-left px-3 py-3 font-medium min-w-[120px]">
                Department
              </th>
              <th className="text-left px-3 py-3 font-medium whitespace-nowrap">
                Team
              </th>
              <th className="text-left px-3 py-3 font-medium whitespace-nowrap">
                Join date
              </th>
              <th className="text-left px-3 py-3 font-medium min-w-[13rem]">
                Autonomy
              </th>
              <th className="text-left px-3 py-3 font-medium min-w-[220px]">
                Workload
              </th>
              <th className="text-left px-3 py-3 font-medium min-w-[160px]">
                Companies
              </th>
              <th className="text-left px-3 py-3 font-medium" scope="col">
                <SlackLogo alt="Slack" className="h-4 w-4" />
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          {rosterGroups.map((group) => {
            const isFounders = group.kind === "founders";
            const visual =
              isFounders
                ? FOUNDER_GROUP_VISUAL
                : group.kind === "autonomy"
                  ? AUTONOMY_GROUP_VISUAL[group.level]
                  : AUTONOMY_GROUP_VISUAL[3];
            const label =
              isFounders
                ? FOUNDER_GROUP_LABEL
                : group.kind === "autonomy"
                  ? AUTONOMY_GROUP_LABEL[group.level]
                  : group.kind === "department"
                    ? {
                        title:
                          group.departmentKey === ""
                            ? "No Department"
                            : group.departmentKey,
                        hint: "",
                      }
                    : {
                        title: TEAM_ROSTER_WORKLOAD_HEADER[group.tier].title,
                        hint: TEAM_ROSTER_WORKLOAD_HEADER[group.tier].subtitle,
                      };
            const groupPeople = group.people;
            const tbodyKey =
              group.kind === "founders"
                ? "__founders__"
                : group.kind === "autonomy"
                  ? `a-${group.level}`
                  : group.kind === "department"
                    ? `d-${group.departmentKey || "__empty__"}`
                    : `w-${group.tier}`;
            return (
              <tbody key={tbodyKey}>
                <tr className={visual.header}>
                  <td colSpan={10} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {group.kind === "department" ? (
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <DepartmentOptionIcon
                            label={group.departmentKey}
                            className="!h-7 !w-7 opacity-95"
                            iconClassName="h-3.5 w-3.5"
                          />
                          <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                            {label.title}
                          </span>
                        </span>
                      ) : group.kind === "workload" ? (
                        <span className="inline-flex items-start gap-2.5 min-w-0">
                          <WorkloadTierHeaderIcon tier={group.tier} />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                              {label.title}
                            </span>
                            <span className="text-xs text-zinc-500 leading-snug">
                              {label.hint}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                          {label.title}
                        </span>
                      )}
                      {label.hint &&
                      group.kind !== "department" &&
                      group.kind !== "workload" ? (
                        <span className="text-xs text-zinc-400">{label.hint}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {groupPeople.map((person) => {
                  const w = workloadByPersonId.get(person.id);
                  return (
                  <tr
                    key={person.id}
                    className={cn(
                      visual.dataRow,
                      "border-b border-zinc-800/60 group align-top"
                    )}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-3 min-w-0 max-w-[280px]">
                        <div className="shrink-0">
                          <LocalImageField
                            variant="person"
                            entityId={person.id}
                            path={person.profilePicturePath ?? ""}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <InlineEditCell
                            value={person.name}
                            onSave={(name) => updatePerson(person.id, { name })}
                            displayClassName="text-zinc-200"
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-[140px]">
                      <InlineEditCell
                        value={person.role}
                        onSave={(role) => updatePerson(person.id, { role })}
                        displayClassName="text-zinc-400"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[160px]">
                      {isFounderPersonId(person.id) ? (
                        <div className="flex min-w-0 max-w-[220px] items-center gap-2 px-2 py-1.5">
                          <DepartmentOptionIcon
                            label={FOUNDERS_DEPARTMENT}
                            className="opacity-90"
                          />
                          <span className="min-w-0 truncate text-sm font-medium text-zinc-300">
                            {FOUNDERS_DEPARTMENT}
                          </span>
                        </div>
                      ) : (
                        <DepartmentSelect
                          value={person.department ?? ""}
                          options={
                            departmentOptionsByPersonId.get(person.id) ?? [
                              { value: "", label: "No Department" },
                            ]
                          }
                          onChange={(department) =>
                            updatePerson(person.id, { department })
                          }
                          aria-label="Department"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isFounderPersonId(person.id) ? (
                        <span className="text-sm text-zinc-600">—</span>
                      ) : (
                        <EmploymentSelect
                          employment={person.employment}
                          onChange={(employment) =>
                            updatePerson(person.id, { employment })
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[120px] whitespace-nowrap">
                      {isFounderPersonId(person.id) ? (
                        <span
                          className="text-sm text-zinc-400 font-medium"
                          title="Founder"
                        >
                          OG
                        </span>
                      ) : (
                        <InlineEditCell
                          type="date"
                          value={person.joinDate}
                          onSave={(joinDate) =>
                            updatePerson(person.id, { joinDate })
                          }
                          displayClassName="text-zinc-400"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[13rem]">
                      {isFounderPersonId(person.id) ? (
                        <span className="text-sm text-zinc-600">—</span>
                      ) : (
                        <InlineEditCell
                          type="select"
                          selectPresentation="always"
                          options={AUTONOMY_LEVEL_SELECT_OPTIONS}
                          value={String(
                            clampAutonomy(person.autonomyScore)
                          )}
                          onSave={(v) =>
                            updatePerson(person.id, {
                              autonomyScore: clampAutonomy(
                                parseInt(v, 10)
                              ),
                            })
                          }
                          displayClassName="text-zinc-300"
                          displayTitle="Autonomy level"
                          className="max-w-[min(20rem,100%)]"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <WorkloadBar
                        totalProjects={w?.totalProjects ?? 0}
                        p0Projects={w?.p0Projects ?? 0}
                        p1Projects={w?.p1Projects ?? 0}
                        maxAcrossTeam={maxWorkloadAcrossTeam}
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[280px]">
                      {isFounderPersonId(person.id) ? (
                        <span className="text-zinc-400">All</span>
                      ) : (
                        <CompanyAffiliationLogos
                          shortListCsv={w?.projectCompanyIds?.join(",") ?? ""}
                          companies={companies}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[120px]">
                      <InlineEditCell
                        value={person.slackHandle}
                        onSave={(slackHandle) =>
                          updatePerson(person.id, {
                            slackHandle: parseSlackUserIdInput(slackHandle) ?? "",
                          })
                        }
                        validate={(draft) => {
                          const t = draft.trim();
                          if (t === "") return undefined;
                          return parseSlackUserIdInput(draft) === null
                            ? slackUserIdValidationError()
                            : undefined;
                        }}
                        placeholder={SLACK_USER_ID_PLACEHOLDER}
                        displayTitle="Slack user ID — click to edit"
                        displayClassName="text-zinc-500"
                      />
                    </td>
                    <td className="px-1 py-2">
                      {isFounderPersonId(person.id) ? null : (
                        <ConfirmDeletePopover
                          entityName={person.name}
                          onConfirm={() => deletePerson(person.id)}
                        />
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() =>
          createPerson({
            name: "New team member",
            role: "",
            department: "",
            autonomyScore: 3,
            slackHandle: "",
            profilePicturePath: "",
            joinDate: "",
            employment: "inhouse_salaried",
          })
        }
        className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-600 hover:text-zinc-400 transition-colors w-full border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
      >
        <Plus className="h-4 w-4" />
        Add team member
      </button>
    </div>
  );
}
