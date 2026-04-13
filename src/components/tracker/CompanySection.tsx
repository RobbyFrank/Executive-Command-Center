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
import { GoalSection } from "./GoalSection";
import { useTrackerExpandBulk } from "./tracker-expand-context";
import { ChevronRight, Building2, ChevronDown, Plus } from "lucide-react";
import { createGoal } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
} from "@/lib/relativeCalendarDate";
import { GoalsColumnHeaders } from "./TrackerColumnHeaders";
import { useRoadmapView } from "./roadmap-view-context";
import {
  ROADMAP_TOOLBAR_STICKY_FALLBACK_PX,
  TRACKER_GOALS_COLUMN_HEADER_HEIGHT_PX,
} from "@/lib/tracker-sticky-layout";
import {
  TRACKER_COMPANY_ADD_GOAL_ROW_VISIBILITY_CLASS,
  TRACKER_EMPTY_HINT_COPY_COMPANY_CLASS,
  TRACKER_FOOTER_TEXT_ACTION,
  TRACKER_INLINE_TEXT_ACTION,
} from "./tracker-text-actions";
import { AiCreateButton } from "./AiCreateButton";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";

interface CompanySectionProps {
  company: CompanyWithGoals;
  people: Person[];
  /** When true (e.g. tracker search is active), expand so matches are visible */
  expandForSearch?: boolean;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
}

export function CompanySection({
  company,
  people,
  expandForSearch = false,
  ownerWorkloadMap,
}: CompanySectionProps) {
  const [expanded, setExpanded] = useState(true);
  /** Per-goal expanded state so we can default new goals when siblings are all collapsed. */
  const [goalExpandedById, setGoalExpandedById] = useState<
    Record<string, boolean>
  >({});
  /** First-mount `expanded` for goals created in this session (key = goal id). */
  const [newGoalInitialExpandedById, setNewGoalInitialExpandedById] = useState<
    Record<string, boolean>
  >({});
  /** After adding a goal, title (description) opens in edit mode so the user can type immediately. */
  const [newGoalTitleFocusId, setNewGoalTitleFocusId] = useState<
    string | null
  >(null);

  const handleGoalExpandedChange = useCallback(
    (goalId: string, isExpanded: boolean) => {
      setGoalExpandedById((prev) => {
        if (prev[goalId] === isExpanded) return prev;
        return { ...prev, [goalId]: isExpanded };
      });
    },
    []
  );

  const handleNewGoalRegistered = useCallback(
    (newGoalId: string) => {
      const siblings = company.goals.filter((g) => g.id !== newGoalId);
      const allCollapsed =
        siblings.length > 0 &&
        siblings.every((g) => goalExpandedById[g.id] === false);
      setNewGoalInitialExpandedById((prev) => ({
        ...prev,
        [newGoalId]: !allCollapsed,
      }));
      setNewGoalTitleFocusId(newGoalId);
    },
    [company.goals, goalExpandedById]
  );
  const { bulkTick, expandPreset } = useTrackerExpandBulk();
  const { stickyTopPx } = useRoadmapView();
  const toolbarPx =
    stickyTopPx > 0 ? stickyTopPx : ROADMAP_TOOLBAR_STICKY_FALLBACK_PX;
  const companyContext = useContextMenu();
  const companyHeaderRef = useRef<HTMLDivElement>(null);
  const [companyHeaderPx, setCompanyHeaderPx] = useState(56);

  useLayoutEffect(() => {
    const el = companyHeaderRef.current;
    if (!el) return;
    const apply = () =>
      setCompanyHeaderPx(Math.round(el.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const goalsColumnStackTopPx = toolbarPx + companyHeaderPx;
  const roadmapGoalRowStickyTopPx =
    goalsColumnStackTopPx + TRACKER_GOALS_COLUMN_HEADER_HEIGHT_PX;

  useEffect(() => {
    if (bulkTick === 0) return;
    queueMicrotask(() => {
      if (
        expandPreset === "goals_only" ||
        expandPreset === "goals_and_projects" ||
        expandPreset === "goals_projects_milestones"
      )
        setExpanded(true);
      else if (expandPreset === "collapse") setExpanded(false);
    });
  }, [bulkTick, expandPreset]);

  useEffect(() => {
    if (expandForSearch) setExpanded(true);
  }, [expandForSearch]);

  const goalCount = company.goals.length;
  const projectCount = company.goals.reduce(
    (sum, g) => sum + g.projects.length,
    0
  );
  const statsLabel = `${goalCount} goal${goalCount !== 1 ? "s" : ""} · ${projectCount} project${projectCount !== 1 ? "s" : ""}`;

  const companyMenuEntries = useMemo((): ContextMenuEntry[] => {
    async function addGoal() {
      const goal = await createGoal({
        companyId: company.id,
        description: "New goal",
        measurableTarget: "",
        whyItMatters: "",
        currentValue: "",
        impactScore: 3,
        confidenceScore: 0,
        costOfDelay: 3,
        ownerId: "",
        priority: "P2",
        executionMode: "Async",
        slackChannel: "",
        status: "Not Started",
        atRisk: false,
        spotlight: false,
        reviewLog: [],
      });
      handleNewGoalRegistered(goal.id);
    }
    return [
      {
        type: "item" as const,
        id: "add-goal",
        label: "Add goal",
        icon: Plus,
        onClick: () => void addGoal(),
      },
      { type: "divider", id: "d1" },
      {
        type: "item" as const,
        id: "expand-collapse",
        label: expanded ? "Collapse company" : "Expand company",
        icon: expanded ? ChevronDown : ChevronRight,
        onClick: () => setExpanded((v) => !v),
      },
    ];
  }, [company.id, expanded, handleNewGoalRegistered]);

  return (
    <div className="group/company mb-6 min-w-0 max-w-full">
      <div
        ref={companyHeaderRef}
        className="sticky z-[29] bg-zinc-950/90 pb-1 shadow-[0_1px_0_rgba(0,0,0,0.35)] backdrop-blur-sm"
        style={{ top: toolbarPx }}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          onContextMenu={companyContext.onContextMenu}
          aria-expanded={expanded}
          className="group flex w-full items-center gap-3 px-4 py-3 text-left bg-zinc-900/60 rounded-lg border border-zinc-800 hover:bg-zinc-900/85 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
        <ChevronRight
          className={cn(
            "h-5 w-5 shrink-0 text-zinc-400 transition-transform group-hover:text-zinc-200",
            expanded && "rotate-90"
          )}
          aria-hidden
        />

        {company.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoPath}
            alt=""
            className="h-6 w-6 rounded object-cover shrink-0"
          />
        ) : (
          <Building2 className="h-5 w-5 text-zinc-500 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-baseline justify-start gap-3">
            <h2 className="min-w-0 max-w-full shrink truncate font-semibold text-zinc-100 text-base">
              {company.name}
            </h2>
            <span className="group/stats relative inline-flex shrink-0">
              <span
                className="cursor-default text-xs tabular-nums text-zinc-600 whitespace-nowrap"
                aria-hidden
              >
                {goalCount} · {projectCount}
              </span>
              <span
                className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-max max-w-[min(100vw-2rem,20rem)] rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-zinc-300 shadow-lg opacity-0 transition-opacity duration-150 group-hover/stats:opacity-100"
                aria-hidden
              >
                {statsLabel}
              </span>
              <span className="sr-only">{statsLabel}</span>
            </span>
          </div>
          {(company.developmentStartDate || company.launchDate) && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
              {company.developmentStartDate ? (
                <span
                  title={`Started — ${formatCalendarDateHint(company.developmentStartDate)}`}
                >
                  Dev started{" "}
                  <span className="text-zinc-400">
                    {formatRelativeCalendarDate(company.developmentStartDate)}
                  </span>
                </span>
              ) : null}
              {company.launchDate ? (
                <span
                  title={`Launched — ${formatCalendarDateHint(company.launchDate)}`}
                >
                  Launched{" "}
                  <span className="text-zinc-400">
                    {formatRelativeCalendarDate(company.launchDate)}
                  </span>
                </span>
              ) : null}
            </div>
          )}
        </div>
        </button>
        <ContextMenu
          open={companyContext.open}
          x={companyContext.x}
          y={companyContext.y}
          onClose={companyContext.close}
          ariaLabel={`Actions for ${company.name}`}
          entries={companyMenuEntries}
        />
      </div>

      {expanded && (
        <div className="mt-1">
          {company.goals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 sm:pl-8">
              <p
                className={cn(
                  "w-full min-w-0",
                  TRACKER_EMPTY_HINT_COPY_COMPANY_CLASS
                )}
              >
                No goals yet. Add a goal to plan work and projects for this company.&nbsp;
                <button
                  type="button"
                  title="Add a new goal for this company"
                  onClick={async () => {
                    const goal = await createGoal({
                      companyId: company.id,
                      description: "New goal",
                      measurableTarget: "",
                      whyItMatters: "",
                      currentValue: "",
                      impactScore: 3,
                      confidenceScore: 0,
                      costOfDelay: 3,
                      ownerId: "",
                      priority: "P2",
                      executionMode: "Async",
                      slackChannel: "",
                      status: "Not Started",
                      atRisk: false,
                      spotlight: false,
                      reviewLog: [],
                    });
                    handleNewGoalRegistered(goal.id);
                  }}
                  className={TRACKER_INLINE_TEXT_ACTION}
                >
                  Add goal
                </button>
                <AiCreateButton
                  type="goal"
                  companyId={company.id}
                  onCreated={(id) => handleNewGoalRegistered(id)}
                  inline
                />
              </p>
            </div>
          ) : (
            <>
              <GoalsColumnHeaders
                stackTopPx={goalsColumnStackTopPx}
                stickyZClass="z-[28]"
              />
              <div className="space-y-1">
                {company.goals.map((goal) => (
                  <GoalSection
                    key={goal.id}
                    goal={goal}
                    people={people}
                    expandForSearch={expandForSearch}
                    ownerWorkloadMap={ownerWorkloadMap}
                    roadmapGoalRowStickyTopPx={roadmapGoalRowStickyTopPx}
                    focusGoalTitleEditId={newGoalTitleFocusId}
                    onGoalCreated={handleNewGoalRegistered}
                    initialExpanded={newGoalInitialExpandedById[goal.id]}
                    onExpandedChange={handleGoalExpandedChange}
                  />
                ))}
              </div>
              {/* Outside goal CollapsePanels so “Add goal” stays visible when every goal is collapsed */}
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 pr-4 py-1.5",
                  TRACKER_COMPANY_ADD_GOAL_ROW_VISIBILITY_CLASS
                )}
              >
                <button
                  type="button"
                  title="Add another goal under this company"
                  onClick={async () => {
                    const g = await createGoal({
                      companyId: company.id,
                      description: "New goal",
                      measurableTarget: "",
                      whyItMatters: "",
                      currentValue: "",
                      impactScore: 3,
                      confidenceScore: 0,
                      costOfDelay: 3,
                      ownerId: "",
                      priority: "P2",
                      executionMode: "Async",
                      slackChannel: "",
                      status: "Not Started",
                      atRisk: false,
                      spotlight: false,
                      reviewLog: [],
                    });
                    handleNewGoalRegistered(g.id);
                  }}
                  className={TRACKER_FOOTER_TEXT_ACTION}
                >
                  Add goal
                </button>
                <AiCreateButton
                  type="goal"
                  companyId={company.id}
                  onCreated={(id) => handleNewGoalRegistered(id)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
