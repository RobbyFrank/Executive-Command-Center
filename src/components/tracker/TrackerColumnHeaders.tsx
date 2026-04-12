"use client";

/** Column label rows for Roadmap — widths must match GoalSection / ProjectRow (goal title w-[280px], project name w-[264px] in rail). */

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
        "bg-zinc-950/95 backdrop-blur-sm shadow-[0_1px_0_rgba(0,0,0,0.35)]"
      )}
      style={{ top }}
    >
      <div className="flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-1.5 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-[280px] shrink-0"
          tooltip="Goal title — what you are trying to achieve for this company."
        >
          Goal
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-36 shrink-0 min-w-0"
          tooltip="DRI — single person accountable for the goal's outcome. Project-level owners are tracked separately."
        >
          DRI
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-14 shrink-0"
          tooltip="Priority — P0 is most urgent; higher numbers are lower priority."
        >
          Pri
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0"
          tooltip="Description of the outcome or metric for this goal."
        >
          Description
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0"
          tooltip="Why this goal matters — what we stand to gain if we achieve it."
        >
          Why
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0"
          tooltip="Current value or progress vs the description / target."
        >
          Current
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0 flex items-center justify-center text-zinc-600"
          tooltip="No goal-level field here — aligns with project Complexity so Next milestone and Status line up."
        >
          <span aria-hidden>·</span>
          <span className="sr-only">Column spacer (complexity alignment)</span>
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0 flex items-center justify-center text-zinc-600"
          tooltip="No goal-level field here — aligns with the Complexity column on projects below."
        >
          <span aria-hidden>·</span>
          <span className="sr-only">Column spacer (complexity alignment)</span>
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0"
          tooltip="Confidence (0–100%). Hover or focus a cell: project autonomy vs complexity, then goal cost of delay weights higher-autonomy project owners when delay is costly."
        >
          Confidence
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-32 shrink-0"
          tooltip="Cost of delay — how costly it is to wait; higher means more urgency."
        >
          Cost of delay
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0"
          tooltip="Execution mode — Sync means projects run in sequence; Async means they can run in parallel."
        >
          Exec
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0 flex items-center"
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
        "bg-zinc-950/90 backdrop-blur-sm shadow-[0_1px_0_rgba(0,0,0,0.3)]"
      )}
      style={{ top }}
    >
      <div className="flex w-full min-w-max items-center gap-2 pl-6 pr-4 py-1.5 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-[264px] shrink-0"
          tooltip="Project name — a concrete initiative under this goal."
        >
          Project
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-36 shrink-0 min-w-0"
          tooltip="Project owner — who is directly responsible for delivery (use goal DRI for outcome accountability)."
        >
          Owner
        </RoadmapColumnHeader>
        {/* Pri & Description — same labels as Goals row above; spacers keep column alignment */}
        <div className="w-14 shrink-0" aria-hidden />
        <div className="w-44 shrink-0 min-w-0" aria-hidden />
        <RoadmapColumnHeader
          className="w-44 shrink-0 min-w-0"
          tooltip="Definition of done — when this project counts as complete."
        >
          Done when
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0"
          tooltip="Complexity — higher is harder to deliver."
        >
          Complexity
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0 min-w-0"
          tooltip="Next milestone not yet done (from your milestone list)."
        >
          Next milestone
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0"
          tooltip="Project workflow: Idea → Pending → In Progress → Stuck → For Review → Done."
        >
          Status
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0"
          tooltip="Confidence (0–100%). Hover or focus a cell for autonomy vs complexity."
        >
          Confidence
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-32 shrink-0"
          tooltip="Progress — share of milestones marked done."
        >
          Progress
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-28 shrink-0"
          tooltip="Due date — when you aim to finish this project. Sync goals: each row must be after the previous project’s due date."
        >
          Due date
        </RoadmapColumnHeader>
        <RoadmapColumnHeader
          className="w-44 shrink-0 min-w-0 flex items-center"
          tooltip="Slack link or channel for this project."
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </RoadmapColumnHeader>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
      </div>
    </div>
  );
}
