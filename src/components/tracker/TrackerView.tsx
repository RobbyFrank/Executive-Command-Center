"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Company, CompanyWithGoals, Person } from "@/lib/types/tracker";
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
import { RoadmapStickyToolbar } from "./RoadmapStickyToolbar";
import { RoadmapExpandModeSelect } from "./RoadmapExpandModeSelect";
import {
  Check,
  Crosshair,
  FilterX,
  Map as MapIcon,
  Search,
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
import type { RoadmapInitialFilters } from "@/lib/roadmap-query";
import { emptyRoadmapFilters } from "@/lib/roadmap-query";

const ROADMAP_FOCUS_MODE_STORAGE_KEY = "ecc-roadmap-focus-mode";
const ROADMAP_EXPAND_PRESET_STORAGE_KEY = "ecc-roadmap-expand-preset";
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
}

export function TrackerView({
  hierarchy,
  people,
  initialFocus,
  initialFilters: initialFiltersProp,
}: TrackerViewProps) {
  const initialFilters = initialFiltersProp ?? emptyRoadmapFilters();

  const [searchQuery, setSearchQuery] = useState(
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

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setCompanyFilterIds([]);
    setOwnerFilterIds([]);
    setStatusTagFilterIds([]);
    setDueDateFilterIds([]);
    setPriorityFilterIds([]);
    setStatusEnumFilterIds([]);
  }, []);

  useEffect(() => {
    let expandPresetFromStorage = false;
    try {
      const raw = localStorage.getItem(ROADMAP_FOCUS_MODE_STORAGE_KEY);
      if (raw === "1" || raw === "true") {
        setFocusMode(true);
        setFocusEnforceTick((x) => x + 1);
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
    if (expandPresetFromStorage) {
      setBulkTick((t) => t + 1);
    }
    setRoadmapToolbarPrefsHydrated(true);
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

  useEffect(() => {
    if (!initialFocus?.goalId || !initialFocus?.projectId) return;
    setFocusMode(true);
    setFocusedGoalId(initialFocus.goalId);
    setFocusedProjectId(initialFocus.projectId);
    setBulkTick((t) => t + 1);
    setFocusEnforceTick((x) => x + 1);
  }, [initialFocus?.goalId, initialFocus?.projectId]);

  const bulkValue = useMemo(
    () => ({
      bulkTick,
      expandPreset,
      focusProjectMode,
      focusedGoalId,
      setFocusedGoalId,
      focusedProjectId,
      setFocusedProjectId,
      focusEnforceTick,
    }),
    [
      bulkTick,
      expandPreset,
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

  const hierarchyAfterStatusTags = useMemo(
    () =>
      filterTrackerHierarchyByStatusTags(
        hierarchyAfterStatusEnum,
        statusTagFilterIds.length > 0 ? statusTagFilterIds : null,
        people
      ),
    [hierarchyAfterStatusEnum, statusTagFilterIds, people]
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
      filterTrackerHierarchy(hierarchyAfterDueDate, people, searchQuery),
    [hierarchyAfterDueDate, people, searchQuery]
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
      at_risk: "At risk",
      spotlight: "Spotlight",
      unassigned: "Unassigned",
      need_review: "Need review",
      close_watch: "Close watch",
      zombie: "Zombie",
      blocked_by_dep: "Blocked (dependency)",
      high_leverage: "High leverage",
      low_leverage: "Low leverage",
      time_sensitive: "Time-sensitive",
    };
    return statusTagFilterIds.map((id) => labels[id]).join(", ");
  }, [statusTagFilterIds]);

  const priorityFilterLabel = useMemo(
    () => (priorityFilterIds.length === 0 ? "" : priorityFilterIds.join(", ")),
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
      <RoadmapStickyToolbar>
        <div className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-100">Roadmap</h1>
          <span className="text-sm font-normal text-zinc-500">
            Company → Goal → Project → Milestone.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-1 min-h-[2.25rem]">
        <div
          className={`relative flex-1 min-w-0 transition-[max-width] duration-200 ease-out ${
            searchQuery.trim() !== ""
              ? "max-w-[19.2rem]"
              : "max-w-[10rem] focus-within:max-w-[19.2rem]"
          }`}
        >
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-900/80 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            aria-label="Search tracker"
            autoComplete="off"
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[20rem]">
          <CompanyFilterMultiSelect
            companies={companiesForFilter}
            selectedIds={companyFilterIds}
            onChange={setCompanyFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[20rem]">
          <OwnerFilterMultiSelect
            people={peopleSorted}
            selectedIds={ownerFilterIds}
            onChange={setOwnerFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[12rem]">
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
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[18rem]">
          <StatusTagFilterMultiSelect
            selectedIds={statusTagFilterIds}
            onChange={setStatusTagFilterIds}
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[18rem]">
          <DueDateFilterSelect
            hierarchy={hierarchyAfterHideDone}
            selectedIds={dueDateFilterIds}
            onChange={setDueDateFilterIds}
          />
        </div>
        {filterActive ? (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors shrink-0"
            title="Clear search and all filters"
          >
            <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Reset filters
          </button>
        ) : null}
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 shrink-0 ml-auto">
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
              "inline-flex min-h-[2.25rem] shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-40",
              focusMode
                ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-950/55"
                : "border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
            )}
            aria-pressed={focusMode}
          >
            <Crosshair className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            Focus
          </button>
          <div className="relative min-w-[10.5rem] shrink-0">
            <button
              type="button"
              aria-pressed={showCompletedProjects}
              aria-label={
                showCompletedProjects
                  ? "Showing completed goals, projects, and milestones — click to hide"
                  : "Hiding completed goals, projects, and milestones — click to show"
              }
              title="When off: hides Done milestones, Done projects (except projects with no milestones), and goals that only have completed work. Goals with no projects always stay visible."
              onClick={() => setShowCompletedProjects((v) => !v)}
              className={cn(
                "flex min-h-[2.25rem] w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-zinc-500",
                showCompletedProjects
                  ? "border-emerald-500/45 bg-emerald-950/35 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                  : "border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/90 hover:text-zinc-200"
              )}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  showCompletedProjects
                    ? "text-emerald-400"
                    : "text-zinc-600"
                )}
                strokeWidth={2.5}
                aria-hidden
              />
              <span className="min-w-0 truncate">Show completed</span>
            </button>
          </div>
          <RoadmapExpandModeSelect
            expandPreset={expandPreset}
            onChange={onExpandPresetChange}
          />
        </div>
        </div>
      </RoadmapStickyToolbar>

      {/* `overflow-x-auto` alone makes `overflow-y` compute to `auto`, which creates a scroll
          container and breaks nested `position: sticky` vs `main` (Roadmap column headers).
          `overflow-y-clip` keeps horizontal scroll without a vertical scrollport. */}
      <div className="min-w-0 max-w-full overflow-x-auto overflow-y-clip overscroll-x-contain px-6 pb-6">
        {hierarchy.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 px-6 py-20">
            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 mb-5">
              <MapIcon className="h-7 w-7 text-zinc-500" />
            </div>
            <h2 className="text-base font-semibold text-zinc-200 mb-1.5">Your roadmap is empty</h2>
            <p className="text-sm text-zinc-500 text-center max-w-md">
              Goals, projects, and milestones will appear here once you add companies on the{" "}
              <a href="/companies" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">
                Companies
              </a>{" "}
              page. Each company becomes a section on the roadmap with its own goals and projects.
            </p>
          </div>
        ) : filterActive && filteredHierarchy.length === 0 ? (
          <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-800 rounded-lg">
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
