"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { prioritySelectTextClass } from "@/lib/prioritySort";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { costOfDelayFormatDisplay } from "./CostOfDelayDisplay";
import { ProjectRow } from "./ProjectRow";
import {
  updateGoal,
  deleteGoal,
  createGoal,
  createProject,
  appendGoalReviewNote,
} from "@/server/actions/tracker";
import {
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
import { useTrackerExpandBulk } from "./tracker-expand-context";
import { ProjectsColumnHeaders } from "./TrackerColumnHeaders";
import { WarningsBadge } from "./WarningsBadge";
import { getGoalHeaderWarnings } from "@/lib/tracker-project-warnings";
import { SlackChannelPicker } from "./SlackChannelPicker";

import { CollapsePanel } from "./CollapsePanel";
import {
  ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX,
  TRACKER_GOAL_HEADER_ROW_FALLBACK_PX,
} from "@/lib/tracker-sticky-layout";
import {
  TRACKER_EMPTY_HINT_COPY_GOAL_CLASS,
  TRACKER_FOOTER_TEXT_ACTION,
  TRACKER_INLINE_TEXT_ACTION,
} from "./tracker-text-actions";
import { AiCreateButton } from "./AiCreateButton";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { AiContextInfoIcon } from "./AiContextInfoIcon";
import { AiUpdateDialog } from "./AiUpdateDialog";
import { ReviewNotesPopover } from "./ReviewNotesPopover";
import { RowActionIcons } from "./RowActionIcons";
import { useAssistantOptional } from "@/contexts/AssistantContext";

/** Align editable cells with sticky column headers (no default resting inset). */
const GRID_ALIGN = { trackerGridAlign: true as const };

interface GoalSectionProps {
  goal: GoalWithProjects;
  people: Person[];
  expandForSearch?: boolean;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
  /** Cumulative sticky offset for the goal header row (toolbar + company + goals labels). */
  roadmapGoalRowStickyTopPx: number;
  /** When this matches `goal.id`, goal title (description) opens in edit mode on mount. */
  focusGoalTitleEditId?: string | null;
  /** Notify parent so it can set `focusGoalTitleEditId` after creating a goal from this section. */
  onGoalCreated?: (goalId: string) => void;
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
  onGoalCreated,
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
      getGoalHeaderWarnings(goal, people, {
        includeProjectWarnings: !expanded,
      }),
    [goal, people, expanded]
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

  const priorityOptions = PriorityEnum.options.map((p) => ({ value: p, label: p }));
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const goalConfidenceAuto = useMemo(
    () => computeGoalConfidence(goal.projects, peopleById, goal.costOfDelay),
    [goal.projects, peopleById, goal.costOfDelay]
  );
  const goalConfidenceExplain = useMemo(
    () => explainGoalConfidence(goal, peopleById),
    [goal, peopleById]
  );
  const ownerPerson = people.find((p) => p.id === goal.ownerId);

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
    setNewProjectNameFocusId(project.id);
  }, [goal.id]);

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
        id: "add-goal",
        label: "Add goal (same company)",
        icon: Plus,
        onClick: async () => {
          const g = await createGoal({
            companyId: goal.companyId,
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
          onGoalCreated?.(g.id);
        },
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
        onClick: () => deleteGoal(goal.id),
      },
    ];
  }, [
    addProjectToGoal,
    expanded,
    goal.atRisk,
    goal.companyId,
    goal.description,
    assistant,
    goal.id,
    goal.projects.length,
    goal.spotlight,
    onGoalCreated,
    toggleGoalExpanded,
    setGoalRenameNonce,
  ]);

  const goalHeaderRef = useRef<HTMLDivElement>(null);
  const [goalHeaderPx, setGoalHeaderPx] = useState(
    TRACKER_GOAL_HEADER_ROW_FALLBACK_PX
  );

  useLayoutEffect(() => {
    const el = goalHeaderRef.current;
    if (!el) return;
    const apply = () =>
      setGoalHeaderPx(Math.round(el.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    goal.description,
    goal.atRisk,
    goal.spotlight,
    expanded,
  ]);

  const goalStickyTopPx =
    roadmapGoalRowStickyTopPx - ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX;
  const projectsColumnStackTopPx = goalStickyTopPx + goalHeaderPx;

  const headerTopRounded =
    stackPosition === "only" || stackPosition === "first";

  return (
    <div
      className={cn(
        "group/goal max-w-full min-w-0 transition-colors duration-150",
        stackPosition === "only" && "mb-2 rounded-md",
        stackPosition === "first" && "rounded-t-md border-b border-zinc-800/45",
        stackPosition === "middle" && "border-b border-zinc-800/45",
        stackPosition === "last" && "mb-2 rounded-b-md",
        !goal.atRisk &&
          !goal.spotlight &&
          "hover:bg-zinc-900/30",
        goal.atRisk &&
          "border-l-4 border-amber-400 bg-amber-950/45 shadow-[inset_6px_0_0_0_rgba(251,191,36,0.35)] ring-1 ring-amber-500/30 hover:bg-amber-950/55",
        !goal.atRisk &&
          goal.spotlight &&
          "border-l-4 border-emerald-400/85 bg-emerald-950/40 shadow-[inset_6px_0_0_0_rgba(52,211,153,0.28)] ring-1 ring-emerald-500/25 hover:bg-emerald-950/48"
      )}
    >
      {/* Goal header — click row (not inline controls) to expand/collapse; AI context via info icon */}
      <div
        ref={goalHeaderRef}
        style={{ top: goalStickyTopPx }}
        onContextMenuCapture={goalContext.onContextMenuCapture}
        className={cn(
          "sticky z-[27] w-full min-w-0 max-w-full shadow-[0_1px_0_rgba(0,0,0,0.2)] backdrop-blur-sm",
          headerTopRounded ? "rounded-t-md" : "rounded-t-none",
          goal.atRisk
            ? "bg-amber-950/85"
            : goal.spotlight
              ? "bg-emerald-950/80"
              : "bg-zinc-950/90"
        )}
      >
        <div
          onClick={onGoalHeaderClick}
          className={cn(
            "group/goal-header flex w-full min-w-max cursor-pointer items-center gap-2 py-1.5 pl-6 pr-4 transition-colors"
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

        {/* Goal title — AI info icon inline after name text (row hover to show) */}
        <div className="w-[360px] min-w-0 shrink-0">
          <InlineEditCell
            {...GRID_ALIGN}
            value={goal.description}
            onSave={(description) => updateGoal(goal.id, { description })}
            displayClassName="font-semibold text-zinc-100"
            startInEditMode={goal.id === focusGoalTitleEditId}
            openEditNonce={goalRenameNonce}
            collapsedSuffix={
              <span
                className={cn(
                  "inline-flex items-center align-middle transition-opacity duration-150",
                  "opacity-0 group-hover/goal-header:opacity-100",
                  aiContextUiOpen && "opacity-100",
                  "pointer-events-none group-hover/goal-header:pointer-events-auto",
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
            }
          />
        </div>

        {/* DRI */}
        <div className="w-[5.85rem] min-w-0 shrink-0">
          <OwnerPickerCell
            {...GRID_ALIGN}
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
        <div className="w-14 shrink-0">
          <InlineEditCell
            {...GRID_ALIGN}
            value={goal.priority}
            onSave={(priority) => updateGoal(goal.id, { priority: priority as Priority })}
            type="select"
            options={priorityOptions}
            displayClassName={cn("font-medium", prioritySelectTextClass(goal.priority))}
          />
        </div>

        {/* Cost of delay — w-28 aligns above project Complexity */}
        <div className="w-28 shrink-0 min-w-0">
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
            displayTitle={`Cost of delay — ${scoreBandLabel(goal.costOfDelay)} (${goal.costOfDelay}/5)`}
          />
        </div>

        {/* Confidence — auto: average of project scores; w-28 aligns with project Confidence */}
        <div className="w-28 shrink-0 flex items-center justify-end pr-0.5">
          <AutoConfidencePercent
            score={goalConfidenceAuto}
            explanation={goalConfidenceExplain}
          />
        </div>

        {/* Slack channel name (always visible; column header shows Slack mark) */}
        <div className="w-52 shrink-0 min-w-0">
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
          {!expanded && collapsedSummary.projectCount > 0 && (
            <span
              className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium text-zinc-500"
              title={`${collapsedSummary.projectCount} project${collapsedSummary.projectCount === 1 ? "" : "s"} — click to expand`}
            >
              {collapsedSummary.projectCount} project{collapsedSummary.projectCount === 1 ? "" : "s"}
            </span>
          )}
          {goalHeaderWarnings.length === 1 && (
            <span
              className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95"
              title={goalHeaderWarnings[0].title}
            >
              {goalHeaderWarnings[0].label}
            </span>
          )}
          {goalHeaderWarnings.length > 1 && (
            <WarningsBadge warnings={goalHeaderWarnings} />
          )}
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
        <div>
          {goal.projects.length > 0 && (
            <div className="rounded-r-md border-l-2 border-zinc-700/50 bg-zinc-900/25 shadow-[inset_1px_0_0_rgba(0,0,0,0.2)]">
              <ProjectsColumnHeaders
                stackTopPx={projectsColumnStackTopPx}
                stickyZClass="z-[26]"
              />

              {goal.projects.map((project) => (
                <div key={project.id}>
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
              ))}
            </div>
          )}

          {goal.projects.length === 0 && (
            <div className="pl-6 pr-4 py-1.5">
              <div
                className={cn(
                  "m-0 w-full min-w-0",
                  TRACKER_EMPTY_HINT_COPY_GOAL_CLASS
                )}
              >
                No projects yet.&nbsp;
                <button
                  type="button"
                  title="Add a new project to this goal"
                  onClick={(e) => {
                    e.stopPropagation();
                    void addProjectToGoal();
                  }}
                  className={TRACKER_INLINE_TEXT_ACTION}
                >
                  Add project
                </button>
                <AiCreateButton
                  type="project"
                  goalId={goal.id}
                  onCreated={(id) => setNewProjectNameFocusId(id)}
                  inline
                />
              </div>
            </div>
          )}

          {/* Add project only when goal expanded; “Add goal” lives on CompanySection (visible when goals collapsed) */}
          {goal.projects.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 pr-4 py-1.5",
                "opacity-0 pointer-events-none transition-opacity duration-150",
                "group-hover/goal:pointer-events-auto group-hover/goal:opacity-100",
                "group-focus-within/goal:pointer-events-auto group-focus-within/goal:opacity-100",
                "focus-within:pointer-events-auto focus-within:opacity-100"
              )}
            >
              <button
                type="button"
                title="Add a new project to this goal"
                onClick={() => void addProjectToGoal()}
                className={TRACKER_FOOTER_TEXT_ACTION}
              >
                Add project
              </button>
              <AiCreateButton
                type="project"
                goalId={goal.id}
                onCreated={(id) => setNewProjectNameFocusId(id)}
              />
            </div>
          )}
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
    </div>
  );
}
