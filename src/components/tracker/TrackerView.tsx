"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CompanyWithGoals, Person } from "@/lib/types/tracker";
import { CompanySection } from "./CompanySection";
import { CompanyFilterMultiSelect } from "./CompanyFilterMultiSelect";
import { OwnerFilterMultiSelect } from "./OwnerFilterMultiSelect";
import { StatusTagFilterMultiSelect } from "./StatusTagFilterMultiSelect";
import {
  TrackerExpandProvider,
  type TrackerBulkExpandTarget,
} from "./tracker-expand-context";
import { FilterX, Search } from "lucide-react";
import { sortPeopleLikeTeamRoster } from "@/lib/autonomyRoster";
import { groupCompaniesByRevenueTier } from "@/lib/companyRevenueTiers";
import {
  filterTrackerHierarchy,
  filterTrackerHierarchyByCompanyIds,
  filterTrackerHierarchyByOwner,
  filterTrackerHierarchyByStatusTags,
  normalizeTrackerSearchQuery,
  type TrackerStatusTagId,
} from "@/lib/tracker-search-filter";
import {
  isOwnerFilterDepartmentToken,
  isOwnerFilterEmploymentToken,
  ownerFilterDepartmentLabel,
  ownerFilterEmploymentLabel,
} from "@/lib/owner-filter";

interface TrackerViewProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
}

export function TrackerView({ hierarchy, people }: TrackerViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [companyFilterIds, setCompanyFilterIds] = useState<string[]>([]);
  const [ownerFilterIds, setOwnerFilterIds] = useState<string[]>([]);
  const [statusTagFilterIds, setStatusTagFilterIds] = useState<
    TrackerStatusTagId[]
  >([]);
  const [bulkTick, setBulkTick] = useState(0);
  /** Last bulk preset applied; null = none yet this session (manual expansion) */
  const [bulkTarget, setBulkTarget] = useState<TrackerBulkExpandTarget>(null);
  const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [focusEnforceTick, setFocusEnforceTick] = useState(0);
  const focusProjectMode = bulkTarget === "single_project";

  const expandModeLabel = useMemo(() => {
    switch (bulkTarget) {
      case null:
        return "Custom";
      case "goals_only":
        return "Only Goals";
      case "goals_and_projects":
        return "Goals + Projects";
      case "goals_projects_milestones":
        return "Goals + Projects + Milestones";
      case "single_project":
        return "One goal and one project";
      case "collapse":
        return "Collapse all";
      default:
        return "Custom";
    }
  }, [bulkTarget]);

  const expandModeMeasureRef = useRef<HTMLSpanElement>(null);
  const [expandSelectWidthPx, setExpandSelectWidthPx] = useState<number | null>(
    null
  );

  useLayoutEffect(() => {
    const el = expandModeMeasureRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.ceil(el.getBoundingClientRect().width) + 2;
      if (typeof window !== "undefined") {
        const cap = Math.min(w, window.innerWidth - 24);
        setExpandSelectWidthPx(cap);
      } else {
        setExpandSelectWidthPx(w);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [expandModeLabel]);

  const searchActive = normalizeTrackerSearchQuery(searchQuery).length > 0;
  const companyFilterActive = companyFilterIds.length > 0;
  const ownerFilterActive = ownerFilterIds.length > 0;
  const statusTagFilterActive = statusTagFilterIds.length > 0;
  const filterActive =
    searchActive ||
    companyFilterActive ||
    ownerFilterActive ||
    statusTagFilterActive;

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setCompanyFilterIds([]);
    setOwnerFilterIds([]);
    setStatusTagFilterIds([]);
  }, []);

  const onExpandModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const raw = e.target.value;
      setFocusedGoalId(null);
      setFocusedProjectId(null);
      if (raw === "custom") {
        setBulkTarget(null);
        setBulkTick((t) => t + 1);
        return;
      }
      if (raw === "single_project") {
        setBulkTarget("single_project");
        setFocusEnforceTick((x) => x + 1);
        return;
      }
      setBulkTarget(raw as TrackerBulkExpandTarget);
      setBulkTick((t) => t + 1);
    },
    []
  );

  useEffect(() => {
    if (!filterActive) return;
    setFocusedGoalId(null);
    setFocusedProjectId(null);
    setBulkTarget((prev) => (prev === "single_project" ? null : prev));
  }, [filterActive]);

  const bulkValue = useMemo(
    () => ({
      bulkTick,
      bulkTarget,
      focusProjectMode,
      focusedGoalId,
      setFocusedGoalId,
      focusedProjectId,
      setFocusedProjectId,
      focusEnforceTick,
    }),
    [
      bulkTick,
      bulkTarget,
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

  const hierarchyAfterStatusTags = useMemo(
    () =>
      filterTrackerHierarchyByStatusTags(
        hierarchyAfterOwner,
        statusTagFilterIds.length > 0 ? statusTagFilterIds : null
      ),
    [hierarchyAfterOwner, statusTagFilterIds]
  );

  const filteredHierarchy = useMemo(
    () =>
      filterTrackerHierarchy(hierarchyAfterStatusTags, people, searchQuery),
    [hierarchyAfterStatusTags, people, searchQuery]
  );

  const companyFilterLabel = useMemo(() => {
    if (companyFilterIds.length === 0) return "";
    const byId = new Map(hierarchy.map((c) => [c.id, c.name]));
    return companyFilterIds.map((id) => byId.get(id) ?? id).join(", ");
  }, [hierarchy, companyFilterIds]);

  const ownerFilterLabel = useMemo(() => {
    if (ownerFilterIds.length === 0) return "";
    const byId = new Map(people.map((p) => [p.id, p.name]));
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
    };
    return statusTagFilterIds.map((id) => labels[id]).join(", ");
  }, [statusTagFilterIds]);

  const searchFilterWithClause = useMemo(() => {
    const parts: string[] = [];
    if (companyFilterActive) {
      parts.push(`company filter (${companyFilterLabel})`);
    }
    if (ownerFilterActive) {
      parts.push(`owner filter (${ownerFilterLabel})`);
    }
    if (statusTagFilterActive) {
      parts.push(`status (${statusTagFilterLabel})`);
    }
    if (parts.length === 0) return "";
    return ` with ${parts.join(" and ")}`;
  }, [
    companyFilterActive,
    ownerFilterActive,
    statusTagFilterActive,
    companyFilterLabel,
    ownerFilterLabel,
    statusTagFilterLabel,
  ]);

  const nonSearchForClause = useMemo(() => {
    const parts: string[] = [];
    if (companyFilterActive) parts.push(`companies (${companyFilterLabel})`);
    if (ownerFilterActive) parts.push(`owners (${ownerFilterLabel})`);
    if (statusTagFilterActive) parts.push(`status (${statusTagFilterLabel})`);
    if (parts.length === 0) return "";
    return ` for ${parts.join(" and ")}`;
  }, [
    companyFilterActive,
    ownerFilterActive,
    statusTagFilterActive,
    companyFilterLabel,
    ownerFilterLabel,
    statusTagFilterLabel,
  ]);

  return (
    <TrackerExpandProvider value={bulkValue}>
      <div className="flex flex-wrap items-center gap-3 mb-3 px-1 min-h-[2.25rem]">
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
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[18rem]">
          <StatusTagFilterMultiSelect
            selectedIds={statusTagFilterIds}
            onChange={setStatusTagFilterIds}
          />
        </div>
        {filterActive ? (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors shrink-0"
            title="Clear search, company, owner, and status filters"
          >
            <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Reset filters
          </button>
        ) : null}
        <div className="flex flex-wrap items-center justify-end shrink-0 ml-auto max-w-[min(100%,100vw-1.5rem)]">
          <label className="sr-only" htmlFor="tracker-expand-mode">
            Tree expansion mode
          </label>
          <div className="relative inline-flex max-w-full min-w-0">
            <span
              ref={expandModeMeasureRef}
              className="pointer-events-none absolute left-0 top-0 inline-block whitespace-nowrap pl-2.5 pr-8 text-xs font-medium opacity-0"
              aria-hidden
            >
              {expandModeLabel}
            </span>
            <select
              id="tracker-expand-mode"
              value={bulkTarget ?? "custom"}
              onChange={onExpandModeChange}
              className="max-w-full rounded-md border border-zinc-700 bg-zinc-900/80 py-1.5 pl-2.5 pr-8 text-xs font-medium text-zinc-100 shadow-sm cursor-pointer hover:bg-zinc-800 hover:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500 appearance-none bg-[length:0.875rem] bg-[right_0.4rem_center] bg-no-repeat"
              style={{
                ...(expandSelectWidthPx != null
                  ? { width: expandSelectWidthPx }
                  : {}),
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              }}
              aria-label="Tree expansion mode"
              title={
                bulkTarget === null
                  ? "Manual expansion — click rows to open or close"
                  : bulkTarget === "goals_only"
                    ? "Companies expanded; goal rows collapsed (project lists hidden)"
                    : bulkTarget === "goals_and_projects"
                      ? "Project rows expanded; milestone lists hidden"
                      : bulkTarget === "goals_projects_milestones"
                        ? "Full expansion including milestone lists"
                        : bulkTarget === "single_project"
                          ? "Only one goal and one project expanded; opening another closes the rest"
                          : "Companies, goals, projects, and milestones collapsed"
              }
            >
              <option value="custom">Custom</option>
              <option value="goals_only">Only Goals</option>
              <option value="goals_and_projects">Goals + Projects</option>
              <option value="goals_projects_milestones">
                Goals + Projects + Milestones
              </option>
              <option
                value="single_project"
                disabled={filterActive}
                title={
                  filterActive
                    ? "Unavailable while search or filters are active"
                    : undefined
                }
              >
                One goal and one project
              </option>
              <option value="collapse">Collapse all</option>
            </select>
          </div>
        </div>
      </div>

      {filterActive && filteredHierarchy.length === 0 ? (
        <p className="text-sm text-zinc-500 px-4 py-8 text-center border border-dashed border-zinc-800 rounded-lg">
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
          />
        ))
      )}
    </TrackerExpandProvider>
  );
}
