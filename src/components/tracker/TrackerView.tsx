"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Company, CompanyWithGoals, Person, Priority } from "@/lib/types/tracker";
import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";
import { CompanySection } from "./CompanySection";
import { CompanyFilterMultiSelect } from "./CompanyFilterMultiSelect";
import { DueDateFilterSelect } from "./DueDateFilterSelect";
import { OwnerFilterMultiSelect } from "./OwnerFilterMultiSelect";
import { StatusTagFilterMultiSelect } from "./StatusTagFilterMultiSelect";
import { PriorityFilterMultiSelect } from "./PriorityFilterMultiSelect";
import { StatusEnumFilterMultiSelect } from "./StatusEnumFilterMultiSelect";
import {
  TrackerExpandProvider,
  type TrackerExpandPreset,
} from "./tracker-expand-context";
import { RoadmapViewProvider } from "./roadmap-view-context";
import { RoadmapStickyBelowToolbarGap } from "./RoadmapStickyBelowToolbarGap";
import { PageToolbar } from "./PageToolbar";
import { EmptyState } from "./EmptyState";
import { RoadmapExpandModeSelect } from "./RoadmapExpandModeSelect";
import {
  Crosshair,
  FilterX,
  Map as MapIcon,
  Search,
  User,
  X,
} from "lucide-react";
import { sortPeopleLikeTeamRoster } from "@/lib/autonomyRoster";
import { groupCompaniesByRevenueTier } from "@/lib/companyRevenueTiers";
import {
  filterTrackerHierarchy,
  filterTrackerHierarchyByCompanyIds,
  filterTrackerHierarchyByDueDate,
  filterTrackerHierarchyByOwner,
  filterTrackerHierarchyByPriority,
  filterTrackerHierarchyByStatusEnum,
  filterTrackerHierarchyByStatusTags,
  filterTrackerHierarchyHideDoneProjects,
  normalizeTrackerSearchQuery,
  type DueDateFilterId,
  DUE_DATE_FILTER_OPTIONS,
  type TrackerStatusTagId,
} from "@/lib/tracker-search-filter";
import {
  isOwnerFilterDepartmentToken,
  isOwnerFilterEmploymentToken,
  ownerFilterDepartmentLabel,
  ownerFilterEmploymentLabel,
} from "@/lib/owner-filter";
import { firstNameFromFullName } from "@/lib/personDisplayName";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  buildRoadmapHref,
  emptyRoadmapFilters,
  type RoadmapInitialFilters,
} from "@/lib/roadmap-query";
import { calendarDateTodayLocal } from "@/lib/relativeCalendarDate";

const ROADMAP_FOCUS_MODE_STORAGE_KEY = "ecc-roadmap-focus-mode";
const ROADMAP_EXPAND_PRESET_STORAGE_KEY = "ecc-roadmap-expand-preset";
const ROADMAP_SEARCH_DEBOUNCE_MS = 180;
function parseStoredExpandPreset(raw: string): TrackerExpandPreset | undefined {
  if (raw === "") return null;
  if (
    raw === "collapse" ||
    raw === "goals_only" ||
    raw === "goals_and_projects" ||
    raw === "goals_projects_milestones"
  ) {
    return raw;
  }
  return undefined;
}

interface TrackerViewProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
  /** URL query `focusGoal` + `focusProject`: expand one project. */
  initialFocus?: { goalId: string; projectId: string };
  /** URL query params: pre-fill Roadmap filters (e.g. bookmarks). */
  initialFilters?: RoadmapInitialFilters;
  /** Signed-in user — profile shortcut next to Owners filter. */
  mePersonId?: string;
  meProfilePicturePath?: string;
}

export function TrackerView({
  hierarchy,
  people,
  initialFocus,
  initialFilters: initialFiltersProp,
  mePersonId,
  meProfilePicturePath,
}: TrackerViewProps) {
  const initialFilters = initialFiltersProp ?? emptyRoadmapFilters();

  const [searchQuery, setSearchQuery] = useState(
    () => initialFilters.searchQuery
  );
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(
    () => initialFilters.searchQuery
  );
  const [companyFilterIds, setCompanyFilterIds] = useState<string[]>(
    () => initialFilters.companyFilterIds
  );
  const [ownerFilterIds, setOwnerFilterIds] = useState<string[]>(
    () => initialFilters.ownerFilterIds
  );
  const [statusTagFilterIds, setStatusTagFilterIds] = useState<
    TrackerStatusTagId[]
  >(() => [...initialFilters.statusTagFilterIds]);
  const [dueDateFilterIds, setDueDateFilterIds] = useState<DueDateFilterId[]>(
    () => [...initialFilters.dueDateFilterIds]
  );
  const [priorityFilterIds, setPriorityFilterIds] = useState<string[]>(
    () => initialFilters.priorityFilterIds
  );
  const [statusEnumFilterIds, setStatusEnumFilterIds] = useState<string[]>(
    () => initialFilters.statusEnumFilterIds
  );
  /** When false, project rows with status Done are hidden. */
  const [showCompletedProjects, setShowCompletedProjects] = useState(true);
  /** Increment so goal/project rows re-apply the tree expansion preset */
  const [bulkTick, setBulkTick] = useState(1);
  /** Tree expansion dropdown: default Custom (manual expansion). */
  const [expandPreset, setExpandPreset] = useState<TrackerExpandPreset>(null);
  /** Focus mode — default off; restored from `localStorage` after mount */
  const [focusMode, setFocusMode] = useState(false);
  const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [focusEnforceTick, setFocusEnforceTick] = useState(0);
  const focusProjectMode = focusMode;
  /** After reading Roadmap toolbar prefs from localStorage — avoids persisting before restore */
  const [roadmapToolbarPrefsHydrated, setRoadmapToolbarPrefsHydrated] =
    useState(false);

  const allGoals = useMemo(
    () => hierarchy.flatMap((c) => c.goals),
    [hierarchy]
  );
  const allCompanies = useMemo(
    (): Company[] => hierarchy.map(({ goals: _goals, ...co }) => co),
    [hierarchy]
  );

  const todayYmd = useMemo(() => calendarDateTodayLocal(), []);
  const pilotFilterContext = useMemo(
    () => ({ people, todayYmd }),
    [people, todayYmd]
  );

  const searchActive = normalizeTrackerSearchQuery(searchQuery).length > 0;
  const companyFilterActive = companyFilterIds.length > 0;
  const ownerFilterActive = ownerFilterIds.length > 0;
  const statusTagFilterActive = statusTagFilterIds.length > 0;
  const dueDateFilterActive = dueDateFilterIds.length > 0;
  const priorityFilterActive = priorityFilterIds.length > 0;
  const statusEnumFilterActive = statusEnumFilterIds.length > 0;
  const filterActive =
    searchActive ||
    companyFilterActive ||
    ownerFilterActive ||
    statusTagFilterActive ||
    dueDateFilterActive ||
    priorityFilterActive ||
    statusEnumFilterActive;

  const activeFilterDimensionCount = useMemo(() => {
    let n = 0;
    if (searchActive) n++;
    if (companyFilterActive) n++;
    if (ownerFilterActive) n++;
    if (priorityFilterActive) n++;
    if (statusEnumFilterActive) n++;
    if (statusTagFilterActive) n++;
    if (dueDateFilterActive) n++;
    return n;
  }, [
    searchActive,
    companyFilterActive,
    ownerFilterActive,
    priorityFilterActive,
    statusEnumFilterActive,
    statusTagFilterActive,
    dueDateFilterActive,
  ]);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setCompanyFilterIds([]);
    setOwnerFilterIds([]);
    setStatusTagFilterIds([]);
    setDueDateFilterIds([]);
    setPriorityFilterIds([]);
    setStatusEnumFilterIds([]);
    toast.message("Filters cleared", { duration: 2200 });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, ROADMAP_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  /** Keep the address bar in sync for shareable bookmarks (no full navigation). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const fg = sp.get("focusGoal")?.trim();
    const fp = sp.get("focusProject")?.trim();
    const focus =
      fg && fp ? { goalId: fg, projectId: fp } : undefined;

    const next = buildRoadmapHref({
      focus,
      companyFilterIds,
      ownerFilterIds,
      statusTagFilterIds,
      dueDateFilterIds,
      priorityFilterIds,
      statusEnumFilterIds,
      searchQuery,
    });

    const cur = `${window.location.pathname}${window.location.search}`;
    if (cur === next) return;
    window.history.replaceState(null, "", next);
  }, [
    companyFilterIds,
    ownerFilterIds,
    statusTagFilterIds,
    dueDateFilterIds,
    priorityFilterIds,
    statusEnumFilterIds,
    searchQuery,
  ]);

  useEffect(() => {
    let expandPresetFromStorage = false;
    let focusModeFromStorage = false;
    try {
      const raw = localStorage.getItem(ROADMAP_FOCUS_MODE_STORAGE_KEY);
      if (raw === "1" || raw === "true") {
        setFocusMode(true);
        focusModeFromStorage = true;
      }

      const rawExpand = localStorage.getItem(ROADMAP_EXPAND_PRESET_STORAGE_KEY);
      if (rawExpand !== null) {
        const parsed = parseStoredExpandPreset(rawExpand);
        if (parsed !== undefined) {
          setExpandPreset(parsed);
          expandPresetFromStorage = true;
        }
      }

    } catch {
      /* ignore quota / private mode */
    }
    /*
      Fold bulkTick/focusEnforceTick bumps from restored prefs AND initialFocus
      into a single state-update batch alongside roadmapToolbarPrefsHydrated so
      children mount exactly once with the correct preset/focus state. Prevents
      the "everything expands, then collapses a frame later" flash on load.
    */
    const hasInitialFocus = Boolean(
      initialFocus?.goalId && initialFocus?.projectId
    );
    if (hasInitialFocus) {
      setFocusMode(true);
      setFocusedGoalId(initialFocus!.goalId);
      setFocusedProjectId(initialFocus!.projectId);
    }
    if (expandPresetFromStorage || hasInitialFocus) {
      setBulkTick((t) => t + 1);
    }
    if (focusModeFromStorage || hasInitialFocus) {
      setFocusEnforceTick((x) => x + 1);
    }
    setRoadmapToolbarPrefsHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roadmapToolbarPrefsHydrated) return;
    try {
      localStorage.setItem(
        ROADMAP_FOCUS_MODE_STORAGE_KEY,
        focusMode ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
  }, [focusMode, roadmapToolbarPrefsHydrated]);

  useEffect(() => {
    if (!roadmapToolbarPrefsHydrated) return;
    try {
      localStorage.setItem(
        ROADMAP_EXPAND_PRESET_STORAGE_KEY,
        expandPreset ?? ""
      );
    } catch {
      /* ignore */
    }
  }, [expandPreset, roadmapToolbarPrefsHydrated]);

  const onExpandPresetChange = useCallback((next: TrackerExpandPreset) => {
    setFocusedGoalId(null);
    setFocusedProjectId(null);
    setExpandPreset(next);
    setBulkTick((t) => t + 1);
  }, []);

  const onFocusModeToggle = useCallback(() => {
    if (filterActive) return;
    setFocusedGoalId(null);
    setFocusedProjectId(null);
    if (focusMode) {
      setFocusMode(false);
      setBulkTick((t) => t + 1);
    } else {
      setFocusMode(true);
      setFocusEnforceTick((x) => x + 1);
    }
  }, [filterActive, focusMode]);

  useEffect(() => {
    if (!filterActive) return;
    setFocusedGoalId(null);
    setFocusedProjectId(null);
    setFocusMode(false);
  }, [filterActive]);

  /** Focus mode is single-branch drill-in; bulk presets that expand the whole tree fight that — force Goals only while Focus is on. */
  const effectiveExpandPreset = useMemo<TrackerExpandPreset>(
    () => (focusMode ? "goals_only" : expandPreset),
    [focusMode, expandPreset]
  );

  const bulkValue = useMemo(
    () => ({
      bulkTick,
      expandPreset: effectiveExpandPreset,
      focusProjectMode,
      focusedGoalId,
      setFocusedGoalId,
      focusedProjectId,
      setFocusedProjectId,
      focusEnforceTick,
    }),
    [
      bulkTick,
      effectiveExpandPreset,
      focusProjectMode,
      focusedGoalId,
      focusedProjectId,
      focusEnforceTick,
    ]
  );

  const peopleSorted = useMemo(
    () => sortPeopleLikeTeamRoster(people),
    [people]
  );

  const mePerson = useMemo(
    () => (mePersonId ? people.find((p) => p.id === mePersonId) : undefined),
    [people, mePersonId]
  );

  const meAvatarSrc = useMemo(
    () =>
      (meProfilePicturePath?.trim() || mePerson?.profilePicturePath?.trim()) ||
      null,
    [meProfilePicturePath, mePerson?.profilePicturePath]
  );

  const myAssignmentsShortcutActive = useMemo(
    () =>
      Boolean(
        mePersonId &&
          ownerFilterIds.length === 1 &&
          ownerFilterIds[0] === mePersonId
      ),
    [mePersonId, ownerFilterIds]
  );

  const toggleMyAssignmentsOwnerFilter = useCallback(() => {
    if (!mePersonId) return;
    setOwnerFilterIds((prev) => {
      const onlyMe = prev.length === 1 && prev[0] === mePersonId;
      return onlyMe ? [] : [mePersonId];
    });
  }, [mePersonId]);

  const meInitials = useMemo(() => {
    const n = mePerson?.name?.trim() ?? "";
    if (!n) return "";
    const parts = n.split(/\s+/).filter(Boolean);
    if (
      parts.length >= 2 &&
      parts[0][0] &&
      parts[1]![0]
    ) {
      return (parts[0][0] + parts[1]![0]).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  }, [mePerson?.name]);

  const ownerWorkloadMap = useMemo(() => {
    const m = new Map<string, { total: number; p0: number; p1: number }>();
    for (const company of hierarchy) {
      for (const goal of company.goals) {
        for (const project of goal.projects) {
          if (project.isMirror) continue;
          if (!project.ownerId) continue;
          let entry = m.get(project.ownerId);
          if (!entry) {
            entry = { total: 0, p0: 0, p1: 0 };
            m.set(project.ownerId, entry);
          }
          entry.total++;
          if (project.priority === "P0") entry.p0++;
          else if (project.priority === "P1") entry.p1++;
        }
      }
    }
    return m;
  }, [hierarchy]);

  /** Same order as Companies page: MRR tier (largest first), then revenue desc within tier. */
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

  const hierarchyAfterCompany = useMemo(
    () =>
      filterTrackerHierarchyByCompanyIds(
        hierarchy,
        companyFilterIds.length > 0 ? companyFilterIds : null
      ),
    [hierarchy, companyFilterIds]
  );

  const hierarchyAfterOwner = useMemo(
    () =>
      filterTrackerHierarchyByOwner(
        hierarchyAfterCompany,
        ownerFilterIds.length > 0 ? ownerFilterIds : null,
        people
      ),
    [hierarchyAfterCompany, ownerFilterIds, people]
  );

  const hierarchyAfterPriority = useMemo(
    () =>
      filterTrackerHierarchyByPriority(
        hierarchyAfterOwner,
        priorityFilterIds.length > 0 ? priorityFilterIds : null
      ),
    [hierarchyAfterOwner, priorityFilterIds]
  );

  const hierarchyAfterStatusEnum = useMemo(
    () =>
      filterTrackerHierarchyByStatusEnum(
        hierarchyAfterPriority,
        statusEnumFilterIds.length > 0 ? statusEnumFilterIds : null
      ),
    [hierarchyAfterPriority, statusEnumFilterIds]
  );

  /** Faceted counts for Signals: same pipeline as the main view but without status-tag filtering. */
  const hierarchyForStatusTagCounts = useMemo(
    () =>
      filterTrackerHierarchyHideDoneProjects(
        hierarchyAfterStatusEnum,
        !showCompletedProjects
      ),
    [hierarchyAfterStatusEnum, showCompletedProjects]
  );

  const hierarchyAfterStatusTags = useMemo(
    () =>
      filterTrackerHierarchyByStatusTags(
        hierarchyAfterStatusEnum,
        statusTagFilterIds.length > 0 ? statusTagFilterIds : null,
        pilotFilterContext
      ),
    [hierarchyAfterStatusEnum, statusTagFilterIds, pilotFilterContext]
  );

  const hierarchyAfterHideDone = useMemo(
    () =>
      filterTrackerHierarchyHideDoneProjects(
        hierarchyAfterStatusTags,
        !showCompletedProjects
      ),
    [hierarchyAfterStatusTags, showCompletedProjects]
  );

  const hierarchyAfterDueDate = useMemo(
    () =>
      filterTrackerHierarchyByDueDate(
        hierarchyAfterHideDone,
        dueDateFilterIds.length > 0 ? dueDateFilterIds : null
      ),
    [hierarchyAfterHideDone, dueDateFilterIds]
  );

  const filteredHierarchy = useMemo(
    () =>
      filterTrackerHierarchy(
        hierarchyAfterDueDate,
        people,
        debouncedSearchQuery
      ),
    [hierarchyAfterDueDate, people, debouncedSearchQuery]
  );

  const companyFilterLabel = useMemo(() => {
    if (companyFilterIds.length === 0) return "";
    const byId = new Map(hierarchy.map((c) => [c.id, c.name]));
    return companyFilterIds.map((id) => byId.get(id) ?? id).join(", ");
  }, [hierarchy, companyFilterIds]);

  const ownerFilterLabel = useMemo(() => {
    if (ownerFilterIds.length === 0) return "";
    const byId = new Map(
      people.map((p) => [p.id, firstNameFromFullName(p.name)])
    );
    return ownerFilterIds
      .map((id) => {
        if (isOwnerFilterDepartmentToken(id)) {
          return ownerFilterDepartmentLabel(id) ?? id;
        }
        if (isOwnerFilterEmploymentToken(id)) {
          return ownerFilterEmploymentLabel(id) ?? id;
        }
        return byId.get(id) ?? id;
      })
      .join(", ");
  }, [people, ownerFilterIds]);

  const statusTagFilterLabel = useMemo(() => {
    if (statusTagFilterIds.length === 0) return "";
    const labels: Record<TrackerStatusTagId, string> = {
      at_risk: "Flagged at risk",
      spotlight: "Spotlighted",
      unassigned: "Unassigned",
      zombie: "Stuck in progress",
      stalled: "Needs kickoff",
      new_hire_pilot: "New hire pilot",
    };
    return statusTagFilterIds.map((id) => labels[id]).join(", ");
  }, [statusTagFilterIds]);

  const priorityFilterLabel = useMemo(
    () =>
      priorityFilterIds.length === 0
        ? ""
        : priorityFilterIds
            .map((id) => PRIORITY_MENU_LABEL[id as Priority] ?? id)
            .join(", "),
    [priorityFilterIds]
  );

  const statusEnumFilterLabel = useMemo(
    () => (statusEnumFilterIds.length === 0 ? "" : statusEnumFilterIds.join(", ")),
    [statusEnumFilterIds]
  );

  const dueDateFilterLabelById = useMemo(
    () => new Map(DUE_DATE_FILTER_OPTIONS.map((o) => [o.id, o.label])),
    []
  );

  const dueDateFilterLabel = useMemo(() => {
    if (dueDateFilterIds.length === 0) return "";
    return dueDateFilterIds
      .map((id) => dueDateFilterLabelById.get(id) ?? id)
      .join(", ");
  }, [dueDateFilterIds, dueDateFilterLabelById]);

  const searchFilterWithClause = useMemo(() => {
    const parts: string[] = [];
    if (companyFilterActive) {
      parts.push(`company filter (${companyFilterLabel})`);
    }
    if (ownerFilterActive) {
      parts.push(`owner filter (${ownerFilterLabel})`);
    }
    if (priorityFilterActive) {
      parts.push(`priority (${priorityFilterLabel})`);
    }
    if (statusEnumFilterActive) {
      parts.push(`delivery status (${statusEnumFilterLabel})`);
    }
    if (statusTagFilterActive) {
      parts.push(`signals (${statusTagFilterLabel})`);
    }
    if (dueDateFilterActive) {
      parts.push(`due date (${dueDateFilterLabel})`);
    }
    if (parts.length === 0) return "";
    return ` with ${parts.join(" and ")}`;
  }, [
    companyFilterActive,
    ownerFilterActive,
    priorityFilterActive,
    statusEnumFilterActive,
    statusTagFilterActive,
    dueDateFilterActive,
    companyFilterLabel,
    ownerFilterLabel,
    priorityFilterLabel,
    statusEnumFilterLabel,
    statusTagFilterLabel,
    dueDateFilterLabel,
  ]);

  const nonSearchForClause = useMemo(() => {
    const parts: string[] = [];
    if (companyFilterActive) parts.push(`companies (${companyFilterLabel})`);
    if (ownerFilterActive) parts.push(`owners (${ownerFilterLabel})`);
    if (priorityFilterActive) parts.push(`priority (${priorityFilterLabel})`);
    if (statusEnumFilterActive) {
      parts.push(`delivery status (${statusEnumFilterLabel})`);
    }
    if (statusTagFilterActive) parts.push(`signals (${statusTagFilterLabel})`);
    if (dueDateFilterActive) parts.push(`due date (${dueDateFilterLabel})`);
    if (parts.length === 0) return "";
    return ` for ${parts.join(" and ")}`;
  }, [
    companyFilterActive,
    ownerFilterActive,
    priorityFilterActive,
    statusEnumFilterActive,
    statusTagFilterActive,
    dueDateFilterActive,
    companyFilterLabel,
    ownerFilterLabel,
    priorityFilterLabel,
    statusEnumFilterLabel,
    statusTagFilterLabel,
    dueDateFilterLabel,
  ]);

  return (
    <TrackerExpandProvider value={bulkValue}>
      <RoadmapViewProvider>
      <PageToolbar title="Roadmap">
        <div className="relative flex-1 min-w-0 max-w-[10rem] transition-[max-width] duration-200 ease-out motion-reduce:transition-none focus-within:max-w-[19.2rem]">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className={cn(
              "w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-900/80 py-1.5 pl-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
              "[&::-webkit-search-cancel-button]:appearance-none",
              searchActive ? "pr-8" : "pr-3"
            )}
            aria-label="Search tracker"
            autoComplete="off"
          />
          {searchActive ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              aria-label="Clear search"
              onClick={() => {
                setSearchQuery("");
                setDebouncedSearchQuery("");
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[15rem]">
          <CompanyFilterMultiSelect
            companies={companiesForFilter}
            selectedIds={companyFilterIds}
            onChange={setCompanyFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[9.5rem]">
          <PriorityFilterMultiSelect
            selectedIds={priorityFilterIds}
            onChange={setPriorityFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[14rem]">
          <StatusEnumFilterMultiSelect
            selectedIds={statusEnumFilterIds}
            onChange={setStatusEnumFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[12.5rem]">
          <StatusTagFilterMultiSelect
            hierarchy={hierarchyForStatusTagCounts}
            people={people}
            todayYmd={todayYmd}
            selectedIds={statusTagFilterIds}
            onChange={setStatusTagFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[12.5rem]">
          <DueDateFilterSelect
            hierarchy={hierarchyAfterHideDone}
            selectedIds={dueDateFilterIds}
            onChange={setDueDateFilterIds}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:max-w-[17rem]">
          <div className="min-w-0 min-h-0 flex-1">
            <OwnerFilterMultiSelect
              people={peopleSorted}
              selectedIds={ownerFilterIds}
              onChange={setOwnerFilterIds}
            />
          </div>
          {mePersonId ? (
            <button
              type="button"
              onClick={toggleMyAssignmentsOwnerFilter}
              title={
                myAssignmentsShortcutActive
                  ? "Clear owner filter"
                  : "Show goals and projects assigned to you"
              }
              aria-label={
                myAssignmentsShortcutActive
                  ? "Clear owner filter for my assignments"
                  : "Filter owners to my assignments only"
              }
              aria-pressed={myAssignmentsShortcutActive}
              className={cn(
                "group relative shrink-0 rounded-full p-px transition-[box-shadow,ring-color] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
                myAssignmentsShortcutActive
                  ? "shadow-[0_0_0_1px_rgba(16,185,129,0.55)] ring-1 ring-emerald-500/45"
                  : "ring-1 ring-zinc-600 hover:ring-zinc-500 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-zinc-400 transition-colors",
                  "group-hover:bg-zinc-700 group-hover:text-zinc-300"
                )}
              >
                {meAvatarSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={meAvatarSrc}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : meInitials ? (
                  <span className="text-[9px] font-semibold tabular-nums leading-none text-zinc-300">
                    {meInitials}
                  </span>
                ) : (
                  <User className="h-3 w-3 opacity-90" aria-hidden />
                )}
              </span>
            </button>
          ) : null}
        </div>
        {filterActive ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span
              className="rounded-md border border-zinc-700/90 bg-zinc-900/70 px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-400"
              aria-live="polite"
            >
              {activeFilterDimensionCount} filter
              {activeFilterDimensionCount !== 1 ? "s" : ""} active
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              title="Clear search and all filters"
            >
              <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Reset filters
            </button>
          </div>
        ) : null}
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 shrink-0 ml-auto">
          <div className="relative min-w-[10.5rem] shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={showCompletedProjects}
              aria-label={
                showCompletedProjects
                  ? "Showing completed goals, projects, and milestones — click to hide"
                  : "Hiding completed goals, projects, and milestones — click to show"
              }
              title="When off: hides Done milestones, Done projects (except projects with no milestones), and goals that only have completed work. Goals with no projects always stay visible."
              onClick={() => setShowCompletedProjects((v) => !v)}
              className={cn(
                "flex min-h-[2.25rem] w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 motion-reduce:transition-none",
                showCompletedProjects
                  ? "border-emerald-500/45 bg-emerald-950/35 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                  : "border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/90 hover:text-zinc-200"
              )}
            >
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none",
                  showCompletedProjects
                    ? "border-emerald-500/50 bg-emerald-600/85"
                    : "border-zinc-600 bg-zinc-800"
                )}
                aria-hidden
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                    showCompletedProjects ? "translate-x-[1.125rem]" : "translate-x-0.5"
                  )}
                />
              </span>
              <span className="min-w-0 truncate">Show completed</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onFocusModeToggle}
            disabled={filterActive}
            title={
              filterActive
                ? "Unavailable while search or filters are active"
                : focusMode
                  ? "Exit Focus — only one goal and one project stay open; click to return to normal"
                  : "Focus — only one goal and one project expanded; opening another closes the rest"
            }
            className={cn(
              "inline-flex min-h-[2.25rem] shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40",
              focusMode
                ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-950/55"
                : "border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
            )}
            aria-pressed={focusMode}
          >
            <Crosshair className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            Focus
          </button>
          <RoadmapExpandModeSelect
            expandPreset={effectiveExpandPreset}
            onChange={onExpandPresetChange}
            viewLocked={focusMode}
          />
        </div>
      </PageToolbar>

      <div className="min-w-0 max-w-full px-6 pb-6">
        <RoadmapStickyBelowToolbarGap />
        {hierarchy.length === 0 ? (
          <EmptyState
            icon={MapIcon}
            title="Your roadmap is empty"
            description={
              <>
                Goals, projects, and milestones will appear here once you add companies on the{" "}
                <a
                  href="/companies"
                  className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors"
                >
                  Companies
                </a>{" "}
                page. Each company becomes a section on the roadmap with its own goals and
                projects.
              </>
            }
            descriptionClassName="max-w-md"
          />
        ) : filterActive && filteredHierarchy.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-zinc-800 py-8 px-4 text-center">
            <p className="text-sm text-zinc-500 max-w-lg">
              {searchActive ? (
                <>
                  No matches for &quot;{searchQuery.trim()}&quot;
                  {searchFilterWithClause}. Try another keyword or clear filters.
                </>
              ) : (
                <>
                  No goals or projects match your filters
                  {nonSearchForClause}. Adjust or clear filters.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Reset filters
            </button>
          </div>
        ) : !roadmapToolbarPrefsHydrated ? (
          /*
            Hold the hierarchy until restored Roadmap toolbar prefs
            (Goals only / Focus mode / initialFocus) are applied, so goals and
            projects don't briefly render expanded and then collapse.
          */
          <RoadmapHierarchySkeleton count={Math.min(hierarchy.length, 3)} />
        ) : (
          filteredHierarchy.map((company) => (
            <CompanySection
              key={company.id}
              company={company}
              people={people}
              expandForSearch={filterActive}
              ownerWorkloadMap={ownerWorkloadMap}
              allGoals={allGoals}
              allCompanies={allCompanies}
              mirrorPickerHierarchy={hierarchy}
              showCompletedProjects={showCompletedProjects}
            />
          ))
        )}
      </div>
      </RoadmapViewProvider>
    </TrackerExpandProvider>
  );
}

/**
 * Placeholder blocks shown while the Roadmap toolbar prefs (expand preset, focus mode)
 * hydrate from localStorage. Keeps the page visually stable instead of flashing a fully
 * expanded tree that immediately collapses once `Goals only` or similar is applied.
 */
function RoadmapHierarchySkeleton({ count }: { count: number }) {
  const safeCount = Math.max(1, count || 1);
  return (
    <div aria-busy="true" aria-label="Loading roadmap" className="animate-pulse">
      {Array.from({ length: safeCount }).map((_, i) => (
        <div
          key={i}
          className="mb-8 pb-6 border-b border-zinc-800/35 last:border-b-0 last:pb-0"
        >
          <div className="pt-3 pb-2 flex items-center gap-3">
            <div className="h-4 w-4 rounded-sm bg-zinc-800/80" />
            <div className="h-7 w-7 rounded-md bg-zinc-800/90" />
            <div className="h-5 w-56 max-w-[40%] rounded bg-zinc-800/80" />
            <div className="h-3 w-16 rounded bg-zinc-800/60" />
          </div>
          <div className="mt-2 space-y-2">
            <div className="h-9 rounded-md border border-zinc-800/70 bg-zinc-900/55" />
            <div className="h-9 rounded-md border border-zinc-800/70 bg-zinc-900/45" />
            <div className="h-9 rounded-md border border-zinc-800/70 bg-zinc-900/45" />
          </div>
        </div>
      ))}
    </div>
  );
}
