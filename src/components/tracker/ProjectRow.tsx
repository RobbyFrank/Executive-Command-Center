"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ProjectWithMilestones,
  Person,
  ProjectStatus,
  Priority,
  Goal,
  Company,
  CompanyWithGoals,
} from "@/lib/types/tracker";
import { PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import { ProgressBar } from "./ProgressBar";
import {
  SCORE_BAND_OPTIONS,
  parseScoreBand,
  scoreBandLabel,
} from "@/lib/tracker-score-bands";
import { complexityFormatDisplay } from "./ComplexityBandDisplay";
import {
  computeProjectConfidenceFromProject,
  explainProjectConfidence,
} from "@/lib/confidenceScore";
import { prioritySelectTextClass } from "@/lib/prioritySort";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { MilestoneRow } from "./MilestoneRow";
import {
  updateProject,
  deleteProject,
  createMilestone,
  appendProjectReviewNote,
  unmirrorProjectFromGoal,
} from "@/server/actions/tracker";
import {
  ChevronRight,
  ChevronDown,
  Flag,
  Plus,
  Sparkles,
  Trash2,
  Pencil,
  ArrowRightLeft,
  Ban,
} from "lucide-react";
import { ExecFlagMenu } from "./ExecFlagMenu";
import { ReviewNotesPopover } from "./ReviewNotesPopover";
import { isReviewStale } from "@/lib/reviewStaleness";
import { cn } from "@/lib/utils";

import { useTrackerExpandBulk } from "./tracker-expand-context";
import { CollapsePanel } from "./CollapsePanel";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { projectMatchesCloseWatch } from "@/lib/closeWatch";
import {
  AUTONOMY_GROUP_LABEL,
  clampAutonomy,
  isFounderPerson,
} from "@/lib/autonomyRoster";
import { getTrackerProjectWarnings } from "@/lib/tracker-project-warnings";
import { WarningsBadge } from "./WarningsBadge";
import { SharedBadge } from "./SharedBadge";
import { BlockedBadge } from "./BlockedBadge";
import { MirrorGoalPickerDialog } from "./MirrorGoalPickerDialog";
import { BlockedByPickerDialog } from "./BlockedByPickerDialog";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
  formatRelativeCalendarDateCompact,
  parseCalendarDateString,
} from "@/lib/relativeCalendarDate";
import { PROJECT_STATUS_SELECT_OPTIONS } from "@/lib/projectStatus";
import { ProjectStatusPill } from "./ProjectStatusPill";
import {
  TRACKER_EMPTY_HINT_COPY_GOAL_CLASS,
  TRACKER_INLINE_TEXT_ACTION,
} from "./tracker-text-actions";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { AiContextInfoIcon } from "./AiContextInfoIcon";

/** Align editable cells with sticky column headers (no default resting inset). */
const GRID_ALIGN = { trackerGridAlign: true as const };

interface ProjectRowProps {
  /** Parent goal id — used in single-project expansion mode */
  goalId: string;
  project: ProjectWithMilestones;
  people: Person[];
  expandForSearch?: boolean;
  /** Parent goal's cost-of-delay score (1–5) for autonomy risk warnings. */
  goalCostOfDelay?: number;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
  /** When this matches `project.id`, project name opens in edit mode on mount. */
  focusProjectNameEditId?: string | null;
  /** Full goal list for shared/mirror labels (roadmap-wide). */
  allGoals: Goal[];
  allCompanies: Company[];
  /** Full hierarchy for “Mirror to goal…” picker (unfiltered). */
  mirrorPickerHierarchy: CompanyWithGoals[];
}

export function ProjectRow({
  goalId,
  project,
  people,
  expandForSearch = false,
  goalCostOfDelay,
  ownerWorkloadMap,
  focusProjectNameEditId = null,
  allGoals,
  allCompanies,
  mirrorPickerHierarchy,
}: ProjectRowProps) {
  const [expanded, setExpanded] = useState(false);
  /** Keep AI context icon visible while the AI context panel is open (even if pointer left the row). */
  const [aiContextUiOpen, setAiContextUiOpen] = useState(false);
  const [mirrorPickerOpen, setMirrorPickerOpen] = useState(false);
  const [blockedByPickerOpen, setBlockedByPickerOpen] = useState(false);
  /** When expanded, whether milestone rows (and add-milestone) are shown */
  const [showMilestones, setShowMilestones] = useState(true);
  /** After adding a milestone, name cell opens in edit mode so the user can type immediately. */
  const [newMilestoneNameFocusId, setNewMilestoneNameFocusId] = useState<
    string | null
  >(null);
  /** Increment to focus the project name field (context menu Rename). */
  const [projectRenameNonce, setProjectRenameNonce] = useState(0);
  const {
    bulkTick,
    expandPreset,
    focusProjectMode,
    setFocusedGoalId,
    focusedProjectId,
    setFocusedProjectId,
    focusEnforceTick,
  } = useTrackerExpandBulk();
  const projectContext = useContextMenu();

  useEffect(() => {
    if (!focusProjectMode || focusEnforceTick === 0) return;
    setExpanded(false);
    setShowMilestones(false);
  }, [focusProjectMode, focusEnforceTick]);

  useEffect(() => {
    if (!focusProjectMode) return;
    if (focusedProjectId !== null && focusedProjectId !== project.id) {
      setExpanded(false);
      setShowMilestones(false);
    }
  }, [focusProjectMode, focusedProjectId, project.id]);

  useEffect(() => {
    if (bulkTick === 0) return;
    queueMicrotask(() => {
      switch (expandPreset) {
        case "goals_only":
          setExpanded(false);
          setShowMilestones(false);
          break;
        case "goals_and_projects":
          setExpanded(true);
          setShowMilestones(false);
          break;
        case "goals_projects_milestones":
          setExpanded(true);
          setShowMilestones(true);
          break;
        case "collapse":
          setExpanded(false);
          setShowMilestones(false);
          break;
        default:
          break;
      }
    });
  }, [bulkTick, expandPreset]);

  useEffect(() => {
    if (expandForSearch) {
      setExpanded(true);
      setShowMilestones(true);
    }
  }, [expandForSearch]);

  const toggleProjectRow = useCallback(() => {
    if (focusProjectMode) {
      if (!expanded) {
        setFocusedGoalId(goalId);
        setFocusedProjectId(project.id);
        setExpanded(true);
        setShowMilestones(true);
        return;
      }
      if (!showMilestones) {
        setShowMilestones(true);
        return;
      }
      setExpanded(false);
      setShowMilestones(false);
      setFocusedProjectId((prev) => (prev === project.id ? null : prev));
      return;
    }
    if (!expanded) {
      setExpanded(true);
      setShowMilestones(true);
      return;
    }
    if (!showMilestones) {
      setShowMilestones(true);
      return;
    }
    setExpanded(false);
    setShowMilestones(false);
  }, [
    expanded,
    showMilestones,
    focusProjectMode,
    goalId,
    project.id,
    setFocusedGoalId,
    setFocusedProjectId,
  ]);

  const onProjectRowClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest(
        "button, a, input, select, textarea"
      );
      if (el) return;
      toggleProjectRow();
    },
    [toggleProjectRow]
  );

  const priorityOptions = PriorityEnum.options.map((p) => ({ value: p, label: p }));
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const projectConfidenceAuto = useMemo(
    () => computeProjectConfidenceFromProject(project, peopleById),
    [project, peopleById]
  );
  const projectConfidenceExplain = useMemo(
    () => explainProjectConfidence(project, peopleById),
    [project, peopleById]
  );
  const ownerPerson = people.find((p) => p.id === project.ownerId);
  const projectInReviewQueue = useMemo(
    () =>
      isReviewStale(
        project.lastReviewed,
        "project",
        ownerPerson?.autonomyScore
      ),
    [project.lastReviewed, ownerPerson?.autonomyScore]
  );

  const nextPendingMilestone = useMemo(
    () => getNextPendingMilestone(project.milestones),
    [project.milestones]
  );

  const nextMilestoneUi = useMemo(() => {
    if (!nextPendingMilestone) return null;
    const td = nextPendingMilestone.targetDate.trim();
    const compact = td ? formatRelativeCalendarDateCompact(td) : null;
    const idx = project.milestones.findIndex(
      (m) => m.id === nextPendingMilestone.id
    );
    const pos = idx >= 0 ? idx + 1 : null;
    const titleParts: string[] = [nextPendingMilestone.name];
    if (td && compact) {
      titleParts.push(
        formatRelativeCalendarDate(td),
        formatCalendarDateHint(td)
      );
    } else {
      titleParts.push("No target date — set one on this milestone");
    }
    if (pos != null) {
      titleParts.push(`Milestone ${pos}/${project.milestones.length}`);
    }
    return {
      title: titleParts.join(" · "),
      chipLabel: compact ?? "—",
      isOverdueHorizon: compact != null && compact.startsWith("-"),
    };
  }, [nextPendingMilestone, project.milestones]);

  const warnings = useMemo(
    () => getTrackerProjectWarnings(project, goalCostOfDelay, people),
    [project, goalCostOfDelay, people]
  );

  const showCloseWatch = useMemo(
    () => projectMatchesCloseWatch(project, people),
    [project, people]
  );

  const lowAutonomyOwnerHint = useMemo(() => {
    if (!ownerPerson || isFounderPerson(ownerPerson)) return null;
    const level = clampAutonomy(ownerPerson.autonomyScore);
    if (level > 2) return null;
    return AUTONOMY_GROUP_LABEL[level].title;
  }, [ownerPerson]);

  const projectNeedsDueDate = useMemo(() => {
    const raw = project.targetDate?.trim() ?? "";
    return !raw || parseCalendarDateString(raw) === null;
  }, [project.targetDate]);

  const isMirror = project.isMirror ?? false;

  const projectMenuEntries = useMemo((): ContextMenuEntry[] => {
    const execBlock: ContextMenuEntry[] = [];
    if (!project.atRisk && !project.spotlight) {
      execBlock.push(
        {
          type: "item",
          id: "p-exec-at-risk",
          label: "Mark at risk",
          icon: Flag,
          onClick: () =>
            void updateProject(project.id, { atRisk: true, spotlight: false }),
        },
        {
          type: "item",
          id: "p-exec-spotlight",
          label: "Mark spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: true }),
        }
      );
    } else if (project.atRisk) {
      execBlock.push(
        {
          type: "item",
          id: "p-exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "p-exec-to-spotlight",
          label: "Switch to spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: true }),
        }
      );
    } else {
      execBlock.push(
        {
          type: "item",
          id: "p-exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "p-exec-to-at-risk",
          label: "Switch to at risk",
          icon: Flag,
          onClick: () =>
            void updateProject(project.id, { atRisk: true, spotlight: false }),
        }
      );
    }

    const expandLabel = !expanded
      ? "Expand project"
      : !showMilestones
        ? "Show milestones"
        : "Collapse project";
    const ExpandIcon =
      !expanded || !showMilestones ? ChevronDown : ChevronRight;

    return [
      {
        type: "item",
        id: "add-milestone",
        label: "Add milestone",
        icon: Plus,
        onClick: async () => {
          const ms = await createMilestone({
            projectId: project.id,
            name: "New milestone",
            status: "Not Done",
            targetDate: "",
          });
          setNewMilestoneNameFocusId(ms.id);
          setExpanded(true);
          setShowMilestones(true);
        },
      },
      {
        type: "item",
        id: "rename-project",
        label: "Rename project",
        icon: Pencil,
        onClick: () => setProjectRenameNonce((n) => n + 1),
      },
      {
        type: "item",
        id: "mirror-to-goal",
        label: "Mirror to goal…",
        icon: ArrowRightLeft,
        onClick: () => setMirrorPickerOpen(true),
      },
      ...(isMirror
        ? ([
            {
              type: "item",
              id: "remove-mirror",
              label: "Remove mirror from this goal",
              onClick: () =>
                void unmirrorProjectFromGoal(project.id, goalId).catch(
                  (e) => {
                    alert(
                      e instanceof Error ? e.message : "Could not remove mirror."
                    );
                  }
                ),
            },
          ] as ContextMenuEntry[])
        : []),
      {
        type: "item",
        id: "set-blocked-by",
        label: "Set blocked by…",
        icon: Ban,
        onClick: () => setBlockedByPickerOpen(true),
      },
      ...((project.blockedByProjectId ?? "").trim()
        ? ([
            {
              type: "item",
              id: "clear-blocked-by",
              label: "Clear blocked by",
              onClick: () =>
                void updateProject(project.id, { blockedByProjectId: "" }),
            },
          ] as ContextMenuEntry[])
        : []),
      { type: "divider", id: "p-d1" },
      ...execBlock,
      { type: "divider", id: "p-d2" },
      {
        type: "item",
        id: "expand-project",
        label: expandLabel,
        icon: ExpandIcon,
        onClick: () => toggleProjectRow(),
      },
      { type: "divider", id: "p-d3" },
      {
        type: "item",
        id: "delete-project",
        label: isMirror ? "Delete project entirely…" : "Delete project…",
        icon: Trash2,
        destructive: true,
        confirmMessage: isMirror
          ? "Delete this project from every goal it appears on? This cannot be undone."
          : `Delete this project? This can't be undone.`,
        onClick: () => void deleteProject(project.id),
      },
    ];
  }, [
    expanded,
    goalId,
    isMirror,
    project.atRisk,
    project.id,
    project.spotlight,
    project.blockedByProjectId,
    setProjectRenameNonce,
    showMilestones,
    toggleProjectRow,
  ]);

  return (
    <div
      className={cn(
        "group/project max-w-full min-w-0",
        project.atRisk &&
          "rounded-md border-l-4 border-amber-400 bg-amber-950/45 shadow-[inset_6px_0_0_0_rgba(251,191,36,0.35)] ring-1 ring-amber-500/30",
        !project.atRisk &&
          project.spotlight &&
          "rounded-md border-l-4 border-emerald-400/85 bg-emerald-950/40 shadow-[inset_6px_0_0_0_rgba(52,211,153,0.28)] ring-1 ring-emerald-500/25"
      )}
    >
      <div
        title={
          !expanded
            ? "Expand project details and milestones (click row)"
            : !showMilestones
              ? "Show milestones (click row)"
              : "Collapse project (click row)"
        }
        onClick={onProjectRowClick}
        onContextMenuCapture={projectContext.onContextMenuCapture}
        className="group/project-row flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-1.5 transition-colors border-b border-zinc-900 cursor-pointer"
      >
        <div className="w-8 shrink-0 flex items-center justify-center">
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 ease-out pointer-events-none motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        </div>

        {/* Project name — AI info icon inline at end of name; Shared/Mirror — w-[360px] matches goal + headers */}
        <div
          className="w-[360px] min-w-0 shrink-0 flex items-center gap-1.5"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (
              t.closest("[data-shared-badge-root]") ||
              t.closest("[data-blocked-badge-root]")
            )
              e.stopPropagation();
          }}
        >
          <div className="min-w-0 flex-1">
            <InlineEditCell
              {...GRID_ALIGN}
              value={project.name}
              onSave={(name) => updateProject(project.id, { name })}
              startInEditMode={project.id === focusProjectNameEditId}
              openEditNonce={projectRenameNonce}
              displayClassName="text-zinc-200"
              collapsedSuffix={
                <span
                  className={cn(
                    "inline-flex items-center align-middle transition-opacity duration-150",
                    "opacity-0 group-hover/project-row:opacity-100",
                    aiContextUiOpen && "opacity-100",
                    "pointer-events-none group-hover/project-row:pointer-events-auto",
                    aiContextUiOpen && "pointer-events-auto"
                  )}
                >
                  <AiContextInfoIcon
                    inline
                    variant="project"
                    projectId={project.id}
                    description={project.description}
                    definitionOfDone={project.definitionOfDone}
                    onUiOpenChange={setAiContextUiOpen}
                  />
                </span>
              }
            />
          </div>
          <div className="shrink-0 flex items-center gap-1" data-shared-badge-root>
            <SharedBadge
              isMirror={isMirror}
              primaryGoalId={project.goalId}
              mirroredGoalIds={project.mirroredGoalIds ?? []}
              currentGoalId={goalId}
              goals={allGoals}
              companies={allCompanies}
            />
            {project.isBlocked === true &&
            project.blockedByProjectName !== undefined ? (
              <div className="shrink-0" data-blocked-badge-root>
                <BlockedBadge
                  blockedByProjectName={project.blockedByProjectName}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Owner */}
        <div className="w-[5.85rem] min-w-0 shrink-0">
          <OwnerPickerCell
            {...GRID_ALIGN}
            people={people}
            value={project.ownerId}
            onSave={(ownerId) => updateProject(project.id, { ownerId })}
            priority={project.priority}
            workloadMap={ownerWorkloadMap}
            emphasizeUnassigned
          />
        </div>

        {/* Priority */}
        <div className="w-14 shrink-0">
          <InlineEditCell
            {...GRID_ALIGN}
            value={project.priority}
            onSave={(priority) =>
              updateProject(project.id, { priority: priority as Priority })
            }
            type="select"
            options={priorityOptions}
            displayClassName={cn("font-medium", prioritySelectTextClass(project.priority))}
          />
        </div>

        {/* Complexity — matches ProjectsColumnHeaders; before Confidence */}
        <div
          className="w-28 shrink-0 min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditCell
            {...GRID_ALIGN}
            value={String(project.complexityScore)}
            onSave={(v) =>
              updateProject(project.id, {
                complexityScore: parseScoreBand(v),
              })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
            formatDisplay={complexityFormatDisplay}
            displayTitle={`Complexity — ${scoreBandLabel(project.complexityScore)} (${project.complexityScore}/5)`}
          />
        </div>

        {/* Confidence — w-28 aligns with goal Confidence column */}
        <div className="w-28 shrink-0 flex items-center justify-end pr-0.5">
          <AutoConfidencePercent
            score={projectConfidenceAuto}
            explanation={projectConfidenceExplain}
          />
        </div>

        {/* Status */}
        <div className="w-44 shrink-0 min-w-0">
          <InlineEditCell
            {...GRID_ALIGN}
            className="group/status"
            overlaySelectQuiet
            value={project.status}
            onSave={(status) =>
              updateProject(project.id, { status: status as ProjectStatus })
            }
            type="select"
            options={PROJECT_STATUS_SELECT_OPTIONS}
            formatDisplay={(v) => (
              <ProjectStatusPill status={v} variant="inline" />
            )}
            selectPresentation="always"
          />
        </div>

        {/* Progress */}
        <div className="w-32 shrink-0">
          <ProgressBar percent={project.progress} />
        </div>

        {/* Due date — derived from last milestone with a target date (same relative label as milestone dates) */}
        <div
          className="w-28 shrink-0"
          title={
            project.targetDate.trim()
              ? `${formatCalendarDateHint(project.targetDate)} — from last milestone with a date`
              : "Set a target date on at least one milestone"
          }
        >
          <span
            className={cn(
              "block truncate px-1 py-0.5 text-xs font-medium leading-tight",
              projectNeedsDueDate
                ? "rounded border border-amber-500/45 bg-amber-950/40 text-amber-100/95 ring-1 ring-amber-500/25"
                : "text-zinc-200"
            )}
          >
            {project.targetDate.trim()
              ? formatRelativeCalendarDate(project.targetDate)
              : "—"}
          </span>
        </div>

        {/* Next milestone — horizon chip (D/W/M/Y) + name; clicks pass through except interactive controls */}
        <div className="w-[18rem] shrink-0 min-w-0">
          {project.milestones.length === 0 ? (
            <button
              type="button"
              title="Click to add a milestone"
              className="inline-flex w-full max-w-full items-center gap-0.5 truncate rounded border border-amber-500/45 bg-amber-950/40 px-1 py-0.5 text-left text-xs font-medium leading-tight text-amber-100 ring-1 ring-amber-500/25 cursor-pointer transition-colors hover:bg-amber-950/55 hover:border-amber-400/55"
              onClick={async (e) => {
                e.stopPropagation();
                const ms = await createMilestone({
                  projectId: project.id,
                  name: "New milestone",
                  status: "Not Done",
                  targetDate: "",
                });
                setNewMilestoneNameFocusId(ms.id);
                setExpanded(true);
                setShowMilestones(true);
              }}
            >
              <Plus
                className="h-3 w-3 shrink-0 text-amber-300/90"
                aria-hidden
              />
              <span className="min-w-0 truncate">Create milestone</span>
            </button>
          ) : nextPendingMilestone && nextMilestoneUi ? (
            <div
              className="flex min-w-0 items-start gap-1.5 rounded-md border border-violet-500/30 bg-violet-950/25 px-1.5 py-1 ring-1 ring-inset ring-violet-500/10"
              title={nextMilestoneUi.title}
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1 py-px font-mono text-[10px] font-semibold tabular-nums ring-1 ring-violet-500/35",
                  nextMilestoneUi.chipLabel === "—"
                    ? "text-zinc-400 ring-zinc-600/40 bg-zinc-800/40"
                    : nextMilestoneUi.isOverdueHorizon
                      ? "text-rose-300/95 bg-rose-950/35 ring-rose-500/35"
                      : "text-violet-200/95 bg-violet-500/15"
                )}
              >
                {nextMilestoneUi.chipLabel}
              </span>
              <p className="min-w-0 flex-1 truncate text-left text-xs font-medium leading-snug text-zinc-100">
                {nextPendingMilestone.name}
              </p>
            </div>
          ) : (
            <p
              className="truncate text-left text-xs font-medium leading-tight text-zinc-400"
              title="All milestones are done"
            >
              All milestones done
            </p>
          )}
        </div>

        <div className="min-w-2 flex-1" aria-hidden={true} />

        {/* Status flags + warnings — right cluster */}
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {project.atRisk && (
            <span
              className="whitespace-nowrap rounded-md border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/95"
              title="Marked at risk"
            >
              At risk
            </span>
          )}
          {project.spotlight && (
            <span
              className="whitespace-nowrap rounded-md border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95"
              title="Spotlight — win or momentum"
            >
              Spotlight
            </span>
          )}
          {warnings.length === 1 && (
            <span
              className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95"
              title={warnings[0].title}
            >
              {warnings[0].label}
            </span>
          )}
          {warnings.length > 1 && (
            <WarningsBadge warnings={warnings} />
          )}
          {showCloseWatch && (
            <span
              className="whitespace-nowrap rounded-md border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/95"
              title="P0/P1 with owner autonomy 1–2 — stay closer on delivery"
            >
              Close watch
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ReviewNotesPopover
            entries={project.reviewLog}
            onAppendNote={(t) => appendProjectReviewNote(project.id, t)}
            pulseAttention={projectInReviewQueue}
            rowGroup="project"
          />
          <ExecFlagMenu
            atRisk={project.atRisk}
            spotlight={project.spotlight}
            entityLabel="Project"
            rowGroup="project"
            onCommit={(flags) => updateProject(project.id, flags)}
          />
          <ConfirmDeletePopover
            entityName={
              isMirror
                ? "this project from every goal it is linked to"
                : "this project"
            }
            rowGroup="project"
            onConfirm={() => deleteProject(project.id)}
          />
        </div>
      </div>

      <ContextMenu
        open={projectContext.open}
        x={projectContext.x}
        y={projectContext.y}
        onClose={projectContext.close}
        ariaLabel={`Actions for project ${project.name}`}
        entries={projectMenuEntries}
      />

      <MirrorGoalPickerDialog
        open={mirrorPickerOpen}
        onClose={() => setMirrorPickerOpen(false)}
        hierarchy={mirrorPickerHierarchy}
        projectId={project.id}
        primaryGoalId={project.goalId}
        mirroredGoalIds={project.mirroredGoalIds ?? []}
      />
      <BlockedByPickerDialog
        open={blockedByPickerOpen}
        onClose={() => setBlockedByPickerOpen(false)}
        hierarchy={mirrorPickerHierarchy}
        currentProjectId={project.id}
      />

      {/* Milestones — group/milestones so “Add milestone” row shows only when hovering this list */}
      <CollapsePanel open={expanded && showMilestones}>
        <div className="group/milestones ml-8">
          {lowAutonomyOwnerHint ? (
            <div className="pl-14 pr-4 pt-1 pb-2 border-b border-zinc-800/80 mb-0.5">
              <p className="text-[11px] leading-snug text-zinc-400">
                <span className="font-medium text-amber-200/90">Owner — </span>
                {lowAutonomyOwnerHint}
              </p>
            </div>
          ) : null}
          {project.milestones.length === 0 ? (
            <div className="pl-14 pr-4 py-2">
              <p
                className={cn(
                  "w-full min-w-0",
                  TRACKER_EMPTY_HINT_COPY_GOAL_CLASS
                )}
              >
                No milestones yet. Add a milestone to track delivery checkpoints
                for this project.&nbsp;
                <button
                  type="button"
                  title="Add a new milestone to this project"
                  onClick={async () => {
                    const ms = await createMilestone({
                      projectId: project.id,
                      name: "New milestone",
                      status: "Not Done",
                      targetDate: "",
                    });
                    setNewMilestoneNameFocusId(ms.id);
                    setExpanded(true);
                    setShowMilestones(true);
                  }}
                  className={TRACKER_INLINE_TEXT_ACTION}
                >
                  Add milestone
                </button>
              </p>
            </div>
          ) : (
            <>
              {project.milestones.map((ms) => {
                const isNext =
                  nextPendingMilestone != null &&
                  ms.id === nextPendingMilestone.id;
                const isQueued =
                  ms.status !== "Done" && !isNext;
                return (
                  <MilestoneRow
                    key={ms.id}
                    milestone={ms}
                    startNameInEditMode={ms.id === newMilestoneNameFocusId}
                    isNextPendingMilestone={isNext}
                    isQueuedPendingMilestone={isQueued}
                  />
                );
              })}
              <div
                className={cn(
                  "overflow-hidden pl-14 pr-4",
                  "max-h-0 py-0 opacity-0 pointer-events-none",
                  "transition-[max-height,padding,opacity] duration-150 ease-out",
                  "group-hover/milestones:max-h-14 group-hover/milestones:py-1.5 group-hover/milestones:opacity-100 group-hover/milestones:pointer-events-auto",
                  "focus-within:max-h-14 focus-within:py-1.5 focus-within:opacity-100 focus-within:pointer-events-auto"
                )}
              >
                <button
                  type="button"
                  onClick={async () => {
                    const ms = await createMilestone({
                      projectId: project.id,
                      name: "New milestone",
                      status: "Not Done",
                      targetDate: "",
                    });
                    setNewMilestoneNameFocusId(ms.id);
                  }}
                  className="inline-flex w-fit cursor-pointer items-center gap-2 rounded text-xs text-zinc-600 transition-colors hover:text-zinc-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50"
                >
                  <Plus className="h-3 w-3" />
                  Add milestone
                </button>
              </div>
            </>
          )}
        </div>
      </CollapsePanel>
    </div>
  );
}
