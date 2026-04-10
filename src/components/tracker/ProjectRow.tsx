"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectWithMilestones, Person } from "@/lib/types/tracker";
import { StatusEnum, PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerSelectDisplay } from "./OwnerSelectDisplay";
import { ProgressBar } from "./ProgressBar";
import { SCORE_BAND_OPTIONS, parseScoreBand } from "@/lib/tracker-score-bands";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { MilestoneRow } from "./MilestoneRow";
import {
  updateProject,
  deleteProject,
  createMilestone,
  markProjectReviewed,
} from "@/server/actions/tracker";
import { ChevronRight, Flag, Link2, Plus, Sparkles } from "lucide-react";
import { ExecFlagMenu } from "./ExecFlagMenu";
import { ReviewAction } from "./ReviewAction";
import { cn } from "@/lib/utils";
import { useTrackerExpandBulk } from "./tracker-expand-context";
import type { Priority, Status } from "@/lib/types/tracker";
import { CollapsePanel } from "./CollapsePanel";
import { getNextPendingMilestone } from "@/lib/next-milestone";

interface ProjectRowProps {
  /** Parent goal id — used in single-project expansion mode */
  goalId: string;
  project: ProjectWithMilestones;
  people: Person[];
  expandForSearch?: boolean;
}

export function ProjectRow({
  goalId,
  project,
  people,
  expandForSearch = false,
}: ProjectRowProps) {
  const [expanded, setExpanded] = useState(false);
  /** When expanded, whether milestone rows (and add-milestone) are shown */
  const [showMilestones, setShowMilestones] = useState(true);
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
  const ownerOptions = [
    { value: "", label: "Unassigned" },
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];

  const ownerPerson = people.find((p) => p.id === project.ownerId);
  const ownerName = ownerPerson?.name ?? "";
  const ownerDept = ownerPerson?.department?.trim();
  const isUnassigned = !project.ownerId;

  const nextPendingMilestone = useMemo(
    () => getNextPendingMilestone(project.milestones),
    [project.milestones]
  );

  return (
    <div
      className={cn(
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
          "group flex items-center gap-2 pl-12 pr-4 py-1.5 transition-colors border-b border-zinc-900 cursor-pointer",
          project.atRisk
            ? "hover:bg-amber-950/55"
            : project.spotlight
              ? "hover:bg-emerald-950/45"
              : "hover:bg-zinc-900/50"
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 ease-out pointer-events-none motion-reduce:transition-none",
            expanded && "rotate-90"
          )}
          aria-hidden
        />

        {/* Name */}
        <div className="w-64 min-w-0 shrink-0">
          <InlineEditCell
            value={project.name}
            onSave={(name) => updateProject(project.id, { name })}
          />
        </div>

        {/* Owner */}
        <div className="w-40 min-w-0 shrink-0">
          <InlineEditCell
            value={project.ownerId}
            onSave={(ownerId) => updateProject(project.id, { ownerId })}
            type="select"
            options={ownerOptions}
            emptyLabel="Unassigned"
            formatDisplay={(id) => (
              <OwnerSelectDisplay people={people} ownerId={id} />
            )}
            displayTitle={
              ownerName
                ? `${ownerName}${ownerDept ? ` · ${ownerDept}` : ""} — Click to change owner`
                : "Click to assign owner"
            }
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
          className="w-44 shrink-0 min-w-0 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <p
            className={cn(
              "truncate text-left text-sm font-medium leading-snug",
              nextPendingMilestone
                ? "text-zinc-100"
                : project.milestones.length === 0
                  ? "text-zinc-500"
                  : "text-zinc-400"
            )}
            title={
              nextPendingMilestone
                ? nextPendingMilestone.name
                : project.milestones.length === 0
                  ? "Add milestones when you expand this project"
                  : "All milestones are done"
            }
          >
            {project.milestones.length === 0
              ? "No milestones"
              : nextPendingMilestone
                ? nextPendingMilestone.name
                : "All milestones done"}
          </p>
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

        {/* Progress */}
        <div className="w-24 shrink-0">
          <ProgressBar percent={project.progress} />
        </div>

        {/* Target Date */}
        <div className="w-28 shrink-0">
          <InlineEditCell
            value={project.targetDate}
            onSave={(targetDate) => updateProject(project.id, { targetDate })}
            type="date"
            emptyLabel="No date"
          />
        </div>

        {/* Slack URL (column header shows Slack mark) */}
        <div
          className={cn(
            "shrink-0 transition-[min-width,max-width] duration-150 ease-out",
            slackUrlEditing
              ? "min-w-[min(28rem,calc(100vw-5rem))] max-w-[calc(100vw-5rem)] w-[min(28rem,calc(100vw-5rem))] z-20 relative"
              : "w-10"
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

        {/* At risk / Spotlight + Unassigned — right cluster */}
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
          {project.milestones.length === 0 && (
            <span
              className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95"
              title="No milestones yet — add checkpoints to track delivery"
            >
              No milestones
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

        <div className="w-[5.5rem] shrink-0 flex justify-end">
          <ReviewAction
            kind="project"
            lastReviewed={project.lastReviewed}
            onConfirm={() => markProjectReviewed(project.id)}
          />
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
            "border-l-2 ml-14",
            project.atRisk
              ? "border-amber-800/45"
              : project.spotlight
                ? "border-emerald-800/45"
                : "border-zinc-800"
          )}
        >
          {project.milestones.map((ms) => (
            <MilestoneRow key={ms.id} milestone={ms} />
          ))}
          <button
            type="button"
            onClick={() =>
              createMilestone({
                projectId: project.id,
                name: "New milestone",
                status: "Not Done",
                targetDate: "",
              })
            }
            className="flex items-center gap-2 pl-20 pr-4 py-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors w-full"
          >
            <Plus className="h-3 w-3" />
            Add milestone
          </button>
        </div>
      </CollapsePanel>
    </div>
  );
}
