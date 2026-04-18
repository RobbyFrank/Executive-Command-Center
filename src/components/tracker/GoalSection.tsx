"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  Company,
  CompanyWithGoals,
  Goal,
  GoalWithProjects,
  Person,
} from "@/lib/types/tracker";
import type { Priority } from "@/lib/types/tracker";
import { PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import {
  SCORE_BAND_OPTIONS,
  parseScoreBand,
  scoreBandLabel,
} from "@/lib/tracker-score-bands";
import { computeGoalConfidence, explainGoalConfidence } from "@/lib/confidenceScore";
import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";
import { formatPriorityOverlayDisplay } from "./PrioritySelectDisplay";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { costOfDelayFormatDisplay } from "./CostOfDelayDisplay";
import { ProjectRow } from "./ProjectRow";
import {
  updateGoal,
  updateMilestone,
  deleteGoal,
  createProject,
  appendGoalReviewNote,
} from "@/server/actions/tracker";
import {
  CalendarPlus,
  ChevronRight,
  ChevronDown,
  Flag,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  Wand2,
  MessageSquare,
  MessageSquareText,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTrackerExpandBulk } from "./tracker-expand-context";
import { WarningsBadge } from "./WarningsBadge";
import { getGoalHeaderWarnings } from "@/lib/tracker-project-warnings";
import { SlackChannelPicker } from "./SlackChannelPicker";

import { CollapsePanel } from "./CollapsePanel";
import { ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX } from "@/lib/tracker-sticky-layout";
import {
  ROADMAP_DATA_COL_CLASS,
  ROADMAP_DELAY_COMPLEXITY_COL_CLASS,
  ROADMAP_ENTITY_TITLE_DISPLAY_CLASS,
  ROADMAP_GOAL_GRID_PADDING_CLASS,
  ROADMAP_GOAL_TITLE_COL_CLASS,
  ROADMAP_GRID_GAP_CLASS,
  ROADMAP_NEXT_MILESTONE_COL_CLASS,
  ROADMAP_OWNER_COL_CLASS,
  ROADMAP_PROJECT_CARD_INDENT_PX,
  ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS,
  ROADMAP_GOAL_SLACK_COL_CLASS,
} from "@/lib/tracker-roadmap-columns";
import {
  goalLatestMilestoneDueDateYmd,
  milestoneForGoalDueDateShortcut,
} from "@/lib/goal-milestone-aggregates";
import { milestoneProgressPercent } from "@/lib/milestone-progress";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
  getProjectDueDateUrgency,
  parseCalendarDateString,
} from "@/lib/relativeCalendarDate";
import { ProgressBar } from "./ProgressBar";
import { TRACKER_EMPTY_HINT_COPY_GOAL_CLASS } from "./tracker-text-actions";
import { AddEntityMenuButton } from "./AddEntityMenuButton";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { AiContextInfoIcon } from "./AiContextInfoIcon";
import { AiUpdateDialog } from "./AiUpdateDialog";
import { ReviewNotesPopover } from "./ReviewNotesPopover";
import { RowActionIcons } from "./RowActionIcons";
import { useAssistantOptional } from "@/contexts/AssistantContext";
import { useCompanySectionOverlayOptional } from "./company-section-overlay-context";

/** Align editable cells with sticky column headers (no default resting inset). */
const GRID_ALIGN = { trackerGridAlign: true as const };

/** Hover panel when the goal has no milestones yet (due column is rollup-only). Same delay/behavior as {@link AutoConfidencePercent}. */
const GOAL_EMPTY_DUE_EXPLAIN =
  "This column shows the latest milestone due date automatically. Add a project and milestones with target dates first.";

const GOAL_EMPTY_DUE_TIP_MAX_W_PX = 320;
const EMPTY_DUE_EXPLAIN_CLOSE_DELAY_MS = 200;

/** Distance from each project tree row wrapper top to the horizontal stub (project bar centerline). */
const GOAL_PROJECT_TREE_STUB_TOP_PX = 18;

interface GoalSectionProps {
  goal: GoalWithProjects;
  people: Person[];
  expandForSearch?: boolean;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
  /** Cumulative sticky offset for the goal header row (toolbar + company + goals labels). */
  roadmapGoalRowStickyTopPx: number;
  /** When this matches `goal.id`, goal title (description) opens in edit mode on mount. */
  focusGoalTitleEditId?: string | null;
  /** First-mount expanded state only (e.g. match siblings when all were collapsed). */
  initialExpanded?: boolean;
  /** Fired when this goal is expanded/collapsed so the company can default new goals consistently. */
  onExpandedChange?: (goalId: string, expanded: boolean) => void;
  /** How this goal sits in the company’s goal list — drives corner radius and separators. */
  stackPosition?: "only" | "first" | "middle" | "last";
  allGoals: Goal[];
  allCompanies: Company[];
  mirrorPickerHierarchy: CompanyWithGoals[];
  showCompletedProjects?: boolean;
}

export function GoalSection({
  goal,
  people,
  expandForSearch = false,
  ownerWorkloadMap,
  roadmapGoalRowStickyTopPx,
  focusGoalTitleEditId = null,
  initialExpanded,
  onExpandedChange,
  stackPosition = "only",
  allGoals,
  allCompanies,
  mirrorPickerHierarchy,
  showCompletedProjects = true,
}: GoalSectionProps) {
  const [expanded, setExpanded] = useState(() => initialExpanded ?? true);
  /** Keep AI context icon visible while the AI context panel is open (even if pointer left the row). */
  const [aiContextUiOpen, setAiContextUiOpen] = useState(false);
  /** After adding a project, name cell opens in edit mode so the user can type immediately. */
  const [newProjectNameFocusId, setNewProjectNameFocusId] = useState<
    string | null
  >(null);
  const assistant = useAssistantOptional();
  const [aiUpdateOpen, setAiUpdateOpen] = useState(false);

  /** Increment to focus the goal title field (context menu Rename). */
  const [goalRenameNonce, setGoalRenameNonce] = useState(0);
  const {
    bulkTick,
    expandPreset,
    focusProjectMode,
    focusedGoalId,
    setFocusedGoalId,
    setFocusedProjectId,
    focusEnforceTick,
  } = useTrackerExpandBulk();
  const goalContext = useContextMenu();
  const goalActionsRef = useRef<HTMLButtonElement>(null);
  const [goalReviewNotesNonce, setGoalReviewNotesNonce] = useState(0);

  /** Pixel height of the goal→project tree spine — ends at the last project’s horizontal stub. */
  const [projectTreeSpineHeightPx, setProjectTreeSpineHeightPx] = useState<
    number | null
  >(null);
  const projectTreeRootRef = useRef<HTMLDivElement>(null);
  const lastProjectTreeRowRef = useRef<HTMLDivElement>(null);

  const emptyDueExplainPanelId = useId();
  const emptyDueExplainBtnRef = useRef<HTMLButtonElement>(null);
  const emptyDueExplainCloseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [emptyDueExplainPanelOpen, setEmptyDueExplainPanelOpen] =
    useState(false);
  const [emptyDueExplainPlacement, setEmptyDueExplainPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const { incrementOverlay, decrementOverlay } =
    useCompanySectionOverlayOptional() ?? {};

  const clearEmptyDueExplainCloseTimer = useCallback(() => {
    if (emptyDueExplainCloseTimerRef.current != null) {
      clearTimeout(emptyDueExplainCloseTimerRef.current);
      emptyDueExplainCloseTimerRef.current = null;
    }
  }, []);

  const refreshEmptyDueExplainPlacement = useCallback(() => {
    const el = emptyDueExplainBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 6;
    const maxW = GOAL_EMPTY_DUE_TIP_MAX_W_PX;
    let left = r.left;
    const top = r.bottom + margin;
    if (left + maxW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - maxW);
    }
    setEmptyDueExplainPlacement({ top, left });
  }, []);

  const openEmptyDueExplainPanel = useCallback(() => {
    clearEmptyDueExplainCloseTimer();
    refreshEmptyDueExplainPlacement();
    setEmptyDueExplainPanelOpen(true);
  }, [clearEmptyDueExplainCloseTimer, refreshEmptyDueExplainPlacement]);

  const scheduleCloseEmptyDueExplain = useCallback(() => {
    clearEmptyDueExplainCloseTimer();
    emptyDueExplainCloseTimerRef.current = setTimeout(() => {
      setEmptyDueExplainPanelOpen(false);
      emptyDueExplainCloseTimerRef.current = null;
    }, EMPTY_DUE_EXPLAIN_CLOSE_DELAY_MS);
  }, [clearEmptyDueExplainCloseTimer]);

  const cancelCloseEmptyDueExplain = useCallback(() => {
    clearEmptyDueExplainCloseTimer();
  }, [clearEmptyDueExplainCloseTimer]);

  useLayoutEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    refreshEmptyDueExplainPlacement();
  }, [emptyDueExplainPanelOpen, refreshEmptyDueExplainPlacement]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    const onScroll = () => setEmptyDueExplainPanelOpen(false);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [emptyDueExplainPanelOpen]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    const onResize = () => refreshEmptyDueExplainPlacement();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [emptyDueExplainPanelOpen, refreshEmptyDueExplainPlacement]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmptyDueExplainPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emptyDueExplainPanelOpen]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen || !incrementOverlay || !decrementOverlay)
      return;
    incrementOverlay();
    return () => decrementOverlay();
  }, [emptyDueExplainPanelOpen, incrementOverlay, decrementOverlay]);

  const projectTreeLayoutKey = useMemo(
    () => goal.projects.map((p) => p.id).join(","),
    [goal.projects]
  );

  const measureProjectTreeSpine = useCallback(() => {
    const root = projectTreeRootRef.current;
    const last = lastProjectTreeRowRef.current;
    if (!root || !last) {
      setProjectTreeSpineHeightPx(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const stubY = lastRect.top + GOAL_PROJECT_TREE_STUB_TOP_PX;
    const h = stubY - rootRect.top;
    setProjectTreeSpineHeightPx(Math.max(0, Math.round(h)));
  }, [goal.projects.length, projectTreeLayoutKey]);

  useLayoutEffect(() => {
    if (!expanded) {
      setProjectTreeSpineHeightPx(null);
      return;
    }
    measureProjectTreeSpine();
    const root = projectTreeRootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      measureProjectTreeSpine();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [
    bulkTick,
    expanded,
    measureProjectTreeSpine,
    projectTreeLayoutKey,
    showCompletedProjects,
    expandForSearch,
  ]);

  useEffect(() => {
    onExpandedChange?.(goal.id, expanded);
  }, [goal.id, expanded, onExpandedChange]);

  useEffect(() => {
    if (!focusProjectMode || focusEnforceTick === 0) return;
    setExpanded(false);
  }, [focusProjectMode, focusEnforceTick]);

  useEffect(() => {
    if (!focusProjectMode) return;
    if (focusedGoalId !== null && focusedGoalId !== goal.id) {
      setExpanded(false);
    }
  }, [focusProjectMode, focusedGoalId, goal.id]);

  const atRiskProjectCount = useMemo(
    () => goal.projects.filter((p) => p.atRisk).length,
    [goal.projects]
  );
  const spotlightProjectCount = useMemo(
    () => goal.projects.filter((p) => p.spotlight).length,
    [goal.projects]
  );

  const collapsedSummary = useMemo(
    () => ({ projectCount: goal.projects.length }),
    [goal.projects.length]
  );

  const companyForSlackPicker = useMemo(
    () => allCompanies.find((c) => c.id === goal.companyId),
    [allCompanies, goal.companyId]
  );

  const goalHeaderWarnings = useMemo(
    () =>
      getGoalHeaderWarnings(goal, people, { includeProjectWarnings: false }),
    [goal, people]
  );

  useEffect(() => {
    if (bulkTick === 0) return;
    queueMicrotask(() => {
      if (
        expandPreset === "goals_and_projects" ||
        expandPreset === "goals_projects_milestones"
      )
        setExpanded(true);
      else if (expandPreset === "goals_only" || expandPreset === "collapse")
        setExpanded(false);
    });
  }, [bulkTick, expandPreset]);

  useEffect(() => {
    if (expandForSearch) setExpanded(true);
  }, [expandForSearch]);

  const toggleGoalExpanded = useCallback(() => {
    if (focusProjectMode) {
      if (!expanded) {
        setFocusedGoalId(goal.id);
        setFocusedProjectId(null);
        setExpanded(true);
        return;
      }
      setExpanded(false);
      setFocusedGoalId((prev) => (prev === goal.id ? null : prev));
      setFocusedProjectId((pid) =>
        pid !== null && goal.projects.some((p) => p.id === pid) ? null : pid
      );
      return;
    }
    setExpanded((v) => !v);
  }, [
    focusProjectMode,
    expanded,
    goal.id,
    goal.projects,
    setFocusedGoalId,
    setFocusedProjectId,
  ]);

  const onGoalHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest(
        "button, a, input, select, textarea"
      );
      if (el) return;
      toggleGoalExpanded();
    },
    [toggleGoalExpanded]
  );

  const priorityOptions = PriorityEnum.options.map((p) => ({
    value: p,
    label: PRIORITY_MENU_LABEL[p],
  }));
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const goalConfidenceAuto = useMemo(
    () => computeGoalConfidence(goal.projects, peopleById),
    [goal.projects, peopleById]
  );
  const goalConfidenceExplain = useMemo(
    () => explainGoalConfidence(goal, peopleById),
    [goal, peopleById]
  );

  const goalMilestonesFlat = useMemo(
    () => goal.projects.flatMap((p) => p.milestones),
    [goal.projects]
  );
  const goalLatestDueYmd = useMemo(
    () => goalLatestMilestoneDueDateYmd(goal),
    [goal]
  );
  const goalDueDateShortcutMilestone = useMemo(
    () => milestoneForGoalDueDateShortcut(goal),
    [goal]
  );
  const goalMilestonesDoneCount = useMemo(
    () => goalMilestonesFlat.filter((m) => m.status === "Done").length,
    [goalMilestonesFlat]
  );
  const goalMilestoneProgressPercent = useMemo(
    () => milestoneProgressPercent(goalMilestonesFlat),
    [goalMilestonesFlat]
  );
  const goalDueUrgency = useMemo(() => {
    const raw = goalLatestDueYmd.trim();
    if (!raw || parseCalendarDateString(raw) === null) return null;
    return getProjectDueDateUrgency(raw);
  }, [goalLatestDueYmd]);

  const ownerPerson = people.find((p) => p.id === goal.ownerId);

  const onNewProjectCreated = useCallback((id: string) => {
    setExpanded(true);
    setNewProjectNameFocusId(id);
  }, []);

  const addProjectToGoal = useCallback(async () => {
    const project = await createProject({
      goalId: goal.id,
      mirroredGoalIds: [],
      name: "New project",
      description: "",
      ownerId: "",
      assigneeIds: [],
      type: "Engineering",
      priority: "P2",
      status: "Pending",
      complexityScore: 3,
      definitionOfDone: "",
      startDate: "",
      targetDate: "",
      atRisk: false,
      spotlight: false,
      reviewLog: [],
    });
    onNewProjectCreated(project.id);
  }, [goal.id, onNewProjectCreated]);

  const goalMenuEntries = useMemo((): ContextMenuEntry[] => {
    const execBlock: ContextMenuEntry[] = [];
    if (!goal.atRisk && !goal.spotlight) {
      execBlock.push(
        {
          type: "item",
          id: "exec-at-risk",
          label: "Mark at risk",
          icon: Flag,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: true, spotlight: false }),
        },
        {
          type: "item",
          id: "exec-spotlight",
          label: "Mark spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: true }),
        }
      );
    } else if (goal.atRisk) {
      execBlock.push(
        {
          type: "item",
          id: "exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "exec-to-spotlight",
          label: "Switch to spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: true }),
        }
      );
    } else {
      execBlock.push(
        {
          type: "item",
          id: "exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "exec-to-at-risk",
          label: "Switch to at risk",
          icon: Flag,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: true, spotlight: false }),
        }
      );
    }

    return [
      {
        type: "item",
        id: "add-project",
        label: "Add project",
        icon: Plus,
        onClick: () => void addProjectToGoal(),
      },
      {
        type: "item",
        id: "rename-goal",
        label: "Rename goal",
        icon: Pencil,
        onClick: () => setGoalRenameNonce((n) => n + 1),
      },
      {
        type: "item",
        id: "ai-update-fields",
        label: "Update with AI…",
        icon: Wand2,
        onClick: () => setAiUpdateOpen(true),
      },
      ...(assistant
        ? [
            {
              type: "item" as const,
              id: "discuss-in-chat",
              label: "Discuss in chat",
              icon: MessageSquare,
              onClick: () =>
                assistant.openAssistant({
                  type: "goal",
                  id: goal.id,
                  label: goal.description,
                }),
            },
          ]
        : []),
      {
        type: "item",
        id: "review-notes",
        label: "Review notes…",
        icon: MessageSquareText,
        onClick: () => setGoalReviewNotesNonce((n) => n + 1),
      },
      { type: "divider", id: "goal-d1" },
      ...execBlock,
      { type: "divider", id: "goal-d2" },
      {
        type: "item",
        id: "expand-goal",
        label: expanded ? "Collapse goal" : "Expand goal",
        icon: expanded ? ChevronRight : ChevronDown,
        onClick: () => toggleGoalExpanded(),
      },
      { type: "divider", id: "goal-d3" },
      {
        type: "item",
        id: "delete-goal",
        label: "Delete goal…",
        icon: Trash2,
        destructive: true,
        disabled: goal.projects.length > 0,
        disabledReason: "Delete all projects under this goal first.",
        confirmMessage: `Delete this goal? This can't be undone.`,
        onClick: async () => {
          await deleteGoal(goal.id);
          toast.success(`Goal “${goal.description}” deleted.`);
        },
      },
    ];
  }, [
    addProjectToGoal,
    expanded,
    goal.atRisk,
    goal.description,
    assistant,
    goal.id,
    goal.projects.length,
    goal.spotlight,
    toggleGoalExpanded,
    setGoalRenameNonce,
  ]);

  const goalStickyTopPx =
    roadmapGoalRowStickyTopPx - ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX;

  const headerTopRounded =
    stackPosition === "only" || stackPosition === "first";

  /** Bordered slot after the goal title (project count or empty-state add controls). */
  const goalTitleMetaRuleClass =
    "-translate-y-0.5 ml-1.5 mr-1.5 border-l border-zinc-600/35 pl-2";

  return (
    <div
      className={cn(
        "max-w-full min-w-0 transition-colors duration-150",
        stackPosition === "only" && "mb-2 rounded-md",
        stackPosition === "first" && "rounded-t-md border-b border-zinc-800/45",
        stackPosition === "middle" && "border-b border-zinc-800/45",
        stackPosition === "last" && "mb-2 rounded-b-md",
        goal.atRisk &&
          "border-l-2 border-amber-400 bg-amber-950/45",
        !goal.atRisk &&
          goal.spotlight &&
          "border-l-2 border-emerald-400/85 bg-emerald-950/40"
      )}
    >
      {/* Goal header — click row (not inline controls) to expand/collapse; AI context via info icon */}
      <div
        style={{ top: goalStickyTopPx }}
        onContextMenuCapture={goalContext.onContextMenuCapture}
        className={cn(
          // Hover lives on this sticky bar (visible when collapsed); outer wrapper hover was covered
          // by opaque bg and also fired over the whole project list when expanded.
          "sticky z-[27] w-full min-w-0 max-w-full backdrop-blur-sm transition-colors duration-150 motion-reduce:transition-none",
          expanded
            ? "border-b-0 shadow-none"
            : "border-b border-zinc-800/60 shadow-[0_1px_0_rgba(0,0,0,0.2)]",
          headerTopRounded ? "rounded-t-md" : "rounded-t-none",
          goal.atRisk
            ? "bg-amber-950/85 hover:bg-amber-900/78"
            : goal.spotlight
              ? "bg-emerald-950/80 hover:bg-emerald-900/72"
              : "bg-zinc-950/95 hover:bg-zinc-900/85"
        )}
      >
        <div
          onClick={onGoalHeaderClick}
          className={cn(
            "group/goal flex min-h-[28px] w-full min-w-max max-w-full cursor-pointer items-center py-1 transition-colors",
            ROADMAP_GRID_GAP_CLASS,
            ROADMAP_GOAL_GRID_PADDING_CLASS
          )}
        >
        <div className="w-8 shrink-0 flex items-center justify-center">
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-300 ease-out pointer-events-none motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        </div>

        {/* Goal title — AI info icon inline after name; collapsed project count nudged up to align with title */}
        <div className={cn(ROADMAP_GOAL_TITLE_COL_CLASS)}>
          <InlineEditCell
            {...GRID_ALIGN}
            value={goal.description}
            onSave={(description) => updateGoal(goal.id, { description })}
            displayClassName={ROADMAP_ENTITY_TITLE_DISPLAY_CLASS}
            startInEditMode={goal.id === focusGoalTitleEditId}
            openEditNonce={goalRenameNonce}
            collapsedSuffix={
              <>
                {!expanded && collapsedSummary.projectCount > 0 && (
                  <span
                    className={cn(
                      goalTitleMetaRuleClass,
                      "inline-block whitespace-nowrap text-[10px] font-medium leading-none text-zinc-500"
                    )}
                    title={`${collapsedSummary.projectCount} project${collapsedSummary.projectCount === 1 ? "" : "s"} — click to expand`}
                  >
                    {collapsedSummary.projectCount} project
                    {collapsedSummary.projectCount === 1 ? "" : "s"}
                  </span>
                )}
                {!expanded && goal.projects.length === 0 && (
                  <div
                    className={cn(
                      goalTitleMetaRuleClass,
                      "inline-flex shrink-0 items-center gap-1",
                      "opacity-0 pointer-events-none",
                      "transition-opacity duration-300 ease-out motion-reduce:transition-none",
                      "motion-reduce:pointer-events-auto motion-reduce:opacity-100",
                      "group-hover/goal:pointer-events-auto group-hover/goal:opacity-100",
                      "group-focus-within/goal:pointer-events-auto group-focus-within/goal:opacity-100",
                      "focus-within:pointer-events-auto focus-within:opacity-100"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AddEntityMenuButton
                      kind="project"
                      goalId={goal.id}
                      label="Add project"
                      buttonTitle="Add a new project to this goal"
                      onManualAdd={() => {
                        void addProjectToGoal();
                      }}
                      onAiCreated={onNewProjectCreated}
                    />
                  </div>
                )}
                <span
                  className={cn(
                    "inline-flex items-center align-middle",
                    "transition-opacity duration-300 ease-out motion-reduce:transition-none",
                    "opacity-0 motion-reduce:opacity-100 group-hover/goal:opacity-100",
                    aiContextUiOpen && "opacity-100",
                    "pointer-events-none motion-reduce:pointer-events-auto group-hover/goal:pointer-events-auto",
                    aiContextUiOpen && "pointer-events-auto"
                  )}
                >
                  <AiContextInfoIcon
                    inline
                    variant="goal"
                    goalId={goal.id}
                    measurableTarget={goal.measurableTarget}
                    whyItMatters={goal.whyItMatters}
                    currentValue={goal.currentValue}
                    onUiOpenChange={setAiContextUiOpen}
                  />
                </span>
              </>
            }
          />
        </div>

        {/* DRI */}
        <div className={ROADMAP_OWNER_COL_CLASS}>
          <OwnerPickerCell
            {...GRID_ALIGN}
            avatarOnly
            people={people}
            value={goal.ownerId}
            onSave={(ownerId) => updateGoal(goal.id, { ownerId })}
            priority={goal.priority}
            workloadMap={ownerWorkloadMap}
            emphasizeUnassigned
            restrictToGoalDriEligible
          />
        </div>

        {/* Priority */}
        <div className={ROADMAP_DATA_COL_CLASS}>
          <InlineEditCell
            {...GRID_ALIGN}
            centerSelectTrigger
            className="group/status"
            overlaySelectQuiet
            value={goal.priority}
            onSave={(priority) => updateGoal(goal.id, { priority: priority as Priority })}
            type="select"
            options={priorityOptions}
            formatDisplay={formatPriorityOverlayDisplay}
            displayTitle={`Priority — ${PRIORITY_MENU_LABEL[goal.priority]}`}
            selectPresentation="always"
          />
        </div>

        {/* Delay cost — aligns above project Complexity */}
        <div className={ROADMAP_DELAY_COMPLEXITY_COL_CLASS}>
          <InlineEditCell
            {...GRID_ALIGN}
            className="group/status"
            overlaySelectQuiet
            value={String(goal.costOfDelay)}
            onSave={(v) =>
              updateGoal(goal.id, { costOfDelay: parseScoreBand(v) })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
            formatDisplay={costOfDelayFormatDisplay}
            displayTitle={`Delay cost — ${scoreBandLabel(goal.costOfDelay)} (${goal.costOfDelay}/5)`}
          />
        </div>

        {/* Confidence — auto: plain average of child project scores; left-aligned with project row. */}
        <div
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            "flex items-center justify-start pl-0.5",
          )}
        >
          <AutoConfidencePercent
            score={goalConfidenceAuto}
            explanation={goalConfidenceExplain}
          />
        </div>

        {/* Due date — latest milestone target date across all projects in this goal */}
        <div
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            !goalLatestDueYmd.trim() &&
              "flex items-center justify-start pl-2"
          )}
          title={
            goalLatestDueYmd.trim()
              ? [
                  formatCalendarDateHint(goalLatestDueYmd),
                  " — latest milestone due date in this goal",
                  goalDueUrgency === "past"
                    ? " — overdue"
                    : goalDueUrgency === "within24h"
                      ? " — due within 24 hours"
                      : goalDueUrgency === "within48h"
                        ? " — due within 48 hours"
                        : "",
                ].join("")
              : "Set a target date on at least one milestone under this goal’s projects"
          }
        >
          {goalLatestDueYmd.trim() ? (
            <span
              className={cn(
                "block truncate px-1 py-0.5 text-xs font-medium leading-tight",
                goalDueUrgency === "past"
                  ? "rounded border border-rose-500/40 bg-rose-950/35 text-rose-200 ring-1 ring-rose-500/25"
                  : goalDueUrgency === "within24h"
                    ? "rounded border border-orange-500/40 bg-orange-950/35 text-orange-200 ring-1 ring-orange-500/30"
                    : goalDueUrgency === "within48h"
                      ? "rounded border border-yellow-500/35 bg-yellow-950/25 text-yellow-200 ring-1 ring-yellow-500/25"
                      : "text-zinc-200"
              )}
            >
              {formatRelativeCalendarDate(goalLatestDueYmd, new Date(), {
                omitFuturePreposition: true,
              })}
            </span>
          ) : goalDueDateShortcutMilestone ? (
            <InlineEditCell
              {...GRID_ALIGN}
              key={goalDueDateShortcutMilestone.id}
              type="date"
              value={goalDueDateShortcutMilestone.targetDate}
              onSave={(targetDate) =>
                void updateMilestone(goalDueDateShortcutMilestone.id, {
                  targetDate,
                })
              }
              displayTitle="Set milestone due date (goal column shows the latest date in this goal)"
              emptyLabel={
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 not-italic transition-colors hover:bg-zinc-800/55 hover:text-zinc-300"
                  aria-hidden
                >
                  <CalendarPlus
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>
              }
            />
          ) : (
            <button
              ref={emptyDueExplainBtnRef}
              type="button"
              aria-expanded={emptyDueExplainPanelOpen}
              aria-describedby={
                emptyDueExplainPanelOpen ? emptyDueExplainPanelId : undefined
              }
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={openEmptyDueExplainPanel}
              onMouseLeave={scheduleCloseEmptyDueExplain}
              onFocus={openEmptyDueExplainPanel}
              onBlur={scheduleCloseEmptyDueExplain}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800/55 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/45"
              aria-label="No milestone due date yet — add projects and milestones with target dates; latest shows here automatically"
            >
              <CalendarPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>

        {/* Progress — all milestones in this goal */}
        <div className={ROADMAP_DATA_COL_CLASS}>
          <ProgressBar
            percent={goalMilestoneProgressPercent}
            label={`${goalMilestonesDoneCount}/${goalMilestonesFlat.length}`}
            title={`${goalMilestonesDoneCount} of ${goalMilestonesFlat.length} milestones complete in this goal (${goalMilestoneProgressPercent}%)`}
          />
        </div>

        {/* Slack channel name (always visible; column header shows Slack mark) — after Progress */}
        <div className={ROADMAP_GOAL_SLACK_COL_CLASS}>
          <SlackChannelPicker
            channelName={goal.slackChannel}
            channelId={goal.slackChannelId ?? ""}
            onSave={({ name, id }) =>
              updateGoal(goal.id, { slackChannel: name, slackChannelId: id })
            }
            companyName={companyForSlackPicker?.name}
            companyShortName={companyForSlackPicker?.shortName}
            trackerGridAlign
            variant="plain"
          />
        </div>

        <div className={ROADMAP_NEXT_MILESTONE_COL_CLASS} aria-hidden />

        <div className="min-w-2 flex-1" aria-hidden={true} />

        {/* At risk / Spotlight + project counts (collapsed) + warnings — right cluster */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 flex-wrap">
          {goal.atRisk && (
            <span
              className="whitespace-nowrap rounded-md border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/95"
              title="Marked at risk"
            >
              At risk
            </span>
          )}
          {goal.spotlight && (
            <span
              className="whitespace-nowrap rounded-md border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95"
              title="Spotlight — win or momentum"
            >
              Spotlight
            </span>
          )}
          {!expanded && atRiskProjectCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200/95"
              title={`${atRiskProjectCount} project${
                atRiskProjectCount === 1 ? "" : "s"
              } at risk — expand to view`}
            >
              <Flag className="h-3 w-3 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">
                {atRiskProjectCount} at risk
              </span>
            </span>
          )}
          {!expanded && spotlightProjectCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200/95"
              title={`${spotlightProjectCount} project${
                spotlightProjectCount === 1 ? "" : "s"
              } in spotlight — expand to view`}
            >
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">
                {spotlightProjectCount} spotlight
              </span>
            </span>
          )}
          {goalHeaderWarnings.length > 0 ? (
            <WarningsBadge warnings={goalHeaderWarnings} />
          ) : null}
        </div>

        <RowActionIcons rowGroup="goal" forceVisible={goal.atRisk || goal.spotlight}>
          <button
            ref={goalActionsRef}
            type="button"
            title="Goal actions"
            aria-label={`More actions for goal ${goal.description}`}
            aria-haspopup="menu"
            aria-expanded={goalContext.open}
            onClick={goalContext.openFromTrigger}
            className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        </RowActionIcons>
        </div>
      </div>
      <ContextMenu
        open={goalContext.open}
        x={goalContext.x}
        y={goalContext.y}
        onClose={goalContext.close}
        scope="goal"
        ariaLabel={`Actions for goal ${goal.description}`}
        entries={goalMenuEntries}
      />
      <ReviewNotesPopover
        anchorRef={goalActionsRef}
        openNonce={goalReviewNotesNonce}
        entries={goal.reviewLog}
        onAppendNote={(t) => appendGoalReviewNote(goal.id, t)}
      />

      {/* Projects */}
      <CollapsePanel
        open={expanded}
        transitionClassName="duration-[300ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150"
        innerClassName={cn(
          "transition-opacity duration-[280ms] ease-out motion-reduce:transition-none motion-reduce:opacity-100",
          expanded ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="group/project-area">
          {/* Tree: spine at x=32px; stubs at x=33px; project cards from x=56px — same for real projects and empty placeholder. */}
          <div className="pb-3">
            <div ref={projectTreeRootRef} className="relative pt-3">
              <div
                aria-hidden
                className="pointer-events-none absolute left-[32px] top-0 w-px bg-zinc-700/55"
                style={
                  projectTreeSpineHeightPx != null
                    ? { height: projectTreeSpineHeightPx }
                    : undefined
                }
              />
              <div className="relative flex flex-col gap-3">
                {goal.projects.length > 0
                  ? goal.projects.map((project, idx) => (
                      <div
                        key={project.id}
                        ref={
                          idx === goal.projects.length - 1
                            ? lastProjectTreeRowRef
                            : undefined
                        }
                        className="relative"
                      >
                        <div
                          aria-hidden
                          className="pointer-events-none absolute left-[33px] h-px w-[23px] bg-zinc-700/55"
                          style={{ top: GOAL_PROJECT_TREE_STUB_TOP_PX }}
                        />
                        <div
                          style={{ marginLeft: ROADMAP_PROJECT_CARD_INDENT_PX }}
                        >
                          <ProjectRow
                            goalId={goal.id}
                            project={project}
                            people={people}
                            expandForSearch={expandForSearch}
                            goalCostOfDelay={goal.costOfDelay}
                            ownerWorkloadMap={ownerWorkloadMap}
                            focusProjectNameEditId={newProjectNameFocusId}
                            allGoals={allGoals}
                            allCompanies={allCompanies}
                            mirrorPickerHierarchy={mirrorPickerHierarchy}
                            showCompletedProjects={showCompletedProjects}
                            goalSlackChannelId={goal.slackChannelId ?? ""}
                            goalSlackChannelName={goal.slackChannel ?? ""}
                          />
                        </div>
                      </div>
                    ))
                  : (
                      <div ref={lastProjectTreeRowRef} className="relative">
                        <div
                          aria-hidden
                          className="pointer-events-none absolute left-[33px] h-px w-[23px] bg-zinc-700/55"
                          style={{ top: GOAL_PROJECT_TREE_STUB_TOP_PX }}
                        />
                        <div
                          style={{ marginLeft: ROADMAP_PROJECT_CARD_INDENT_PX }}
                        >
                          <div className={ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-900 bg-zinc-950/55 px-3 py-2">
                              <AddEntityMenuButton
                                kind="project"
                                goalId={goal.id}
                                label="Add project"
                                buttonTitle="Add a new project to this goal"
                                onManualAdd={() => {
                                  void addProjectToGoal();
                                }}
                                onAiCreated={onNewProjectCreated}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
              </div>
            </div>
            {goal.projects.length > 0 ? (
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pr-3 pt-0.5"
                style={{ paddingLeft: ROADMAP_PROJECT_CARD_INDENT_PX }}
              >
                <AddEntityMenuButton
                  kind="project"
                  goalId={goal.id}
                  label="Add project"
                  buttonTitle="Add another project to this goal"
                  onManualAdd={() => {
                    void addProjectToGoal();
                  }}
                  onAiCreated={onNewProjectCreated}
                />
              </div>
            ) : null}
          </div>
        </div>
      </CollapsePanel>

      {aiUpdateOpen && (
        <AiUpdateDialog
          type="goal"
          goalId={goal.id}
          measurableTarget={goal.measurableTarget}
          whyItMatters={goal.whyItMatters}
          currentValue={goal.currentValue}
          onClose={() => setAiUpdateOpen(false)}
        />
      )}

      {emptyDueExplainPanelOpen &&
        emptyDueExplainPlacement &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={emptyDueExplainPanelId}
            role="tooltip"
            className="pointer-events-auto fixed z-[200] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-zinc-600/90 bg-zinc-900 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300 shadow-xl"
            style={{
              top: emptyDueExplainPlacement.top,
              left: emptyDueExplainPlacement.left,
            }}
            onMouseEnter={cancelCloseEmptyDueExplain}
            onMouseLeave={scheduleCloseEmptyDueExplain}
          >
            {GOAL_EMPTY_DUE_EXPLAIN}
          </div>,
          document.body
        )}
    </div>
  );
}
