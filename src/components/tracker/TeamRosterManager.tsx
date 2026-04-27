"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type {
  Company,
  CompanyWithGoals,
  EmploymentKind,
  Person,
  PersonWorkload,
  Project,
} from "@/lib/types/tracker";
import {
  buildTeamRosterGroups,
  AUTONOMY_GROUP_LABEL,
  AUTONOMY_GROUP_VISUAL,
  FOUNDER_GROUP_LABEL,
  FOUNDER_GROUP_VISUAL,
  FOUNDERS_DEPARTMENT,
  isFounderPerson,
  AUTONOMY_LEVEL_SELECT_LABEL,
  AUTONOMY_LEVEL_SELECT_OPTIONS,
  clampAutonomy,
  TEAM_ROSTER_WORKLOAD_HEADER,
  type TeamRosterSortMode,
} from "@/lib/autonomyRoster";
import { DepartmentOptionIcon } from "@/lib/departmentIcons";
import { WorkloadTierHeaderIcon } from "./WorkloadTierHeaderIcon";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerAutonomyBadge } from "./OwnerAutonomyBadge";
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
  X,
  Building2,
  Briefcase,
  Clock,
  Crown,
  Cake,
  Layers,
  UserX,
  Activity,
  Users,
  Lock,
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
  type TeamRosterOnboardingContext,
} from "@/lib/team-roster-filter";
import { normalizeTrackerSearchQuery as normalizeSearch } from "@/lib/tracker-search-filter";
import { formatUsdCompactK, formatUsdWhole } from "@/lib/formatUsd";
import { SlackImportDialog } from "./SlackImportDialog";
import type { RefreshPersonResult } from "@/server/actions/slack";
import { refreshPersonFromSlack } from "@/server/actions/slack";
import { SLACK_REFRESH_NO_NEW_DATA_MESSAGE } from "@/lib/slack-refresh-messages";
import { SendLoginSlackDialog } from "./SendLoginSlackDialog";
import { LoginRowMenu } from "./LoginRowMenu";
import {
  calendarDateTodayLocal,
  formatCalendarDateHint,
  formatTeamTenureFromJoinYmd,
  getUpcomingJoinAnniversaryWithin,
} from "@/lib/relativeCalendarDate";
import {
  daysSinceJoined,
  findPilotProjectsFor,
  isActiveOnboardingEmployee,
  isNewHire,
} from "@/lib/onboarding";
import { NewHireRow } from "@/components/team/NewHireRow";
import {
  RecommendPilotDialog,
  type AssignedPilotProject,
  type SelectedBuddy,
  type SelectedChannel,
} from "@/components/team/RecommendPilotDialog";
import { AssignmentMessageDialog } from "@/components/team/AssignmentMessageDialog";
import {
  RoadmapViewProvider,
  useRoadmapView,
} from "./roadmap-view-context";
import { PageToolbar } from "./PageToolbar";
import { EmptyState } from "./EmptyState";
import { RoadmapStickyBelowToolbarGap } from "./RoadmapStickyBelowToolbarGap";
import {
  TeamRosterActionsMenu,
  type SlackRefreshScope,
} from "./TeamRosterActionsMenu";
import { TeamRosterViewMenu } from "./TeamRosterViewMenu";
import { TeamOnboardingFilterSelect } from "./TeamOnboardingFilterSelect";
import { TeamRosterGroupingSelect } from "./TeamRosterGroupingSelect";
import {
  ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX,
  ROADMAP_TOOLBAR_STICKY_FALLBACK_PX,
} from "@/lib/tracker-sticky-layout";
import { ROADMAP_ENTITY_TITLE_DISPLAY_CLASS } from "@/lib/tracker-roadmap-columns";

/** Autonomy overlay menu row: level disc + full label. */
function teamRosterAutonomyMenuOption(value: string) {
  const level = clampAutonomy(parseInt(value, 10));
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700 text-[11px] font-semibold tabular-nums text-zinc-300"
        aria-hidden
      >
        {level}
      </span>
      <span className="min-w-0 text-left text-sm text-zinc-200">
        {AUTONOMY_LEVEL_SELECT_LABEL[level]}
      </span>
    </span>
  );
}

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

/**
 * True when at least one of the fields that a Slack refresh can populate is still empty.
 * Founders don't have a `role`/`department`/`joinDate` we'd fill from Slack, so only
 * their photo is considered here — everything else is "always complete" for founders.
 * Mirrors the fields updated in `refreshPersonFromSlack` on the server.
 */
function personHasIncompleteSlackProfile(p: Person): boolean {
  const photoEmpty = !p.profilePicturePath?.trim();
  if (isFounderPerson(p)) return photoEmpty;
  return (
    photoEmpty ||
    !p.name?.trim() ||
    !p.email?.trim() ||
    !p.joinDate?.trim() ||
    !p.role?.trim() ||
    !p.department?.trim()
  );
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

type PersonWithLoginFlag = Person & { loginPasswordSet?: boolean };

interface TeamRosterManagerProps {
  initialPeople: Person[];
  initialProjects: Project[];
  hierarchy: CompanyWithGoals[];
  companies: Company[];
  workloads: PersonWorkload[];
  /** Founders can set/clear app login passwords for roster members (email + bcrypt hash in tracker JSON). */
  canManageLoginPasswords: boolean;
}

/** Shared chrome for **Import from Slack** and **Refresh all from Slack** — matches Roadmap secondary actions. */
const TEAM_SLACK_ACTION_BUTTON_CLASS =
  "inline-flex min-h-[2.25rem] shrink-0 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm font-medium text-zinc-200 shadow-sm " +
  "transition-[border-color,background-color,color] duration-150 ease-out hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:border-zinc-500/45 focus-visible:ring-1 focus-visible:ring-zinc-400/20 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const TEAM_SLACK_ACTION_ICON_CLASS = "h-4 w-4 shrink-0 opacity-90";

/**
 * Sticky header row applied on `<tr>` — solid chrome matching {@link GoalsColumnHeaders}
 * (no backdrop-blur smear). `top` via `--team-roster-sticky-top` on the scroll wrapper.
 */
const TEAM_ROSTER_HEADER_ROW_STICKY =
  "sticky z-20 top-[var(--team-roster-sticky-top,0px)] border-b border-zinc-700/70 bg-[var(--surface-toolbar)] shadow-[0_1px_0_rgba(0,0,0,0.2)] [&_th]:bg-[var(--surface-toolbar)]";

function TeamRosterManagerInner({
  initialPeople,
  initialProjects,
  hierarchy,
  companies,
  workloads,
  canManageLoginPasswords,
}: TeamRosterManagerProps) {
  const router = useRouter();
  const [loginDialog, setLoginDialog] = useState<{
    person: PersonWithLoginFlag;
    mode: "create" | "resend";
  } | null>(null);
  /** After adding a person, name cell opens in edit mode so the user can type immediately. */
  const [newPersonNameFocusId, setNewPersonNameFocusId] = useState<
    string | null
  >(null);
  const [filterState, setFilterState] = useState<TeamRosterFilterState>(() =>
    emptyTeamRosterFilterState()
  );
  /** Draft text in the search field; filtering uses `filterState.searchQuery` (updated on blur). */
  const [searchInput, setSearchInput] = useState("");
  const [rosterSortMode, setRosterSortMode] =
    useState<TeamRosterSortMode>("autonomy");
  /** When true, founders are excluded from the roster and filter counts. */
  const [hideFounders, setHideFounders] = useState(true);
  /**
   * When false (the default), sensitive roster fields (Est. monthly $ and
   * per-group salary rollups) are not rendered. Toggle in the "…" menu; state
   * resets on each visit (not persisted).
   */
  const [showSensitiveData, setShowSensitiveData] = useState(false);
  const [slackImportOpen, setSlackImportOpen] = useState(false);
  const [slackBulkRefreshRunning, setSlackBulkRefreshRunning] = useState(false);
  /** Local merges from Slack refresh so the table updates before `router.refresh()` completes. */
  const [peopleOverrides, setPeopleOverrides] = useState<Map<string, Person>>(
    () => new Map()
  );
  /** Row being synced from Slack (bulk or row menu). */
  const [slackSyncingPersonId, setSlackSyncingPersonId] = useState<string | null>(
    null
  );
  /** Brief highlight after a successful Slack-driven update. */
  const [slackFlashById, setSlackFlashById] = useState<Record<string, boolean>>(
    {}
  );
  const slackRosterRowRefMap = useRef(new Map<string, HTMLTableRowElement>());
  const [recommendPerson, setRecommendPerson] = useState<Person | null>(null);
  /**
   * After the recommender assigns one or more pilots, we open {@link AssignmentMessageDialog}
   * once per project. `items[0]` is always the active dialog; closing advances the queue.
   */
  const [assignmentQueue, setAssignmentQueue] = useState<{
    newHire: Person;
    dmContextSummary: string;
    buddies: SelectedBuddy[];
    channels: SelectedChannel[];
    items: AssignedPilotProject[];
  } | null>(null);

  const advanceAssignmentQueue = useCallback(() => {
    setAssignmentQueue((q) => {
      if (!q) return null;
      const rest = q.items.slice(1);
      if (rest.length === 0) return null;
      return { ...q, items: rest };
    });
  }, []);

  const { stickyTopPx } = useRoadmapView();
  /** Same rule as {@link RoadmapStickyBelowToolbarGap} — avoids wrong offsets before toolbar measures. */
  const toolbarOffsetPx =
    stickyTopPx > 0 ? stickyTopPx : ROADMAP_TOOLBAR_STICKY_FALLBACK_PX;
  const teamColumnHeaderRef = useRef<HTMLTableRowElement>(null);
  const [teamColumnHeaderPx, setTeamColumnHeaderPx] = useState(40);

  useLayoutEffect(() => {
    const el = teamColumnHeaderRef.current;
    if (!el) return;
    const sync = () => setTeamColumnHeaderPx(Math.round(el.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mergedPeople = useMemo(() => {
    return initialPeople.map((p) => peopleOverrides.get(p.id) ?? p);
  }, [initialPeople, peopleOverrides]);

  /** Clears local Slack merges when `initialPeople` updates (e.g. after `router.refresh()`). */
  useEffect(() => {
    setPeopleOverrides(new Map());
  }, [initialPeople]);

  useLayoutEffect(() => {
    if (!slackSyncingPersonId) return;
    const el = slackRosterRowRefMap.current.get(slackSyncingPersonId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [slackSyncingPersonId]);

  const applySlackRefreshToLocalRoster = useCallback(
    (personId: string, r: RefreshPersonResult) => {
      if (!r.ok) return;
      setPeopleOverrides((prev) => new Map(prev).set(personId, r.person));
      setSlackFlashById((s) => ({ ...s, [personId]: true }));
      window.setTimeout(() => {
        setSlackFlashById((s) => {
          const next = { ...s };
          delete next[personId];
          return next;
        });
      }, 2200);
    },
    []
  );

  const onSkipNewHire = useCallback(async (person: Person) => {
    const updated = await updatePerson(person.id, { skippedFromNewHires: true });
    setPeopleOverrides((prev) => new Map(prev).set(person.id, updated));
    toast.success(`Skipped ${person.name}.`);
  }, []);

  const onSlackMenuRefreshStart = useCallback((personId: string) => {
    setSlackSyncingPersonId(personId);
  }, []);

  const onSlackMenuRefreshResult = useCallback(
    (personId: string, r: RefreshPersonResult) => {
      setSlackSyncingPersonId(null);
      applySlackRefreshToLocalRoster(personId, r);
    },
    [applySlackRefreshToLocalRoster]
  );

  const existingSlackIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of mergedPeople) {
      const h = p.slackHandle?.trim().toUpperCase();
      if (h) s.add(h);
    }
    return s;
  }, [mergedPeople]);

  const peopleWithSlackHandle = useMemo(
    () => mergedPeople.filter((p) => (p.slackHandle ?? "").trim() !== ""),
    [mergedPeople]
  );

  /** Subset of Slack-linked roster rows still missing at least one Slack-sourced field. */
  const peopleWithIncompleteSlackProfile = useMemo(
    () => peopleWithSlackHandle.filter(personHasIncompleteSlackProfile),
    [peopleWithSlackHandle]
  );

  const peopleForRosterView = useMemo(() => {
    if (!hideFounders) return mergedPeople;
    return mergedPeople.filter((p) => !isFounderPerson(p));
  }, [mergedPeople, hideFounders]);

  const workloadByPersonId = useMemo(() => {
    const m = new Map<string, PersonWorkload>();
    for (const w of workloads) m.set(w.person.id, w);
    return m;
  }, [workloads]);

  const todayYmd = useMemo(() => calendarDateTodayLocal(), []);

  const onboardingFilterContext = useMemo<TeamRosterOnboardingContext>(
    () => ({ projects: initialProjects, todayYmd }),
    [initialProjects, todayYmd]
  );

  const peopleForDeptFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "department",
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );
  const peopleForEmpFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "employment",
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );
  const peopleForWlFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "workload",
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );
  const peopleForCoFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "company",
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );
  const peopleForMissFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "missing",
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );
  const peopleForOnboardingFacet = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        "onboarding",
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );

  const filteredPeople = useMemo(
    () =>
      applyTeamRosterFilters(
        peopleForRosterView,
        workloadByPersonId,
        filterState,
        undefined,
        onboardingFilterContext
      ),
    [peopleForRosterView, workloadByPersonId, filterState, onboardingFilterContext]
  );

  const onboardingFilterOptionCount = useMemo(() => {
    return peopleForOnboardingFacet.filter((p) =>
      isActiveOnboardingEmployee(p, initialProjects, todayYmd)
    ).length;
  }, [peopleForOnboardingFacet, initialProjects, todayYmd]);

  const newHiresSorted = useMemo(() => {
    const list = peopleForRosterView.filter(
      (p) =>
        isNewHire(p, todayYmd) &&
        !p.skippedFromNewHires &&
        findPilotProjectsFor(p, initialProjects).length === 0
    );
    return [...list].sort((a, b) => {
      const da = daysSinceJoined(a, todayYmd);
      const db = daysSinceJoined(b, todayYmd);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
  }, [peopleForRosterView, initialProjects, todayYmd]);

  const filterActive = useMemo(
    () => isTeamRosterFilterActive(filterState),
    [filterState]
  );

  const appliedSearchActive =
    normalizeSearch(filterState.searchQuery).length > 0;
  const searchInputHasText =
    normalizeSearch(searchInput).length > 0;
  const showSearchClear = appliedSearchActive || searchInputHasText;

  const teamActiveFilterDimensionCount = useMemo(() => {
    let n = 0;
    if (appliedSearchActive) n++;
    if (filterState.departmentValues.length > 0) n++;
    if (filterState.employmentKinds.length > 0) n++;
    if (filterState.workloadIds.length > 0) n++;
    if (filterState.companyIds.length > 0) n++;
    if (filterState.missingDetailIds.length > 0) n++;
    if (filterState.onboardingOnly) n++;
    return n;
  }, [appliedSearchActive, filterState]);

  const departmentFacetOptions = useMemo(() => {
    const keys = teamRosterDepartmentFilterOptions(mergedPeople);
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
  }, [mergedPeople, peopleForDeptFacet]);

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
    for (const p of mergedPeople) {
      if (isFounderPerson(p)) continue;
      m.set(
        p.id,
        departmentSelectOptions(mergedPeople, p.department ?? "", p.id)
      );
    }
    return m;
  }, [mergedPeople]);

  const maxWorkloadAcrossTeam = useMemo(
    () =>
      workloads.reduce((m, w) => Math.max(m, w.totalProjects), 0),
    [workloads]
  );

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setFilterState(emptyTeamRosterFilterState());
  }, []);

  const onRefreshFromSlack = useCallback(
    async (scope: SlackRefreshScope) => {
      if (slackBulkRefreshRunning) return;
      const targets =
        scope === "incomplete"
          ? peopleWithIncompleteSlackProfile
          : peopleWithSlackHandle;
      if (targets.length === 0) return;

      setSlackBulkRefreshRunning(true);
      const total = targets.length;
      const scopeLabel =
        scope === "incomplete" ? "incomplete profiles" : "everyone";
      const loadId = toast.loading(
        `Syncing from Slack (0 / ${total}) — ${scopeLabel}`,
        { description: "Starting…" }
      );
      let updated = 0;
      let unchanged = 0;
      let failed = 0;
      const failures: { name: string; error: string }[] = [];
      const avatarWarnings: string[] = [];

      try {
        for (let i = 0; i < targets.length; i++) {
          const p = targets[i];
          setSlackSyncingPersonId(p.id);
          toast.loading(
            `Syncing from Slack (${i + 1} / ${total}) — ${scopeLabel}`,
            { id: loadId, description: p.name }
          );
          const r = await refreshPersonFromSlack(p.id, p.slackHandle ?? "");
          setSlackSyncingPersonId(null);
          if (r.ok) {
            updated += 1;
            applySlackRefreshToLocalRoster(p.id, r);
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
        await router.refresh();
        setPeopleOverrides(new Map());

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
        setSlackSyncingPersonId(null);
        setSlackBulkRefreshRunning(false);
      }
    },
    [
      peopleWithSlackHandle,
      peopleWithIncompleteSlackProfile,
      slackBulkRefreshRunning,
      router,
      applySlackRefreshToLocalRoster,
    ]
  );

  if (initialPeople.length === 0) {
    return (
      <div className="min-w-0 min-h-0 max-w-full">
        <SlackImportDialog
          open={slackImportOpen}
          onClose={() => setSlackImportOpen(false)}
          existingSlackIds={existingSlackIds}
        />
        <PageToolbar title="Team" />
        <div className="min-w-0 max-w-full px-6 pb-6">
          <RoadmapStickyBelowToolbarGap />
          <EmptyState
            icon={Users}
            title="No team members yet"
            description="Your team roster is empty. Add your first team member to start tracking roles, departments, autonomy levels, and workloads."
            descriptionClassName="max-w-sm"
            actions={
              <>
                <button
                  type="button"
                  onClick={() =>
                    createPerson({
                      name: "New team member",
                      role: "",
                      department: "",
                      autonomyScore: 0,
                      slackHandle: "",
                      profilePicturePath: "",
                      joinDate: "",
                      welcomeSlackUrl: "",
                      welcomeSlackChannelId: "",
                      email: "",
                      phone: "",
                      estimatedMonthlySalary: 0,
                      employment: "inhouse_salaried",
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  <Plus className="h-4 w-4" />
                  Add your first team member
                </button>
                <button
                  type="button"
                  onClick={() => setSlackImportOpen(true)}
                  className={cn(TEAM_SLACK_ACTION_BUTTON_CLASS, "cursor-pointer")}
                >
                  <SlackLogo alt="" className={TEAM_SLACK_ACTION_ICON_CLASS} />
                  Import from Slack
                </button>
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {recommendPerson ? (
        <RecommendPilotDialog
          open
          onClose={() => setRecommendPerson(null)}
          newHire={recommendPerson}
          people={mergedPeople}
          projects={initialProjects}
          hierarchy={hierarchy}
          onBatchAssigned={(ctx) => {
            setAssignmentQueue({
              newHire: ctx.newHire,
              dmContextSummary: ctx.recommendation.dmContextSummary,
              buddies: ctx.buddies,
              channels: ctx.channels,
              items: ctx.assigned,
            });
            setRecommendPerson(null);
          }}
        />
      ) : null}
      {assignmentQueue && assignmentQueue.items.length > 0 ? (
        <AssignmentMessageDialog
          open
          onClose={advanceAssignmentQueue}
          onBack={() => {
            const hire = assignmentQueue.newHire;
            setAssignmentQueue(null);
            setRecommendPerson(hire);
          }}
          newHire={assignmentQueue.newHire}
          projectId={assignmentQueue.items[0].projectId}
          assignmentKind={assignmentQueue.items[0].assignmentKind}
          dmContextSummary={assignmentQueue.dmContextSummary}
          people={mergedPeople}
          projects={initialProjects}
          hierarchy={hierarchy}
          buddies={assignmentQueue.buddies}
          channels={assignmentQueue.channels}
        />
      ) : null}
      <SlackImportDialog
        open={slackImportOpen}
        onClose={() => setSlackImportOpen(false)}
        existingSlackIds={existingSlackIds}
      />
      {loginDialog ? (
        <SendLoginSlackDialog
          open
          person={loginDialog.person}
          people={mergedPeople}
          mode={loginDialog.mode}
          onClose={() => setLoginDialog(null)}
        />
      ) : null}
      <div className="min-w-0 min-h-0 max-w-full">
      <PageToolbar title="Team">
        <div
          className={cn(
            "group flex min-w-0 flex-1 max-w-[10rem] items-stretch overflow-hidden rounded-md border border-zinc-700 bg-zinc-900/80 transition-[max-width,border-color,background-color] duration-200 ease-out motion-reduce:transition-none",
            "hover:border-zinc-600 hover:bg-zinc-900/95",
            "focus-within:border-zinc-500/45 focus-within:bg-zinc-900/95",
            "has-[input:focus]:max-w-[19.2rem]"
          )}
        >
          <div className="relative flex min-w-0 flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onBlur={(e) =>
                setFilterState((s) => ({
                  ...s,
                  searchQuery: e.currentTarget.value,
                }))
              }
              placeholder="Search name, role, department, email, phone…"
              className={cn(
                "min-w-0 flex-1 border-0 bg-transparent py-1.5 pl-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-0",
                "[&::-webkit-search-cancel-button]:appearance-none",
                showSearchClear ? "pr-1.5" : "pr-3"
              )}
              aria-label="Search team"
              autoComplete="off"
            />
          </div>
          {showSearchClear ? (
            <button
              type="button"
              className="flex shrink-0 cursor-pointer items-center justify-center border-l border-zinc-700/80 px-2.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:bg-zinc-800 focus-visible:ring-0 group-hover:border-l-zinc-600/70 group-focus-within:border-l-zinc-600/70"
              aria-label="Clear search"
              onClick={() => {
                setSearchInput("");
                setFilterState((s) => ({ ...s, searchQuery: "" }));
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[15rem]">
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
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[11rem]">
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
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[12rem]">
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
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[15rem]">
          <CompanyFilterMultiSelect
            companies={companiesForFilter}
            selectedIds={filterState.companyIds}
            onChange={(companyIds) =>
              setFilterState((s) => ({ ...s, companyIds }))
            }
            optionCounts={companyOptionCounts}
          />
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[14rem]">
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
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[11rem]">
          <TeamOnboardingFilterSelect
            value={filterState.onboardingOnly ? "onboarding" : "all"}
            onChange={(v) =>
              setFilterState((s) => ({
                ...s,
                onboardingOnly: v === "onboarding",
              }))
            }
            allCount={peopleForOnboardingFacet.length}
            onboardingCount={onboardingFilterOptionCount}
            disabled={slackBulkRefreshRunning}
          />
        </div>

        {filterActive ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span
              className="rounded-md border border-zinc-700/90 bg-zinc-900/70 px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-400"
              aria-live="polite"
            >
              {teamActiveFilterDimensionCount} filter
              {teamActiveFilterDimensionCount !== 1 ? "s" : ""} active
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-[border-color,background-color,color] duration-150 ease-out motion-reduce:transition-none hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:border-zinc-500/45 focus-visible:ring-1 focus-visible:ring-zinc-400/20 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              title="Clear search and all team filters"
            >
              <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Reset filters
            </button>
          </div>
        ) : null}

        <label
          htmlFor="team-roster-hide-founders"
          className="inline-flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-[border-color,background-color,color] duration-150 ease-out motion-reduce:transition-none hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 focus-within:border-zinc-500/45 focus-within:ring-1 focus-within:ring-zinc-400/20 focus-within:ring-offset-2 focus-within:ring-offset-zinc-950"
        >
          <input
            id="team-roster-hide-founders"
            type="checkbox"
            checked={hideFounders}
            onChange={(e) => setHideFounders(e.target.checked)}
            className="h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-amber-500 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 focus:ring-offset-0"
          />
          <span>Hide founders</span>
        </label>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">
          <TeamRosterViewMenu
            showSensitiveData={showSensitiveData}
            onShowSensitiveDataChange={setShowSensitiveData}
            disabled={slackBulkRefreshRunning}
          />
          <TeamRosterActionsMenu
            onImportFromSlack={() => setSlackImportOpen(true)}
            onRefreshFromSlack={(scope) => void onRefreshFromSlack(scope)}
            slackTargetCount={peopleWithSlackHandle.length}
            incompleteTargetCount={peopleWithIncompleteSlackProfile.length}
            slackBulkRefreshRunning={slackBulkRefreshRunning}
          />
          <TeamRosterGroupingSelect
            value={rosterSortMode}
            onChange={setRosterSortMode}
            disabled={slackBulkRefreshRunning}
          />
        </div>
      </PageToolbar>

      <div className="min-w-0 max-w-full space-y-4 px-6 pb-6">
      <RoadmapStickyBelowToolbarGap />
      {newHiresSorted.length > 0 ? (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-4 space-y-3">
          <h2 className="text-base font-semibold text-zinc-200">New hires</h2>
          <p className="text-xs text-zinc-500">
            First 30 days on the team, still needing a pilot project. Newest
            join dates first. After you assign a pilot, they move to the roster
            below with an Onboarding label.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {newHiresSorted.map((p) => (
              <NewHireRow
                key={p.id}
                person={p}
                projects={initialProjects}
                todayYmd={todayYmd}
                onRecommendPilot={() => setRecommendPerson(p)}
                onSkip={() => onSkipNewHire(p)}
              />
            ))}
          </div>
        </section>
      ) : null}
      {filterActive ? (
        <p className="text-xs text-zinc-500">
          Showing{" "}
          <span className="tabular-nums text-zinc-400">{filteredPeople.length}</span>
          {" of "}
          <span className="tabular-nums text-zinc-400">
            {peopleForRosterView.length}
          </span>{" "}
          members
          {appliedSearchActive ? (
            <>
              {" "}
              matching &quot;{filterState.searchQuery.trim()}&quot;
            </>
          ) : null}
        </p>
      ) : null}

      <div
        className="w-max min-w-full rounded-lg border border-zinc-800/55 bg-zinc-900/45 shadow-sm ring-1 ring-black/25"
        style={
          {
            "--team-roster-sticky-top": `${toolbarOffsetPx + ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX}px`,
            "--team-roster-group-top": `${toolbarOffsetPx + ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX + teamColumnHeaderPx}px`,
          } as CSSProperties
        }
      >
        {filterActive && filteredPeople.length === 0 ? (
          <p className="text-sm text-zinc-500 py-10 px-4 text-center border-b border-zinc-800">
            {appliedSearchActive ? (
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
        <table
          className={cn(
            "w-full text-sm",
            showSensitiveData ? "min-w-[1210px]" : "min-w-[1090px]"
          )}
        >
          <thead>
            <tr
              ref={teamColumnHeaderRef}
              className={cn(
                "text-[11px] font-medium uppercase tracking-wider text-zinc-400",
                TEAM_ROSTER_HEADER_ROW_STICKY
              )}
            >
              <th
                className="text-left px-3 py-3 font-medium min-w-[240px]"
                scope="col"
              >
                Member
              </th>
              <th className="text-left px-3 py-3 font-medium min-w-[120px]">
                Department
              </th>
              <th className="text-left px-3 py-3 font-medium whitespace-nowrap">
                Team
              </th>
              <th
                className="text-left px-3 py-3 font-medium whitespace-nowrap"
                scope="col"
                title="Join date as compact tenure; cake badge when a work anniversary (1y, 2y, …) is within 30 days"
              >
                Tenure
              </th>
              {showSensitiveData ? (
                <th
                  className="text-left px-3 py-3 font-medium whitespace-nowrap min-w-[7.5rem]"
                  scope="col"
                >
                  Est. monthly ($)
                </th>
              ) : null}
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
                className="text-left px-3 py-3 font-medium min-w-[10rem]"
                scope="col"
              >
                Login
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
                    "sticky z-10 top-[var(--team-roster-group-top,0px)] bg-[var(--surface-group-header)] shadow-[0_2px_4px_-2px_rgba(0,0,0,0.35)]"
                  )}
                >
                  <td
                    colSpan={showSensitiveData ? 12 : 11}
                    className="px-3 py-2.5"
                  >
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
                    {group.kind !== "founders" && showSensitiveData ? (
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
                    ref={(el) => {
                      if (el) {
                        slackRosterRowRefMap.current.set(person.id, el);
                      } else {
                        slackRosterRowRefMap.current.delete(person.id);
                      }
                    }}
                    className={cn(
                      visual.dataRow,
                      "border-b border-zinc-800/60 group align-middle",
                      slackSyncingPersonId === person.id &&
                        "bg-amber-500/[0.09] shadow-[inset_0_0_0_1px_rgba(245,158,11,0.4)]",
                      slackFlashById[person.id] &&
                        "bg-emerald-500/[0.12] transition-colors duration-500"
                    )}
                  >
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-3 min-w-0 max-w-[320px]">
                        <div className="relative shrink-0">
                          <LocalImageField
                            variant="person"
                            entityId={person.id}
                            path={person.profilePicturePath ?? ""}
                          />
                          {isFounderPerson(person) ? (
                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[5] flex justify-end items-end pb-0.5">
                              <div className="translate-x-[1.5em]">
                                <OwnerAutonomyBadge
                                  person={person}
                                  size="roster"
                                  anchored={false}
                                  ringClassName="ring-zinc-950"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[6] flex justify-end items-end pb-0.5">
                              <div
                                className={cn(
                                  "pointer-events-auto w-max translate-x-[1.5em]",
                                  "[&_button]:justify-end [&_button]:pl-0.5 [&_button]:pr-5",
                                  "[&_button]:cursor-pointer [&_button]:rounded-full [&_button]:transition-[box-shadow,filter,transform]",
                                  "[&_button:hover]:shadow-[0_0_0_2px_rgba(52,211,153,0.45)]",
                                  "[&_button:hover]:brightness-110",
                                  "[&_button:focus-visible]:shadow-[0_0_0_2px_rgba(52,211,153,0.55)]",
                                  "[&_button:focus-visible]:outline-none",
                                )}
                              >
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
                                  formatDisplay={(val, ctx) =>
                                    ctx?.role === "option"
                                      ? teamRosterAutonomyMenuOption(val)
                                      : (
                                          <OwnerAutonomyBadge
                                            person={person}
                                            size="roster"
                                            anchored={false}
                                            ringClassName="ring-zinc-950"
                                          />
                                        )
                                  }
                                  displayTitle="Autonomy level (0–5) — click to change"
                                  overlaySelectQuiet
                                  overlaySelectMenuMinWidth={300}
                                  className="group/status w-max min-w-0"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-px">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <InlineEditCell
                              value={person.name}
                              onSave={(name) => updatePerson(person.id, { name })}
                              displayClassName={ROADMAP_ENTITY_TITLE_DISPLAY_CLASS}
                              collapsedButtonClassName="!min-h-0 !py-0 leading-snug"
                              startInEditMode={
                                person.id === newPersonNameFocusId
                              }
                            />
                            {!isFounderPerson(person) &&
                            isActiveOnboardingEmployee(
                              person,
                              initialProjects,
                              todayYmd
                            ) ? (
                              <span
                                className="inline-flex shrink-0 items-center rounded-md border border-emerald-500/55 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400/25"
                                title="New hire with an onboarding pilot project"
                              >
                                Onboarding
                              </span>
                            ) : null}
                          </div>
                          <InlineEditCell
                            value={person.role}
                            onSave={(role) => updatePerson(person.id, { role })}
                            displayClassName="text-zinc-400"
                            collapsedButtonClassName="!min-h-0 !py-0 leading-snug"
                          />
                        </div>
                      </div>
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
                    <td className="px-3 py-2 align-middle max-w-[11.5rem] min-w-0 whitespace-nowrap">
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
                          formatDisplay={(v) => {
                            const upcoming =
                              v.trim() === ""
                                ? null
                                : getUpcomingJoinAnniversaryWithin(
                                    v.trim(),
                                    30
                                  );
                            return (
                              <span
                                className={cn(
                                  "inline-flex min-w-0 items-center",
                                  upcoming ? "gap-2" : "gap-1.5",
                                )}
                              >
                                <span
                                  className={cn(
                                    "shrink-0 tabular-nums",
                                    upcoming &&
                                      "font-medium text-zinc-100",
                                  )}
                                >
                                  {formatTeamTenureFromJoinYmd(v)}
                                </span>
                                {upcoming ? (
                                  <span
                                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-50 shadow-sm ring-1 ring-amber-300/30"
                                    title={
                                      upcoming.daysUntil === 0
                                        ? `${upcoming.yearOrdinal}-year work anniversary today — ${formatCalendarDateHint(upcoming.anniversaryYmd)}`
                                        : `${upcoming.yearOrdinal}-year work anniversary in ${upcoming.daysUntil}d — ${formatCalendarDateHint(upcoming.anniversaryYmd)}`
                                    }
                                    aria-label={
                                      upcoming.daysUntil === 0
                                        ? `${upcoming.yearOrdinal}-year work anniversary today`
                                        : `${upcoming.yearOrdinal}-year work anniversary in ${upcoming.daysUntil} days`
                                    }
                                  >
                                    <Cake
                                      className="h-3.5 w-3.5 shrink-0 text-amber-200"
                                      strokeWidth={2}
                                      aria-hidden
                                    />
                                    <span>{upcoming.yearOrdinal}y</span>
                                  </span>
                                ) : null}
                              </span>
                            );
                          }}
                          displayTitle={
                            person.joinDate.trim()
                              ? `${formatCalendarDateHint(person.joinDate)} — click to change join date`
                              : "Join date — click to set"
                          }
                          displayClassName="text-zinc-300 tabular-nums"
                        />
                      )}
                    </td>
                    {showSensitiveData ? (
                    <td className="px-3 py-2 align-middle text-left max-w-[9rem]">
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
                            return formatUsdCompactK(n);
                          }}
                          placeholder="—"
                          displayTitle="Estimated monthly salary (USD)"
                          displayClassName="text-zinc-300 tabular-nums"
                          className="text-left"
                        />
                      )}
                    </td>
                    ) : null}
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
                                () => router.refresh(),
                                {
                                  onStart: () =>
                                    onSlackMenuRefreshStart(person.id),
                                  onResult: (r) =>
                                    onSlackMenuRefreshResult(person.id, r),
                                }
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
                    <td className="px-3 py-2 align-middle max-w-[12rem]">
                      {(() => {
                        const p = person as PersonWithLoginFlag;
                        const hasEmail = (p.email ?? "").trim() !== "";
                        const hasSlackId = (p.slackHandle ?? "").trim() !== "";
                        if (!canManageLoginPasswords) {
                          return (
                            <span className="text-zinc-600" aria-hidden>
                              —
                            </span>
                          );
                        }
                        if (!hasEmail) {
                          return (
                            <span
                              className="text-xs text-zinc-600"
                              title="Add an email in the Email column first"
                            >
                              Set email first
                            </span>
                          );
                        }
                        if (p.loginPasswordSet) {
                          /** Founders: login actions live in the row **…** menu so we don’t stack two menus. */
                          const showLoginMenuInLoginColumn =
                            !isFounderPerson(p);
                          return (
                            <div className="flex items-center gap-1.5">
                              <Lock
                                className="h-3.5 w-3.5 shrink-0 text-emerald-500/90"
                                aria-hidden
                              />
                              <span className="text-xs font-medium text-zinc-400">
                                Active
                              </span>
                              {showLoginMenuInLoginColumn ? (
                                <LoginRowMenu
                                  person={p}
                                  onSendNewPassword={() =>
                                    setLoginDialog({
                                      person: p,
                                      mode: "resend",
                                    })
                                  }
                                />
                              ) : null}
                            </div>
                          );
                        }
                        return (
                          <button
                            type="button"
                            className="rounded border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!hasSlackId}
                            title={
                              hasSlackId
                                ? "Create a login and send the password on Slack"
                                : "Add this person's Slack user ID first — the password is delivered by Slack group DM"
                            }
                            onClick={() =>
                              setLoginDialog({ person: p, mode: "create" })
                            }
                          >
                            Create Login
                          </button>
                        );
                      })()}
                    </td>
                    <td className="py-2 pl-2 pr-4 align-middle">
                      <TeamRosterRowMenu
                        person={person}
                        onSlackRefreshStart={onSlackMenuRefreshStart}
                        onSlackRefreshResult={onSlackMenuRefreshResult}
                        {...(!isFounderPerson(person)
                          ? {
                              onOnboardEmployee: () =>
                                setRecommendPerson(person),
                            }
                          : {})}
                        {...(canManageLoginPasswords &&
                        isFounderPerson(person) &&
                        (person as PersonWithLoginFlag).loginPasswordSet
                          ? {
                              canManageLoginPasswords: true,
                              loginPasswordSet: true,
                              onSendNewPassword: () =>
                                setLoginDialog({
                                  person: person as PersonWithLoginFlag,
                                  mode: "resend",
                                }),
                            }
                          : {})}
                      />
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

      <div className="pt-3">
        <button
          type="button"
          onClick={async () => {
            const person = await createPerson({
              name: "New team member",
              role: "",
              department: "",
              autonomyScore: 0,
              slackHandle: "",
              profilePicturePath: "",
              joinDate: "",
              welcomeSlackUrl: "",
              welcomeSlackChannelId: "",
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

export function TeamRosterManager(props: TeamRosterManagerProps) {
  return (
    <RoadmapViewProvider>
      <TeamRosterManagerInner {...props} />
    </RoadmapViewProvider>
  );
}
