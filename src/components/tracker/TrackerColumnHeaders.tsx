"use client";

/** Column label rows for Roadmap — widths must match GoalSection / ProjectRow. Priority is w-28. Goals after Priority: Cost of delay (w-28, above project Complexity), Confidence (w-28), Slack. Projects row omits the Confidence label (uses Goals row above). */

import { SlackLogo } from "./SlackLogo";
import { RoadmapColumnHeader } from "./RoadmapColumnHeader";
import { useRoadmapView } from "./roadmap-view-context";
import { cn } from "@/lib/utils";
import { ROADMAP_TOOLBAR_STICKY_FALLBACK_PX } from "@/lib/tracker-sticky-layout";

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
      <div className="flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-1.5 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-[360px] shrink-0"
          tooltip="Goal title — what you are trying to achieve for this company."
        >
          Goal
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-[5.85rem] shrink-0 min-w-0"
          tooltip="Owner — single person accountable for the goal's outcome. Project-level owners are tracked separately."
        >
          Owner
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0 flex items-center justify-center"
          tooltip="Priority — Urgent (P0) through Low (P3); stored as P0–P3."
        >
          Priority
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0 min-w-0"
          tooltip="Cost of delay — how costly it is to wait; higher means more urgency. Aligns above project Complexity."
        >
          Cost of delay
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0"
          tooltip="Confidence (0–100%). Hover or focus a cell: project autonomy vs complexity, then goal cost of delay weights higher-autonomy project owners when delay is costly."
        >
          Confidence
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-52 shrink-0 flex items-center"
          tooltip="Slack channel for this goal (name or link)."
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </RoadmapColumnHeader>
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
        "sticky max-w-full min-w-0 border-b border-zinc-800/70",
        stickyZClass ?? "z-20",
        "bg-zinc-950/90 backdrop-blur-sm"
      )}
      style={{ top }}
    >
      <div className="flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-1.5 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-[360px] shrink-0"
          tooltip="Project name — a concrete initiative under this goal."
        >
          Project
        </RoadmapColumnHeader>
        <div className="w-[5.85rem] shrink-0" aria-hidden />
        <div className="w-28 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-28 shrink-0 min-w-0"
          tooltip="Complexity — scope and difficulty of the work (Very high → Minimal)."
        >
          Complexity
        </RoadmapColumnHeader>
        <div className="w-28 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-44 shrink-0"
          tooltip="Project workflow: Idea → Pending → In Progress → Stuck → For Review → Done."
        >
          Status
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0 -ml-1"
          tooltip="Due date — same date as the last milestone with a target date; shown as a relative label (e.g. in 2 months) like milestone dates. Hover for the full date."
        >
          Due date
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-32 shrink-0 ml-3"
          tooltip="Progress — milestones marked Done out of total (e.g. 3/7). Bar fill reflects the share."
        >
          Progress
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-[36rem] shrink-0 min-w-0"
          tooltip="The first milestone not marked done — horizon (e.g. 5D, 2W) from its target date when set, then name. When the project row is collapsed and the milestone has a Slack thread URL, the latest reply preview appears here."
        >
          Next milestone
        </RoadmapColumnHeader>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
      </div>
    </div>
  );
}
