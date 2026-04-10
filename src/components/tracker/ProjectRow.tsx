"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ProjectWithMilestones, Person } from "@/lib/types/tracker";
import { StatusEnum, PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import { ProgressBar } from "./ProgressBar";
import { SCORE_BAND_OPTIONS, parseScoreBand } from "@/lib/tracker-score-bands";
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
  markProjectReviewed,
} from "@/server/actions/tracker";
import { ChevronRight, Flag, Link2, Plus } from "lucide-react";
import { ExecFlagMenu } from "./ExecFlagMenu";
import { ReviewAction } from "./ReviewAction";
import { cn } from "@/lib/utils";

import { useTrackerExpandBulk } from "./tracker-expand-context";
import type { Priority, Status } from "@/lib/types/tracker";
import { CollapsePanel } from "./CollapsePanel";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { projectMatchesCloseWatch } from "@/lib/closeWatch";
import {
  AUTONOMY_GROUP_LABEL,
  clampAutonomy,
  isFounderPersonId,
} from "@/lib/autonomyRoster";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

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
}

export function ProjectRow({
  goalId,
  project,
  people,
  expandForSearch = false,
  goalCostOfDelay,
  ownerWorkloadMap,
  focusProjectNameEditId = null,
}: ProjectRowProps) {
  const [expanded, setExpanded] = useState(false);
  /** When expanded, whether milestone rows (and add-milestone) are shown */
  const [showMilestones, setShowMilestones] = useState(true);
  /** After adding a milestone, name cell opens in edit mode so the user can type immediately. */
  const [newMilestoneNameFocusId, setNewMilestoneNameFocusId] = useState<
    string | null
  >(null);
  const [slackUrlEditing, setSlackUrlEditing] = useState(false);
  const {
    bulkTick,
    bulkTarget,
    focusProjectMode,
    setFocusedGoalId,
    focusedProjectId,
    setFocusedProjectId,
    focusEnforceTick,
  } = useTrackerExpandBulk();

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
      switch (bulkTarget) {
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
  }, [bulkTick, bulkTarget]);

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

  const statusOptions = StatusEnum.options.map((s) => ({ value: s, label: s }));
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
  const isUnassigned = !project.ownerId;

  const nextPendingMilestone = useMemo(
    () => getNextPendingMilestone(project.milestones),
    [project.milestones]
  );

  const missingTargetDate = useMemo(() => {
    const raw = project.targetDate?.trim() ?? "";
    if (!raw) return true;
    return parseCalendarDateString(raw) === null;
  }, [project.targetDate]);

  const hasMilestoneMissingDate = useMemo(
    () =>
      project.milestones.some(
        (ms) => ms.status !== "Done" && !ms.targetDate?.trim()
      ),
    [project.milestones]
  );

  const highCodLowAutonomy = useMemo(() => {
    if (!goalCostOfDelay || goalCostOfDelay < 4) return false;
    if (!ownerPerson || isFounderPersonId(ownerPerson.id)) return false;
    return clampAutonomy(ownerPerson.autonomyScore) < 4;
  }, [goalCostOfDelay, ownerPerson]);

  const warnings = useMemo(() => {
    const list: { label: string; title: string }[] = [];
    if (project.milestones.length === 0)
      list.push({ label: "No milestones", title: "No milestones yet — add checkpoints to track delivery" });
    if (hasMilestoneMissingDate)
      list.push({ label: "Milestone undated", title: "One or more active milestones have no target date" });
    if (missingTargetDate)
      list.push({ label: "No due date", title: "No target date — set one in the Date column" });
    if (isUnassigned)
      list.push({ label: "Unassigned", title: "No owner assigned" });
    if (highCodLowAutonomy)
      list.push({ label: "Low autonomy / high CoD", title: "Owner autonomy is under 4 on a goal with high cost of delay — consider reassigning or increasing oversight" });
    return list;
  }, [project.milestones.length, hasMilestoneMissingDate, missingTargetDate, isUnassigned, highCodLowAutonomy]);

  const showCloseWatch = useMemo(
    () => projectMatchesCloseWatch(project, people),
    [project, people]
  );

  const lowAutonomyOwnerHint = useMemo(() => {
    if (!ownerPerson || isFounderPersonId(ownerPerson.id)) return null;
    const level = clampAutonomy(ownerPerson.autonomyScore);
    if (level > 2) return null;
    return AUTONOMY_GROUP_LABEL[level].title;
  }, [ownerPerson]);

  return (
    <div
      className={cn(
        "max-w-full min-w-0",
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
        className={cn(
          "group flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-1.5 transition-colors border-b border-zinc-900 cursor-pointer",
          project.atRisk
            ? "hover:bg-amber-950/55"
            : project.spotlight
              ? "hover:bg-emerald-950/45"
              : "hover:bg-zinc-900/50"
        )}
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

        {/* Name */}
        <div className="w-[280px] min-w-0 shrink-0">
          <InlineEditCell
            value={project.name}
            onSave={(name) => updateProject(project.id, { name })}
            startInEditMode={project.id === focusProjectNameEditId}
          />
        </div>

        {/* Owner */}
        <div className="w-40 min-w-0 shrink-0">
          <OwnerPickerCell
            people={people}
            value={project.ownerId}
            onSave={(ownerId) => updateProject(project.id, { ownerId })}
            priority={project.priority}
            workloadMap={ownerWorkloadMap}
          />
        </div>

        {/* Priority */}
        <div className="w-14 shrink-0">
          <InlineEditCell
            value={project.priority}
            onSave={(priority) =>
              updateProject(project.id, { priority: priority as Priority })
            }
            type="select"
            options={priorityOptions}
            displayClassName={cn("font-medium", prioritySelectTextClass(project.priority))}
          />
        </div>

        {/* Status */}
        <div className="w-44 shrink-0">
          <InlineEditCell
            value={project.status}
            onSave={(status) =>
              updateProject(project.id, { status: status as Status })
            }
            type="select"
            options={statusOptions}
          />
        </div>

        {/* Next milestone — derived from first milestone not Done */}
        <div
          className="group/next-ms w-44 shrink-0 min-w-0 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {project.milestones.length === 0 ? (
            <button
              type="button"
              className="truncate text-left text-sm font-medium leading-snug text-zinc-500 cursor-pointer"
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
            >
              <span className="block truncate group-hover/next-ms:hidden">
                No milestones
              </span>
              <span className="hidden min-w-0 items-center gap-1 truncate text-zinc-200 group-hover/next-ms:flex">
                <Plus className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
                Create milestone
              </span>
            </button>
          ) : (
            <p
              className={cn(
                "truncate text-left text-sm font-medium leading-snug",
                nextPendingMilestone ? "text-zinc-100" : "text-zinc-400"
              )}
              title={
                nextPendingMilestone
                  ? nextPendingMilestone.name
                  : "All milestones are done"
              }
            >
              {nextPendingMilestone
                ? nextPendingMilestone.name
                : "All milestones done"}
            </p>
          )}
        </div>

        {/* Done when — same interaction as goal Current */}
        <div className="w-44 shrink-0 min-w-0" onClick={(e) => e.stopPropagation()}>
          <InlineEditCell
            value={project.definitionOfDone}
            onSave={(definitionOfDone) =>
              updateProject(project.id, { definitionOfDone })
            }
            placeholder="Definition of done"
            displayClassName="text-zinc-100 font-medium"
            displayTruncateSingleLine
          />
        </div>

        {/* Complexity (higher = harder / worse) */}
        <div
          className="w-28 shrink-0"
          title="Complexity — higher is harder to deliver"
        >
          <InlineEditCell
            value={String(project.complexityScore)}
            onSave={(v) =>
              updateProject(project.id, {
                complexityScore: parseScoreBand(v),
              })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
          />
        </div>

        <div className="w-28 shrink-0 flex items-center justify-end pr-0.5">
          <AutoConfidencePercent
            score={projectConfidenceAuto}
            explanation={projectConfidenceExplain}
          />
        </div>

        {/* Progress */}
        <div className="w-32 shrink-0">
          <ProgressBar percent={project.progress} />
        </div>

        {/* Target Date */}
        <div className="w-28 shrink-0">
          <InlineEditCell
            value={project.targetDate}
            onSave={(targetDate) =>
              updateProject(project.id, { targetDate })
            }
            type="date"
          />
        </div>

        {/* Slack URL (column header shows Slack mark) */}
        <div
          className={cn(
            "transition-[min-width,max-width] duration-150 ease-out",
            slackUrlEditing
              ? "relative z-20 min-w-0 max-w-md flex-1 basis-0"
              : "w-44 shrink-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditCell
            value={project.slackUrl}
            onSave={(slackUrl) =>
              updateProject(project.id, { slackUrl })
            }
            placeholder="https://…"
            linkBehavior
            onEditingChange={setSlackUrlEditing}
            displayClassName="not-italic"
            collapsedButtonClassName="w-auto min-w-[28px] px-1 inline-flex items-center justify-center shrink-0"
            formatDisplay={(url) => (
              <Link2
                className={cn(
                  "h-3.5 w-3.5",
                  /^https?:\/\//i.test(url.trim())
                    ? "text-cyan-500/90"
                    : "text-zinc-500"
                )}
                aria-hidden
              />
            )}
            emptyLabel={
              <Link2 className="h-3.5 w-3.5 text-zinc-600" aria-hidden />
            }
            displayTitle="Add or edit Slack link"
          />
        </div>

        <div className="min-w-2 flex-1" aria-hidden={true} />

        <div className="w-[5.5rem] shrink-0 flex justify-end">
          <ReviewAction
            kind="project"
            lastReviewed={project.lastReviewed}
            onConfirm={() => markProjectReviewed(project.id)}
            ownerAutonomy={ownerPerson?.autonomyScore}
          />
        </div>

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

        <div className="flex items-center gap-0.5 shrink-0">
          <ExecFlagMenu
            atRisk={project.atRisk}
            spotlight={project.spotlight}
            entityLabel="Project"
            onCommit={(flags) => updateProject(project.id, flags)}
          />
          <ConfirmDeletePopover
            entityName="this project"
            onConfirm={() => deleteProject(project.id)}
          />
        </div>
      </div>

      {/* Milestones */}
      <CollapsePanel open={expanded && showMilestones}>
        <div
          className={cn(
            "border-l-2 ml-8",
            project.atRisk
              ? "border-amber-800/45"
              : project.spotlight
                ? "border-emerald-800/45"
                : "border-zinc-800"
          )}
        >
          {lowAutonomyOwnerHint ? (
            <div className="pl-14 pr-4 pt-1 pb-2 border-b border-zinc-800/80 mb-0.5">
              <p className="text-[11px] leading-snug text-zinc-400">
                <span className="font-medium text-amber-200/90">Owner — </span>
                {lowAutonomyOwnerHint}
              </p>
            </div>
          ) : null}
          {project.milestones.length === 0 ? (
            <div className="mx-4 my-3 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-6 sm:pl-8">
              <p className="mb-3 max-w-md text-sm text-zinc-500">
                No milestones yet. Add a milestone to track delivery
                checkpoints for this project.
              </p>
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
                  setExpanded(true);
                  setShowMilestones(true);
                }}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              >
                <Plus className="h-3.5 w-3.5" />
                Add milestone
              </button>
            </div>
          ) : (
            <>
              {project.milestones.map((ms) => (
                <MilestoneRow
                  key={ms.id}
                  milestone={ms}
                  startNameInEditMode={ms.id === newMilestoneNameFocusId}
                />
              ))}
              <div
                className={cn(
                  "py-1.5 pl-14 pr-4",
                  "opacity-0 pointer-events-none transition-opacity duration-150",
                  "group-hover/goal:pointer-events-auto group-hover/goal:opacity-100",
                  "group-focus-within/goal:pointer-events-auto group-focus-within/goal:opacity-100",
                  "focus-within:pointer-events-auto focus-within:opacity-100"
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

const WARNINGS_HOVER_CLOSE_MS = 120;

function WarningsBadge({
  warnings,
}: {
  warnings: { label: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, WARNINGS_HOVER_CLOSE_MS);
  }, [cancelScheduledClose]);

  const handlePointerEnter = useCallback(() => {
    cancelScheduledClose();
    setOpen(true);
  }, [cancelScheduledClose]);

  const reposition = useCallback(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const panelW = 200;
    const vw = window.innerWidth;
    const margin = 8;
    let left = rect.right - panelW;
    left = Math.max(margin, Math.min(left, vw - panelW - margin));
    setPos({ top: rect.bottom + 4, left });
  }, [open]);

  useLayoutEffect(() => reposition(), [reposition]);

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  const overlay =
    mounted && open ? (
      <>
        {pos && (
          <div
            className="fixed z-[110] min-w-[180px] rounded-md border border-zinc-700 bg-zinc-900 p-1.5 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={handlePointerEnter}
            onMouseLeave={scheduleClose}
          >
            {warnings.map((w) => (
              <p
                key={w.label}
                className="flex items-center gap-2 whitespace-nowrap px-2 py-1 text-[11px] text-zinc-300"
                title={w.title}
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400/80" />
                {w.label}
              </p>
            ))}
          </div>
        )}
      </>
    ) : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-expanded={open}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={handlePointerEnter}
        onMouseLeave={scheduleClose}
        onFocus={handlePointerEnter}
        onBlur={scheduleClose}
        className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95 cursor-help"
      >
        {warnings.length} warnings
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
