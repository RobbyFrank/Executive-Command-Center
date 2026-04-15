"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { Company, EmploymentKind, Person, PersonWorkload } from "@/lib/types/tracker";
import {
  buildTeamRosterGroups,
  AUTONOMY_GROUP_LABEL,
  AUTONOMY_GROUP_VISUAL,
  FOUNDER_GROUP_LABEL,
  FOUNDER_GROUP_VISUAL,
  FOUNDERS_DEPARTMENT,
  isFounderPerson,
  AUTONOMY_LEVEL_SELECT_OPTIONS,
  clampAutonomy,
  TEAM_ROSTER_WORKLOAD_HEADER,
  type TeamRosterSortMode,
} from "@/lib/autonomyRoster";
import { DepartmentOptionIcon } from "@/lib/departmentIcons";
import { WorkloadTierHeaderIcon } from "./WorkloadTierHeaderIcon";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./InlineEditCell";
import { TeamRosterRowMenu } from "./TeamRosterRowMenu";
import { LocalImageField } from "./LocalImageField";
import { CompanyAffiliationLogos } from "./CompanyAffiliationLogos";
import { createPerson, updatePerson } from "@/server/actions/tracker";
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
  Crown,
  Layers,
  UserX,
  Activity,
  Users,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { SlackLogo } from "./SlackLogo";
import { WorkloadBar } from "./WorkloadBar";
import {
  parseSlackUserIdInput,
  SLACK_USER_ID_PLACEHOLDER,
  slackUserIdValidationError,
} from "@/lib/slackUserId";
import { scheduleSlackProfileRefresh } from "@/lib/slackRosterRefresh";
import { groupCompaniesByRevenueTier } from "@/lib/companyRevenueTiers";
import type { CompanyFilterOption } from "./CompanyFilterMultiSelect";
import { CompanyFilterMultiSelect } from "./CompanyFilterMultiSelect";
import { RosterContactInput } from "./RosterContactInput";
import {
  personEmailValidationError,
  personPhoneValidationError,
} from "@/lib/personContactValidation";
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
import { formatUsdWhole } from "@/lib/formatUsd";
import { SlackImportDialog } from "./SlackImportDialog";
import { refreshPersonFromSlack } from "@/server/actions/slack";
import { SLACK_REFRESH_NO_NEW_DATA_MESSAGE } from "@/lib/slack-refresh-messages";

function EmploymentMiniIcon({ label }: { label: string }) {
  if (label === "Outsourced") {
    return <Briefcase className="h-3.5 w-3.5 text-orange-400/90" aria-hidden />;
  }
  if (label === "In-house (hourly)") {
    return <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
  }
  return <Building2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
}

function RosterGroupMemberCount({ count }: { count: number }) {
  return (
    <span className="text-xs font-medium text-zinc-500 tabular-nums">
      ({count} {count === 1 ? "person" : "people"})
    </span>
  );
}

function sumEstimatedMonthlySalary(people: Person[]): number {
  return people.reduce((s, p) => s + (p.estimatedMonthlySalary ?? 0), 0);
}

/** Matches Team column: $0 / unset is treated as no salary entered. */
function hasEstimatedSalaryEntered(p: Person): boolean {
  return (p.estimatedMonthlySalary ?? 0) > 0;
}

function RosterGroupSalaryStats({ people }: { people: Person[] }) {
  const total = sumEstimatedMonthlySalary(people);
  const withSalary = people.filter(hasEstimatedSalaryEntered);
  const avg =
    withSalary.length > 0 ? total / withSalary.length : null;
  return (
    <p className="text-xs text-zinc-500 leading-snug">
      <span className="font-medium text-zinc-400">Salary · </span>
      <span className="tabular-nums">{formatUsdWhole(total)}</span>
      <span> total · </span>
      <span className="tabular-nums">
        {avg !== null ? formatUsdWhole(avg) : "—"}
      </span>
      <span> avg</span>
    </p>
  );
}

interface TeamRosterManagerProps {
  initialPeople: Person[];
  companies: Company[];
  workloads: PersonWorkload[];
}

/** Same shell as Roadmap’s sticky toolbar (border, blur, shadow, padding). */
const TEAM_PAGE_STICKY_TOOLBAR_CLASS =
  "sticky top-0 z-30 min-w-0 max-w-full border-b border-zinc-800/70 " +
  "bg-zinc-950/95 backdrop-blur-md px-6 pt-6 pb-6 " +
  "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]";

/** Shared chrome for **Import from Slack** and **Refresh all from Slack** (toolbar). */
const TEAM_SLACK_ACTION_BUTTON_CLASS =
  "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-600 bg-zinc-900/85 px-3 py-1.5 text-xs font-medium text-zinc-200 shadow-sm " +
  "transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const TEAM_SLACK_ACTION_ICON_CLASS = "h-4 w-4 shrink-0 opacity-90";

/**
 * Sticky header row applied on `<tr>` so `<th>` cells stay in the column grid.
 * `top` is set dynamically via the `--team-roster-sticky-top` CSS variable on the scroll wrapper.
 */
const TEAM_ROSTER_HEADER_ROW_STICKY =
  "sticky z-20 top-[var(--team-roster-sticky-top,0px)] border-b border-zinc-800 bg-zinc-950/95 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.45)] backdrop-blur-md supports-[backdrop-filter]:bg-zinc-950/80 [&_th]:bg-zinc-950/95";

export function TeamRosterManager({
  initialPeople,
  companies,
  workloads,
}: TeamRosterManagerProps) {
  const router = useRouter();
  /** After adding a person, name cell opens in edit mode so the user can type immediately. */
  const [newPersonNameFocusId, setNewPersonNameFocusId] = useState<
    string | null
  >(null);
  const [filterState, setFilterState] = useState<TeamRosterFilterState>(() =>
    emptyTeamRosterFilterState()
  );
  const [rosterSortMode, setRosterSortMode] =
    useState<TeamRosterSortMode>("autonomy");
  /** When true, founders are excluded from the roster and filter counts. */
  const [hideFounders, setHideFounders] = useState(true);
  const [slackImportOpen, setSlackImportOpen] = useState(false);
  const [slackBulkRefreshRunning, setSlackBulkRefreshRunning] = useState(false);

  const teamStickyToolbarRef = useRef<HTMLDivElement>(null);
  const [teamStickyToolbarPx, setTeamStickyToolbarPx] = useState(0);
  const teamColumnHeaderRef = useRef<HTMLTableRowElement>(null);
  const [teamColumnHeaderPx, setTeamColumnHeaderPx] = useState(40);

  useLayoutEffect(() => {
    const el = teamStickyToolbarRef.current;
    if (!el) return;
    const sync = () => setTeamStickyToolbarPx(el.getBoundingClientRect().height);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = teamColumnHeaderRef.current;
    if (!el) return;
    const sync = () => setTeamColumnHeaderPx(Math.round(el.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const existingSlackIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of initialPeople) {
      const h = p.slackHandle?.trim().toUpperCase();
      if (h) s.add(h);
    }
    return s;
  }, [initialPeople]);

  const peopleWithSlackHandle = useMemo(
    () => initialPeople.filter((p) => (p.slackHandle ?? "").trim() !== ""),
    [initialPeople]
  );

  const peopleForRosterView = useMemo(() => {
    if (!hideFounders) return initialPeople;
    return initialPeople.filter((p) => !isFounderPerson(p));
  }, [initialPeople, hideFounders]);

  const workloadByPersonId = useMemo(() => {
    const m = new Map<string, PersonWorkload>();
    for (const w of workloads) m.set(w.person.id, w);
    return m;
  }, [workloads]);

  const peopleForDeptFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "department"
      ),
    [peopleForRosterView, workloadByPersonId, filterState]
  );
  const peopleForEmpFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "employment"
      ),
    [peopleForRosterView, workloadByPersonId, filterState]
  );
  const peopleForWlFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "workload"
      ),
    [peopleForRosterView, workloadByPersonId, filterState]
  );
  const peopleForCoFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "company"
      ),
    [peopleForRosterView, workloadByPersonId, filterState]
  );
  const peopleForMissFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "missing"
      ),
    [peopleForRosterView, workloadByPersonId, filterState]
  );

  const filteredPeople = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState
      ),
    [peopleForRosterView, workloadByPersonId, filterState]
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
      if (isFounderPerson(p)) continue;
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

  const onRefreshAllFromSlack = useCallback(async () => {
    if (peopleWithSlackHandle.length === 0 || slackBulkRefreshRunning) return;
    setSlackBulkRefreshRunning(true);
    const total = peopleWithSlackHandle.length;
    const loadId = toast.loading(`Syncing from Slack (0 / ${total})`, {
      description: "Starting…",
    });
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const failures: { name: string; error: string }[] = [];
    const avatarWarnings: string[] = [];

    try {
      for (let i = 0; i < peopleWithSlackHandle.length; i++) {
        const p = peopleWithSlackHandle[i];
        toast.loading(`Syncing from Slack (${i + 1} / ${total})`, {
          id: loadId,
          description: p.name,
        });
        const r = await refreshPersonFromSlack(p.id, p.slackHandle ?? "");
        if (r.ok) {
          updated += 1;
          if (r.avatarWarning) {
            avatarWarnings.push(`${p.name}: ${r.avatarWarning}`);
          }
        } else if (r.error === SLACK_REFRESH_NO_NEW_DATA_MESSAGE) {
          unchanged += 1;
        } else {
          failed += 1;
          failures.push({ name: p.name, error: r.error });
        }
      }

      toast.dismiss(loadId);
      router.refresh();

      const summaryParts = [
        updated > 0 ? `${updated} updated` : null,
        unchanged > 0 ? `${unchanged} already up to date` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter(Boolean);

      if (failed > 0) {
        toast.warning(summaryParts.join(" · ") || "Some refreshes failed", {
          description: failures
            .slice(0, 8)
            .map((f) => `${f.name}: ${f.error}`)
            .join(" · "),
        });
      } else if (summaryParts.length > 0) {
        toast.success(summaryParts.join(" · "));
      }
      if (avatarWarnings.length > 0) {
        toast.warning("Some profile photos could not be saved", {
          description: avatarWarnings.slice(0, 4).join(" · "),
        });
      }
    } catch (e) {
      toast.dismiss(loadId);
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setSlackBulkRefreshRunning(false);
    }
  }, [peopleWithSlackHandle, slackBulkRefreshRunning, router]);

  if (initialPeople.length === 0) {
    return (
      <div className="min-w-0 min-h-0 max-w-full">
        <SlackImportDialog
          open={slackImportOpen}
          onClose={() => setSlackImportOpen(false)}
          existingSlackIds={existingSlackIds}
        />
        <div className={TEAM_PAGE_STICKY_TOOLBAR_CLASS}>
          <div className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="text-xl font-bold text-zinc-100">Team</h1>
            <span className="text-sm font-normal text-zinc-500">
              Roster, roles, workloads, and Slack IDs.
            </span>
          </div>
        </div>
        <div className="min-w-0 max-w-full px-6 pb-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 px-6 py-20">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 mb-5">
            <Users className="h-7 w-7 text-zinc-500" />
          </div>
          <h2 className="text-base font-semibold text-zinc-200 mb-1.5">No team members yet</h2>
          <p className="text-sm text-zinc-500 text-center max-w-sm mb-6">
            Your team roster is empty. Add your first team member to start tracking roles, departments, autonomy levels, and workloads.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
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
                  email: "",
                  phone: "",
                  estimatedMonthlySalary: 0,
                  employment: "inhouse_salaried",
                })
              }
              className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
            >
              <Plus className="h-4 w-4" />
              Add your first team member
            </button>
            <button
              type="button"
              onClick={() => setSlackImportOpen(true)}
              className={cn(
                TEAM_SLACK_ACTION_BUTTON_CLASS,
                "min-h-10 px-4 py-2 text-sm cursor-pointer"
              )}
            >
              <SlackLogo alt="" className={TEAM_SLACK_ACTION_ICON_CLASS} />
              Import from Slack
            </button>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SlackImportDialog
        open={slackImportOpen}
        onClose={() => setSlackImportOpen(false)}
        existingSlackIds={existingSlackIds}
      />
      <div className="min-w-0 min-h-0 max-w-full">
      <div ref={teamStickyToolbarRef} className={TEAM_PAGE_STICKY_TOOLBAR_CLASS}>
        <div className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-100">Team</h1>
          <span className="text-sm font-normal text-zinc-500">
            Roster, roles, workloads, and Slack IDs.
          </span>
        </div>
      <div className="flex flex-wrap items-center gap-3 px-1 min-h-[2.25rem]">
        <div
          className={cn(
            "relative flex-1 min-w-0 transition-[max-width] duration-200 ease-out",
            filterState.searchQuery.trim() !== ""
              ? "max-w-[19.2rem]"
              : "max-w-[10rem] focus-within:max-w-[19.2rem]"
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
            placeholder="Search name, role, department, email, phone…"
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

        <label
          htmlFor="team-roster-hide-founders"
          className="inline-flex shrink-0 cursor-pointer select-none items-center gap-2 text-xs text-zinc-400 hover:text-zinc-300"
        >
          <input
            id="team-roster-hide-founders"
            type="checkbox"
            checked={hideFounders}
            onChange={(e) => setHideFounders(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 text-amber-500 focus:ring-2 focus:ring-zinc-500/50 focus:ring-offset-0"
          />
          <span>Hide founders</span>
        </label>

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

        <div className="inline-flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setSlackImportOpen(true)}
            className={TEAM_SLACK_ACTION_BUTTON_CLASS}
          >
            <SlackLogo alt="" className={TEAM_SLACK_ACTION_ICON_CLASS} />
            Import from Slack
          </button>
          <button
            type="button"
            onClick={() => void onRefreshAllFromSlack()}
            disabled={
              slackBulkRefreshRunning || peopleWithSlackHandle.length === 0
            }
            title={
              peopleWithSlackHandle.length === 0
                ? "Add Slack user IDs to team members first"
                : "Update name, email, join date, and photos from Slack for everyone with a Slack ID"
            }
            className={TEAM_SLACK_ACTION_BUTTON_CLASS}
          >
            <RefreshCw
              className={cn(
                TEAM_SLACK_ACTION_ICON_CLASS,
                slackBulkRefreshRunning && "animate-spin"
              )}
              aria-hidden
            />
            Refresh all from Slack
          </button>
        </div>

        <div className="ml-auto shrink-0">
          <select
            id="team-roster-sort-mode"
            value={rosterSortMode}
            onChange={(e) =>
              setRosterSortMode(e.target.value as TeamRosterSortMode)
            }
            aria-label="Group team by autonomy, department, or workload"
            className={cn(
              "cursor-pointer rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200",
              "transition-colors hover:border-zinc-600 hover:text-zinc-100",
              "focus:outline-none focus:ring-2 focus:ring-zinc-500/50"
            )}
          >
            <option value="autonomy">By Autonomy</option>
            <option value="department">By Department</option>
            <option value="workload">By workload</option>
          </select>
        </div>
      </div>
      </div>

      <div className="min-w-0 max-w-full space-y-4 px-6 pb-6">
      {filterActive ? (
        <p className="text-xs text-zinc-500">
          Showing{" "}
          <span className="tabular-nums text-zinc-400">{filteredPeople.length}</span>
          {" of "}
          <span className="tabular-nums text-zinc-400">
            {peopleForRosterView.length}
          </span>{" "}
          members
          {searchActive ? (
            <>
              {" "}
              matching &quot;{filterState.searchQuery.trim()}&quot;
            </>
          ) : null}
        </p>
      ) : null}

      <div
        className="bg-zinc-900/40 rounded-lg border border-zinc-800 w-max min-w-full"
        style={
          {
            "--team-roster-sticky-top": `${teamStickyToolbarPx}px`,
            "--team-roster-group-top": `${teamStickyToolbarPx + teamColumnHeaderPx}px`,
          } as CSSProperties
        }
      >
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
        <table className="w-full text-sm min-w-[1380px]">
          <thead>
            <tr
              ref={teamColumnHeaderRef}
              className={cn("text-xs text-zinc-500", TEAM_ROSTER_HEADER_ROW_STICKY)}
            >
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
              <th
                className="text-right px-3 py-3 font-medium whitespace-nowrap min-w-[7.5rem]"
                scope="col"
              >
                Est. monthly ($)
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
              <th className="text-left px-3 py-3 font-medium min-w-[11rem]">
                Email
              </th>
              <th className="text-left px-3 py-3 font-medium min-w-[9rem]">
                Phone
              </th>
              <th className="text-left px-3 py-3 font-medium" scope="col">
                <SlackLogo alt="Slack" className="h-4 w-4" />
              </th>
              <th
                className="w-10 py-3 pr-4"
                scope="col"
                aria-label="Actions"
              />
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
                <tr
                  className={cn(
                    visual.header,
                    "sticky z-10 top-[var(--team-roster-group-top,0px)] bg-zinc-900 shadow-[0_2px_4px_-2px_rgba(0,0,0,0.35)]"
                  )}
                >
                  <td colSpan={13} className="px-3 py-2.5">
                    <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {group.kind === "department" ? (
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <DepartmentOptionIcon
                            label={group.departmentKey}
                            className="!h-7 !w-7 opacity-95"
                            iconClassName="h-3.5 w-3.5"
                          />
                          <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                              {label.title}
                            </span>
                            <RosterGroupMemberCount count={groupPeople.length} />
                          </span>
                        </span>
                      ) : group.kind === "workload" ? (
                        <span className="inline-flex items-start gap-2.5 min-w-0">
                          <WorkloadTierHeaderIcon tier={group.tier} />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                                {label.title}
                              </span>
                              <RosterGroupMemberCount
                                count={groupPeople.length}
                              />
                            </span>
                            <span className="text-xs text-zinc-500 leading-snug">
                              {label.hint}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                          {isFounders ? (
                            <Crown
                              className="h-4 w-4 shrink-0 text-amber-400/90"
                              strokeWidth={2}
                              aria-hidden
                            />
                          ) : null}
                          <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                            {label.title}
                          </span>
                          <RosterGroupMemberCount count={groupPeople.length} />
                        </span>
                      )}
                      {label.hint &&
                      group.kind !== "department" &&
                      group.kind !== "workload" ? (
                        <span className="text-xs text-zinc-400">{label.hint}</span>
                      ) : null}
                    </div>
                    {group.kind !== "founders" ? (
                      <RosterGroupSalaryStats people={groupPeople} />
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
                      "border-b border-zinc-800/60 group align-middle"
                    )}
                  >
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-3 min-w-0 max-w-[280px]">
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
                            startInEditMode={
                              person.id === newPersonNameFocusId
                            }
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[140px]">
                      <InlineEditCell
                        value={person.role}
                        onSave={(role) => updatePerson(person.id, { role })}
                        displayClassName="text-zinc-400"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[160px]">
                      {isFounderPerson(person) ? (
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
                    <td className="px-3 py-2 align-middle whitespace-nowrap">
                      {isFounderPerson(person) ? null : (
                        <EmploymentSelect
                          employment={person.employment}
                          onChange={(employment) =>
                            updatePerson(person.id, { employment })
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[120px] whitespace-nowrap">
                      {isFounderPerson(person) ? (
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
                    <td className="px-3 py-2 align-middle text-right max-w-[9rem]">
                      {isFounderPerson(person) ? null : (
                        <InlineEditCell
                          type="number"
                          min={0}
                          step={100}
                          value={String(person.estimatedMonthlySalary ?? 0)}
                          onSave={(raw) => {
                            const n = parseFloat(raw);
                            const next =
                              Number.isFinite(n) && n >= 0
                                ? Math.round(n)
                                : 0;
                            updatePerson(person.id, {
                              estimatedMonthlySalary: next,
                            });
                          }}
                          formatDisplay={(v) => {
                            const n = parseFloat(v);
                            if (!Number.isFinite(n) || n <= 0) {
                              return "—";
                            }
                            return formatUsdWhole(n);
                          }}
                          placeholder="—"
                          displayTitle="Estimated monthly salary (USD)"
                          displayClassName="text-zinc-300 tabular-nums"
                          collapsedButtonClassName="!text-right"
                          className="text-right"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle min-w-[13rem]">
                      {isFounderPerson(person) ? null : (
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
                      {isFounderPerson(person) ? null : (
                        <WorkloadBar
                          totalProjects={w?.totalProjects ?? 0}
                          p0Projects={w?.p0Projects ?? 0}
                          p1Projects={w?.p1Projects ?? 0}
                          maxAcrossTeam={maxWorkloadAcrossTeam}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[280px]">
                      {isFounderPerson(person) ? (
                        <span className="text-zinc-400">All</span>
                      ) : (
                        <CompanyAffiliationLogos
                          shortListCsv={w?.projectCompanyIds?.join(",") ?? ""}
                          companies={companies}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[14rem]">
                      <RosterContactInput
                        kind="email"
                        value={person.email}
                        validate={personEmailValidationError}
                        onSave={(email) =>
                          updatePerson(person.id, { email })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[12rem]">
                      <RosterContactInput
                        kind="tel"
                        value={person.phone}
                        validate={personPhoneValidationError}
                        onSave={(phone) =>
                          updatePerson(person.id, { phone })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 align-middle max-w-[120px]">
                      <InlineEditCell
                        value={person.slackHandle}
                        onSave={(slackHandle) => {
                          const parsed =
                            parseSlackUserIdInput(slackHandle) ?? "";
                          void (async () => {
                            await updatePerson(person.id, {
                              slackHandle: parsed,
                            });
                            if (parsed) {
                              scheduleSlackProfileRefresh(
                                person.id,
                                parsed,
                                () => router.refresh()
                              );
                            }
                          })();
                        }}
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
                    <td className="py-2 pl-2 pr-4 align-middle">
                      <TeamRosterRowMenu person={person} />
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

      <div className="pt-1">
        <button
          type="button"
          onClick={async () => {
            const person = await createPerson({
              name: "New team member",
              role: "",
              department: "",
              autonomyScore: 3,
              slackHandle: "",
              profilePicturePath: "",
              joinDate: "",
              email: "",
              phone: "",
              estimatedMonthlySalary: 0,
              employment: "inhouse_salaried",
            });
            setNewPersonNameFocusId(person.id);
          }}
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add team member
        </button>
      </div>
      </div>
      </div>
    </>
  );
}
