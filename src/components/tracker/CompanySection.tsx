"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Company, CompanyWithGoals, Goal, Person } from "@/lib/types/tracker";
import { GoalSection } from "./GoalSection";
import { useTrackerExpandBulk } from "./tracker-expand-context";
import {
  ChevronRight,
  Building2,
  ChevronDown,
  Plus,
  MessageSquare,
  Target,
  Layers,
} from "lucide-react";
import { createGoal } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";
import { GoalsColumnHeaders } from "./TrackerColumnHeaders";
import { useRoadmapView } from "./roadmap-view-context";
import {
  ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX,
  ROADMAP_TOOLBAR_STICKY_FALLBACK_PX,
  TRACKER_GOALS_COLUMN_HEADER_HEIGHT_PX,
} from "@/lib/tracker-sticky-layout";
import { CompanyEmptyGoalRowPlaceholder } from "./CompanyEmptyGoalRowPlaceholder";
import { AddEntityMenuButton } from "./AddEntityMenuButton";
import { CompanyScrapeButton } from "./CompanyScrapeButton";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { CompanySectionOverlayProvider } from "./company-section-overlay-context";
import { CollapsePanel } from "./CollapsePanel";
import { useAssistantOptional } from "@/contexts/AssistantContext";

interface CompanySectionProps {
  company: CompanyWithGoals;
  people: Person[];
  /** When true (e.g. tracker search is active), expand so matches are visible */
  expandForSearch?: boolean;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
  allGoals: Goal[];
  allCompanies: Company[];
  mirrorPickerHierarchy: CompanyWithGoals[];
  showCompletedProjects?: boolean;
}

export function CompanySection({
  company,
  people,
  expandForSearch = false,
  ownerWorkloadMap,
  allGoals,
  allCompanies,
  mirrorPickerHierarchy,
  showCompletedProjects = true,
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

  const addFirstGoalForCompany = useCallback(async () => {
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
      slackChannel: "",
      slackChannelId: "",
      status: "Not Started",
      atRisk: false,
      spotlight: false,
      reviewLog: [],
    });
    handleNewGoalRegistered(goal.id);
  }, [company.id, handleNewGoalRegistered]);
  const { bulkTick, expandPreset } = useTrackerExpandBulk();
  const { stickyTopPx } = useRoadmapView();
  const toolbarPx =
    stickyTopPx > 0 ? stickyTopPx : ROADMAP_TOOLBAR_STICKY_FALLBACK_PX;
  /** Top offset for the company row and everything stacked below it (gap is above company, not inside toolbar). */
  const stickyStackBasePx = toolbarPx + ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX;
  const companyContext = useContextMenu();
  const assistant = useAssistantOptional();
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

  const goalsColumnStackTopPx = stickyStackBasePx + companyHeaderPx;
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
    (sum, g) => sum + g.projects.filter((p) => !p.isMirror).length,
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
        slackChannel: "",
        slackChannelId: "",
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
      ...(assistant
        ? ([
            {
              type: "item" as const,
              id: "discuss-in-chat",
              label: "Discuss in chat",
              icon: MessageSquare,
              onClick: () =>
                assistant.openAssistant({
                  type: "company",
                  id: company.id,
                  label: company.name,
                }),
            },
          ] as const)
        : []),
      { type: "divider", id: "d1" },
      {
        type: "item" as const,
        id: "expand-collapse",
        label: expanded ? "Collapse company" : "Expand company",
        icon: expanded ? ChevronDown : ChevronRight,
        onClick: () => setExpanded((v) => !v),
      },
    ];
  }, [assistant, company.id, company.name, expanded, handleNewGoalRegistered]);

  return (
    <CompanySectionOverlayProvider>
    <div className="group/company mb-6 min-w-0 max-w-full">
      <div
        ref={companyHeaderRef}
        className="sticky z-[29] bg-zinc-950/95 pt-3 backdrop-blur-sm"
        style={{ top: stickyStackBasePx }}
      >
        <div className="group/companyHeader flex min-w-0 items-stretch">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          onContextMenu={companyContext.onContextMenu}
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent px-1 pb-2 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-inset rounded-sm"
        >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none group-hover:text-zinc-300",
            expanded && "rotate-90"
          )}
          aria-hidden
        />

        {company.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoPath}
            alt=""
            className="h-7 w-7 rounded-md object-cover shrink-0 ring-1 ring-zinc-800"
          />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 ring-1 ring-zinc-800">
            <Building2 className="h-4 w-4 text-zinc-500" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="min-w-0 max-w-full shrink truncate font-semibold tracking-tight text-zinc-50 text-lg leading-tight">
              {company.name}
            </h2>
            <span
              className="shrink-0 inline-flex cursor-default items-center gap-2 text-xs tabular-nums text-zinc-500 whitespace-nowrap"
              aria-label={statsLabel}
              title={statsLabel}
            >
              <span className="inline-flex items-center gap-1">
                <Target className="h-3 w-3 text-zinc-600" aria-hidden />
                {goalCount}
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3 text-zinc-600" aria-hidden />
                {projectCount}
              </span>
            </span>
          </div>
        </div>
        </button>
        <div className="flex shrink-0 items-center pb-2 pl-2">
          <CompanyScrapeButton company={company} people={people} />
        </div>
        </div>
        <ContextMenu
          open={companyContext.open}
          x={companyContext.x}
          y={companyContext.y}
          onClose={companyContext.close}
          scope="company"
          ariaLabel={`Actions for ${company.name}`}
          entries={companyMenuEntries}
        />
      </div>

      <CollapsePanel
        open={expanded}
        transitionClassName="duration-[300ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150"
        innerClassName={cn(
          "transition-opacity duration-[280ms] ease-out motion-reduce:transition-none motion-reduce:opacity-100",
          expanded ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="mt-1">
          {company.goals.length === 0 ? (
            <>
              <GoalsColumnHeaders
                stackTopPx={goalsColumnStackTopPx}
                stickyZClass="z-[28]"
              />
              <CompanyEmptyGoalRowPlaceholder
                roadmapGoalRowStickyTopPx={roadmapGoalRowStickyTopPx}
                companyId={company.id}
                onManualAdd={() => {
                  void addFirstGoalForCompany();
                }}
                onGoalCreated={handleNewGoalRegistered}
              />
            </>
          ) : (
            <>
              <GoalsColumnHeaders
                stackTopPx={goalsColumnStackTopPx}
                stickyZClass="z-[28]"
              />
              <div>
                {company.goals.map((goal, goalIndex) => (
                  <GoalSection
                    key={goal.id}
                    goal={goal}
                    people={people}
                    expandForSearch={expandForSearch}
                    ownerWorkloadMap={ownerWorkloadMap}
                    roadmapGoalRowStickyTopPx={roadmapGoalRowStickyTopPx}
                    focusGoalTitleEditId={newGoalTitleFocusId}
                    initialExpanded={newGoalInitialExpandedById[goal.id]}
                    onExpandedChange={handleGoalExpandedChange}
                    stackPosition={
                      company.goals.length <= 1
                        ? "only"
                        : goalIndex === 0
                          ? "first"
                          : goalIndex === company.goals.length - 1
                            ? "last"
                            : "middle"
                    }
                    allGoals={allGoals}
                    allCompanies={allCompanies}
                    mirrorPickerHierarchy={mirrorPickerHierarchy}
                    showCompletedProjects={showCompletedProjects}
                  />
                ))}
              </div>
              {/* Outside goal CollapsePanels so “Add goal” stays visible when every goal is collapsed */}
              <CompanyAddGoalFooterRow
                className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 pr-4 py-1.5"
              >
                <AddEntityMenuButton
                  kind="goal"
                  companyId={company.id}
                  label="Add goal"
                  buttonTitle="Add another goal under this company"
                  onManualAdd={async () => {
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
                      slackChannel: "",
                      slackChannelId: "",
                      status: "Not Started",
                      atRisk: false,
                      spotlight: false,
                      reviewLog: [],
                    });
                    handleNewGoalRegistered(g.id);
                  }}
                  onAiCreated={(id) => handleNewGoalRegistered(id)}
                />
              </CompanyAddGoalFooterRow>
            </>
          )}
        </div>
      </CollapsePanel>
    </div>
    </CompanySectionOverlayProvider>
  );
}

function CompanyAddGoalFooterRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={className}>{children}</div>;
}
