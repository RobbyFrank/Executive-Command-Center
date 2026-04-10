"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GoalWithProjects, Person } from "@/lib/types/tracker";
import type { Priority } from "@/lib/types/tracker";
import { PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import {
  SCORE_BAND_OPTIONS,
  parseScoreBand,
} from "@/lib/tracker-score-bands";
import { computeGoalConfidence, explainGoalConfidence } from "@/lib/confidenceScore";
import { prioritySelectTextClass } from "@/lib/prioritySort";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { ProjectRow } from "./ProjectRow";
import {
  updateGoal,
  deleteGoal,
  createGoal,
  createProject,
  markGoalReviewed,
} from "@/server/actions/tracker";
import {
  AlertTriangle,
  ChevronRight,
  Plus,
  ArrowRightLeft,
  Layers,
  Flag,
  Sparkles,
} from "lucide-react";
import { ReviewAction } from "./ReviewAction";
import { cn } from "@/lib/utils";
import { clampAutonomy, isFounderPersonId } from "@/lib/autonomyRoster";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";
import { useTrackerExpandBulk } from "./tracker-expand-context";
import { getSequentialQueueProjects } from "@/lib/sequentialProjects";
import { ProjectsColumnHeaders } from "./TrackerColumnHeaders";
import { formatSlackChannelHash } from "@/lib/slackDisplay";

import { ExecFlagMenu } from "./ExecFlagMenu";
import { CollapsePanel } from "./CollapsePanel";
import {
  ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX,
  TRACKER_GOAL_HEADER_ROW_FALLBACK_PX,
} from "@/lib/tracker-sticky-layout";

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
}

export function GoalSection({
  goal,
  people,
  expandForSearch = false,
  ownerWorkloadMap,
  roadmapGoalRowStickyTopPx,
  focusGoalTitleEditId = null,
  onGoalCreated,
}: GoalSectionProps) {
  const [expanded, setExpanded] = useState(true);
  /** After adding a project, name cell opens in edit mode so the user can type immediately. */
  const [newProjectNameFocusId, setNewProjectNameFocusId] = useState<
    string | null
  >(null);
  const [sequentialShowAll, setSequentialShowAll] = useState(false);
  const {
    bulkTick,
    bulkTarget,
    focusProjectMode,
    focusedGoalId,
    setFocusedGoalId,
    setFocusedProjectId,
    focusEnforceTick,
  } = useTrackerExpandBulk();

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

  const isSequentialMulti =
    goal.executionMode === "Sync" && goal.projects.length > 1;

  const sequentialQueueSlice = useMemo(() => {
    if (!isSequentialMulti) return null;
    return getSequentialQueueProjects(goal.projects);
  }, [goal.projects, isSequentialMulti]);

  const queueSliceIdSet = useMemo(() => {
    if (!sequentialQueueSlice) return null;
    return new Set(sequentialQueueSlice.map((p) => p.id));
  }, [sequentialQueueSlice]);

  const hiddenSequentialCount =
    isSequentialMulti && !sequentialShowAll && sequentialQueueSlice
      ? goal.projects.length - sequentialQueueSlice.length
      : 0;

  const atRiskProjectCount = useMemo(
    () => goal.projects.filter((p) => p.atRisk).length,
    [goal.projects]
  );
  const spotlightProjectCount = useMemo(
    () => goal.projects.filter((p) => p.spotlight).length,
    [goal.projects]
  );

  const collapsedSummary = useMemo(() => {
    const projects = goal.projects;
    const projectCount = projects.length;
    let warningCount = 0;
    const highCod = goal.costOfDelay >= 4;

    for (const p of projects) {
      if (p.milestones.length === 0) warningCount++;
      if (p.milestones.some((ms) => ms.status !== "Done" && !ms.targetDate?.trim()))
        warningCount++;
      const raw = p.targetDate?.trim() ?? "";
      if (!raw || parseCalendarDateString(raw) === null) warningCount++;
      if (!p.ownerId) warningCount++;
      if (highCod && p.ownerId) {
        const owner = people.find((o) => o.id === p.ownerId);
        if (owner && !isFounderPersonId(owner.id) && clampAutonomy(owner.autonomyScore) < 4)
          warningCount++;
      }
    }
    return { projectCount, warningCount };
  }, [goal.projects, goal.costOfDelay, people]);

  useEffect(() => {
    if (bulkTick === 0) return;
    queueMicrotask(() => {
      if (
        bulkTarget === "goals_and_projects" ||
        bulkTarget === "goals_projects_milestones"
      )
        setExpanded(true);
      else if (bulkTarget === "goals_only" || bulkTarget === "collapse")
        setExpanded(false);
    });
  }, [bulkTick, bulkTarget]);

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
    () => computeGoalConfidence(goal.projects, peopleById),
    [goal.projects, peopleById]
  );
  const goalConfidenceExplain = useMemo(
    () => explainGoalConfidence(goal, peopleById),
    [goal, peopleById]
  );
  const ownerPerson = people.find((p) => p.id === goal.ownerId);
  const isUnassigned = !goal.ownerId;

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
    goal.measurableTarget,
    goal.currentValue,
    goal.atRisk,
    goal.spotlight,
    expanded,
  ]);

  const goalStickyTopPx =
    roadmapGoalRowStickyTopPx - ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX;
  const projectsColumnStackTopPx = goalStickyTopPx + goalHeaderPx;

  return (
    <div
      className={cn(
        "group/goal mb-2 max-w-full min-w-0",
        goal.atRisk &&
          "rounded-md border-l-4 border-amber-400 bg-amber-950/45 shadow-[inset_6px_0_0_0_rgba(251,191,36,0.35)] ring-1 ring-amber-500/30",
        !goal.atRisk &&
          goal.spotlight &&
          "rounded-md border-l-4 border-emerald-400/85 bg-emerald-950/40 shadow-[inset_6px_0_0_0_rgba(52,211,153,0.28)] ring-1 ring-emerald-500/25"
      )}
    >
      {/* Goal header — click row (not inline controls) to expand/collapse */}
      <div
        ref={goalHeaderRef}
        onClick={onGoalHeaderClick}
        style={{ top: goalStickyTopPx }}
        className={cn(
          "sticky z-[27] group flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-2 transition-colors rounded-md cursor-pointer",
          "shadow-[0_1px_0_rgba(0,0,0,0.2)] backdrop-blur-sm",
          goal.atRisk
            ? "bg-amber-950/85 hover:bg-amber-950/55"
            : goal.spotlight
              ? "bg-emerald-950/80 hover:bg-emerald-950/48"
              : "bg-zinc-950/90 hover:bg-zinc-900/60"
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

        {/* Description */}
        <div className="w-[280px] min-w-0 shrink-0">
          <InlineEditCell
            value={goal.description}
            onSave={(description) => updateGoal(goal.id, { description })}
            displayClassName="font-medium text-zinc-200"
            startInEditMode={goal.id === focusGoalTitleEditId}
          />
        </div>

        {/* Owner */}
        <div className="w-40 min-w-0 shrink-0">
          <OwnerPickerCell
            people={people}
            value={goal.ownerId}
            onSave={(ownerId) => updateGoal(goal.id, { ownerId })}
            priority={goal.priority}
            workloadMap={ownerWorkloadMap}
          />
        </div>

        {/* Priority */}
        <div className="w-14 shrink-0">
          <InlineEditCell
            value={goal.priority}
            onSave={(priority) => updateGoal(goal.id, { priority: priority as Priority })}
            type="select"
            options={priorityOptions}
            displayClassName={cn("font-medium", prioritySelectTextClass(goal.priority))}
          />
        </div>

        <div className="w-44 shrink-0 min-w-0">
          <InlineEditCell
            value={goal.measurableTarget}
            onSave={(measurableTarget) =>
              updateGoal(goal.id, { measurableTarget })
            }
            placeholder="Add description"
            displayClassName="text-zinc-100 font-medium"
            displayTruncateSingleLine
          />
        </div>

        <div className="w-44 shrink-0 min-w-0">
          <InlineEditCell
            value={goal.currentValue}
            onSave={(currentValue) =>
              updateGoal(goal.id, { currentValue })
            }
            placeholder="Current value"
            displayClassName="text-zinc-100 font-medium"
            displayTruncateSingleLine
          />
        </div>

        {/* Impact (higher = better) */}
        <div
          className="w-44 shrink-0"
          title="Impact — higher is more valuable"
        >
          <InlineEditCell
            value={String(goal.impactScore)}
            onSave={(v) =>
              updateGoal(goal.id, { impactScore: parseScoreBand(v) })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
          />
        </div>

        {/* Pad to align with project Complexity column */}
        <div className="w-28 shrink-0" aria-hidden />

        {/* Confidence — auto: average of project scores */}
        <div className="w-28 shrink-0 flex items-center justify-end pr-0.5">
          <AutoConfidencePercent
            score={goalConfidenceAuto}
            explanation={goalConfidenceExplain}
          />
        </div>

        {/* Cost of Delay */}
        <div className="w-32 shrink-0">
          <InlineEditCell
            value={String(goal.costOfDelay)}
            onSave={(v) =>
              updateGoal(goal.id, { costOfDelay: parseScoreBand(v) })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
          />
        </div>

        {/* Execution Mode */}
        <div className="w-28 shrink-0" title={`Execution: ${goal.executionMode}`}>
          <button
            type="button"
            onClick={() =>
              updateGoal(goal.id, {
                executionMode:
                  goal.executionMode === "Sync" ? "Async" : "Sync",
              })
            }
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors",
              goal.executionMode === "Sync"
                ? "bg-purple-500/20 text-purple-400"
                : "bg-cyan-500/20 text-cyan-400"
            )}
          >
            {goal.executionMode === "Sync" ? (
              <Layers className="h-3 w-3" />
            ) : (
              <ArrowRightLeft className="h-3 w-3" />
            )}
            {goal.executionMode}
          </button>
        </div>

        {/* Slack channel name (always visible; column header shows Slack mark) */}
        <div
          className="flex w-44 shrink-0 min-w-0 items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditCell
            variant="plain"
            value={goal.slackChannel}
            onSave={(slackChannel) =>
              updateGoal(goal.id, { slackChannel })
            }
            placeholder="vd-sales"
            displayClassName="text-zinc-300 font-medium min-w-0 not-italic"
            formatDisplay={(v) => formatSlackChannelHash(v)}
            emptyLabel="Add channel"
            displayTitle="Slack channel — click to edit"
          />
        </div>

        <div className="min-w-2 flex-1" aria-hidden={true} />

        {/* Review (72h staleness vs 24h on projects) — before signal badges so column aligns with GoalsColumnHeaders */}
        <div className="w-[5.5rem] shrink-0 flex justify-end">
          <ReviewAction
            kind="goal"
            lastReviewed={goal.lastReviewed}
            onConfirm={() => markGoalReviewed(goal.id)}
            ownerAutonomy={ownerPerson?.autonomyScore}
          />
        </div>

        {/* At risk / Spotlight + project counts (collapsed) + Unassigned — right cluster */}
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
          {!expanded && collapsedSummary.warningCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-orange-400/30 bg-orange-500/8 px-1.5 py-0.5 text-[10px] font-medium text-orange-300/80"
              title={`${collapsedSummary.warningCount} warning${collapsedSummary.warningCount === 1 ? "" : "s"} across projects — expand to review`}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              {collapsedSummary.warningCount} warning{collapsedSummary.warningCount === 1 ? "" : "s"}
            </span>
          )}
          {isUnassigned && (
            <span
              className="whitespace-nowrap rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300/85"
              title="No owner assigned"
            >
              Unassigned
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <ExecFlagMenu
            atRisk={goal.atRisk}
            spotlight={goal.spotlight}
            entityLabel="Goal"
            onCommit={(flags) => updateGoal(goal.id, flags)}
          />
          <ConfirmDeletePopover
            entityName="this goal and all its projects"
            onConfirm={() => deleteGoal(goal.id)}
          />
        </div>
      </div>

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
          <ProjectsColumnHeaders
            stackTopPx={projectsColumnStackTopPx}
            stickyZClass="z-[26]"
          />

          {goal.projects.map((project, idx) => {
            const rowRevealed =
              !isSequentialMulti ||
              sequentialShowAll ||
              (queueSliceIdSet?.has(project.id) ?? true);

            const rowInner = (
              <div className="relative">
                {isSequentialMulti && (
                  <span className="absolute left-6 top-3 text-xs text-purple-400/40 font-mono">
                    {idx + 1}.
                  </span>
                )}
                <ProjectRow
                  goalId={goal.id}
                  project={project}
                  people={people}
                  expandForSearch={expandForSearch}
                  goalCostOfDelay={goal.costOfDelay}
                  ownerWorkloadMap={ownerWorkloadMap}
                  focusProjectNameEditId={newProjectNameFocusId}
                />
              </div>
            );

            if (!isSequentialMulti) {
              return <div key={project.id}>{rowInner}</div>;
            }

            return (
              <div
                key={project.id}
                className={cn(
                  "grid transition-[grid-template-rows] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150 motion-reduce:transition-none",
                  rowRevealed ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
                <div
                  className={cn(
                    "min-h-0 transition-opacity duration-[320ms] ease-out motion-reduce:transition-none motion-reduce:opacity-100",
                    rowRevealed ? "overflow-visible opacity-100" : "overflow-hidden opacity-0"
                  )}
                  inert={rowRevealed ? undefined : true}
                  aria-hidden={!rowRevealed}
                >
                  {rowInner}
                </div>
              </div>
            );
          })}

          {isSequentialMulti && goal.projects.length > 0 && (
            <div className="pl-6 pr-4 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-1.5 text-[11px] leading-snug">
              <span
                className="text-zinc-500"
                title="Runs in dependency order: finished work, current step, then what is next"
              >
                Sequential
              </span>
              <button
                type="button"
                onClick={() => setSequentialShowAll((v) => !v)}
                className="font-medium text-purple-300/90 hover:text-purple-200 underline-offset-2 hover:underline transition-colors"
                title={
                  sequentialShowAll
                    ? "Show only completed work and the current step (hide later stages)"
                    : "Show every project in this goal"
                }
              >
                {sequentialShowAll ? "Queue only" : "Show all"}
              </button>
              {hiddenSequentialCount > 0 && (
                <span className="text-zinc-600 tabular-nums">
                  · {hiddenSequentialCount} later hidden
                </span>
              )}
            </div>
          )}

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
              onClick={async () => {
                const project = await createProject({
                  goalId: goal.id,
                  name: "New project",
                  ownerId: "",
                  assigneeIds: [],
                  type: "Engineering",
                  priority: "P2",
                  status: "Not Started",
                  complexityScore: 3,
                  definitionOfDone: "",
                  startDate: "",
                  targetDate: "",
                  slackUrl: "",
                  lastReviewed: "",
                  atRisk: false,
                  spotlight: false,
                });
                setNewProjectNameFocusId(project.id);
              }}
              className="inline-flex w-fit cursor-pointer items-center gap-2 rounded text-xs text-zinc-600 transition-colors hover:text-zinc-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50"
            >
              <Plus className="h-3 w-3" />
              Add project
            </button>
            <button
              type="button"
              onClick={async () => {
                const g = await createGoal({
                  companyId: goal.companyId,
                  description: "New goal",
                  measurableTarget: "",
                  currentValue: "",
                  impactScore: 3,
                  confidenceScore: 3,
                  costOfDelay: 3,
                  ownerId: "",
                  priority: "P2",
                  executionMode: "Async",
                  slackChannel: "",
                  lastReviewed: "",
                  status: "Not Started",
                  atRisk: false,
                  spotlight: false,
                });
                onGoalCreated?.(g.id);
              }}
              className="inline-flex w-fit cursor-pointer items-center gap-2 rounded text-xs text-zinc-600 transition-colors hover:text-zinc-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50"
            >
              <Plus className="h-3 w-3" />
              Add goal
            </button>
          </div>
        </div>
      </CollapsePanel>
    </div>
  );
}
