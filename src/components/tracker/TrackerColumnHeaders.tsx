"use client";

/** Column label rows for Roadmap — widths must match GoalSection / ProjectRow. Goal title uses ROADMAP_GOAL_TITLE_COL_CLASS; project uses ROADMAP_PROJECT_TITLE_COL_CLASS. Owner uses ROADMAP_OWNER_COL_CLASS; other data columns use ROADMAP_DATA_COL_CLASS + ROADMAP_GRID_GAP_CLASS. */

import { SlackLogo } from "./SlackLogo";
import { RoadmapColumnHeader } from "./RoadmapColumnHeader";
import { useRoadmapView } from "./roadmap-view-context";
import { cn } from "@/lib/utils";
import { ROADMAP_TOOLBAR_STICKY_FALLBACK_PX } from "@/lib/tracker-sticky-layout";
import {
  ROADMAP_DATA_COL_CLASS,
  ROADMAP_GOAL_GRID_PADDING_CLASS,
  ROADMAP_GOAL_TITLE_COL_CLASS,
  ROADMAP_GRID_GAP_CLASS,
  ROADMAP_NEXT_MILESTONE_COL_CLASS,
  ROADMAP_OWNER_COL_CLASS,
  ROADMAP_PROJECT_GRID_PADDING_CLASS,
  ROADMAP_PROJECT_TITLE_COL_CLASS,
} from "@/lib/tracker-roadmap-columns";

/** Used until the toolbar height is measured (avoids a flash of wrong offset). */
const STICKY_TOP_FALLBACK_PX = ROADMAP_TOOLBAR_STICKY_FALLBACK_PX;

export type TrackerColumnHeadersStickyProps = {
  /**
   * Pixel offset from the scrollport top (toolbar, or toolbar + company header, etc.).
   * When omitted, uses the measured Roadmap toolbar height from context.
   */
  stackTopPx?: number;
  /** Stacking order vs other sticky rows (company → goals labels → goal row → …). */
  stickyZClass?: string;
};

export function GoalsColumnHeaders({
  stackTopPx: stackTopPxProp,
  stickyZClass,
}: TrackerColumnHeadersStickyProps = {}) {
  const { stickyTopPx } = useRoadmapView();
  const top =
    stackTopPxProp ??
    (stickyTopPx > 0 ? stickyTopPx : STICKY_TOP_FALLBACK_PX);

  return (
    <div
      className={cn(
        "sticky max-w-full min-w-0 border-b border-zinc-800/90",
        stickyZClass ?? "z-20",
        "bg-zinc-950/95 backdrop-blur-sm"
      )}
      style={{ top }}
    >
      <div
        className={cn(
          "flex w-full min-w-max items-center py-1 text-xs font-medium text-zinc-500",
          ROADMAP_GRID_GAP_CLASS,
          ROADMAP_GOAL_GRID_PADDING_CLASS,
        )}
      >
        <div className="w-8 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className={ROADMAP_GOAL_TITLE_COL_CLASS}
          tooltip="Goal title — what you are trying to achieve for this company."
        >
          Goal
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(
            ROADMAP_OWNER_COL_CLASS,
            "flex items-center justify-center text-center"
          )}
          tooltip="Owner — single person accountable for the goal's outcome. Project-level owners are tracked separately."
        >
          Owner
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            "flex items-center justify-center",
          )}
          tooltip="Priority — Urgent (P0) through Low (P3); stored as P0–P3."
        >
          Priority
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Delay cost — how costly it is to wait; higher means more urgency. Aligns above project Complexity."
        >
          Delay cost
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Confidence (0–100%). Hover or focus a cell: project autonomy vs complexity, then goal cost of delay weights higher-autonomy project owners when delay is costly."
        >
          Confidence
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS, "flex items-center")}
          tooltip="Slack channel for this goal (name or link)."
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Due date — latest milestone target date among all projects in this goal (computed)."
        >
          Due date
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Progress — milestones marked Done out of total across all projects in this goal."
        >
          Progress
        </RoadmapColumnHeader>
        <div className={ROADMAP_NEXT_MILESTONE_COL_CLASS} aria-hidden />
        <div className="min-w-2 flex-1 shrink" aria-hidden />
      </div>
    </div>
  );
}

export function ProjectsColumnHeaders({
  stackTopPx: stackTopPxProp,
  stickyZClass,
}: TrackerColumnHeadersStickyProps = {}) {
  const { stickyTopPx } = useRoadmapView();
  const top =
    stackTopPxProp ??
    (stickyTopPx > 0 ? stickyTopPx : STICKY_TOP_FALLBACK_PX);

  return (
    <div
      className={cn(
        "sticky max-w-full min-w-0 border-b border-zinc-800/60",
        stickyZClass ?? "z-20",
        "bg-zinc-900/55 backdrop-blur-sm"
      )}
      style={{ top }}
    >
      <div
        className={cn(
          "flex w-full min-w-max items-center py-1 text-xs font-medium text-zinc-500",
          ROADMAP_GRID_GAP_CLASS,
          ROADMAP_PROJECT_GRID_PADDING_CLASS,
        )}
      >
        <div className="w-8 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className={ROADMAP_PROJECT_TITLE_COL_CLASS}
          tooltip="Project name — a concrete initiative under this goal."
        >
          Project
        </RoadmapColumnHeader>
        <div className={ROADMAP_OWNER_COL_CLASS} aria-hidden />
        <div className={ROADMAP_DATA_COL_CLASS} aria-hidden />
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Complexity — scope and difficulty of the work (Very high → Minimal)."
        >
          Complexity
        </RoadmapColumnHeader>
        <div className={ROADMAP_DATA_COL_CLASS} aria-hidden />
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Project workflow: Idea → Pending → In Progress → Stuck → For Review → Done."
        >
          Status
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Due date — same date as the last milestone with a target date; shown as a relative label (e.g. in 2 months) like milestone dates. Hover for the full date."
        >
          Due date
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={cn(ROADMAP_DATA_COL_CLASS)}
          tooltip="Progress — milestones marked Done out of total (e.g. 3/7). Bar fill reflects the share."
        >
          Progress
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className={ROADMAP_NEXT_MILESTONE_COL_CLASS}
          tooltip="The first milestone not marked done — horizon (e.g. 5D, 2W) from its target date when set, then name. When the project row is collapsed and the milestone has a Slack thread URL, the latest reply preview appears here."
        >
          Next milestone
        </RoadmapColumnHeader>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
      </div>
    </div>
  );
}
