"use client";

/** Column label rows for Roadmap — match GoalSection and ProjectRow widths. */

import { SlackLogo } from "./SlackLogo";
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
        "sticky border-b border-zinc-800/90",
        stickyZClass ?? "z-20",
        "bg-zinc-950/95 backdrop-blur-sm shadow-[0_1px_0_rgba(0,0,0,0.35)]"
      )}
      style={{ top }}
    >
      <div className="flex items-center gap-2 pl-6 pr-4 py-2 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <div className="w-[280px] shrink-0" title="Goal description">
          Goal
        </div>
        <div className="w-40 shrink-0 min-w-0" title="Owner and department">
          Owner
        </div>
        <div className="w-14 shrink-0">Pri</div>
        <div
          className="w-44 shrink-0"
          title="Description of the outcome or metric for this goal"
        >
          Description
        </div>
        <div
          className="w-44 shrink-0"
          title="Current value vs description"
        >
          Current
        </div>
        <div
          className="w-44 shrink-0"
          title="Impact — higher is more valuable if the goal is achieved"
        >
          Impact
        </div>
        <div
          className="w-28 shrink-0"
          aria-hidden
          title="Aligns with project Complexity (no field at goal level)"
        />
        <div
          className="w-28 shrink-0"
          title="Confidence (20–100%). Hover or focus a cell for how this goal’s score is averaged from projects."
        >
          Confidence
        </div>
        <div
          className="w-32 shrink-0"
          title="Cost of delay — how costly it is to wait; higher means more urgency"
        >
          Cost of delay
        </div>
        <div
          className="w-28 shrink-0"
          title="Sync = sequential projects; Async = parallel"
        >
          Exec
        </div>
        <div
          className="w-44 shrink-0 flex items-center"
          title="Slack channel"
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </div>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
        <div className="w-[5.5rem] shrink-0 text-right pr-0">Review</div>
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
        "sticky border-b border-zinc-800/70",
        stickyZClass ?? "z-20",
        "bg-zinc-950/90 backdrop-blur-sm shadow-[0_1px_0_rgba(0,0,0,0.3)]"
      )}
      style={{ top }}
    >
      <div className="flex items-center gap-2 pl-6 pr-4 py-2 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <div className="w-[280px] shrink-0" title="Project name">
          Project
        </div>
        <div className="w-40 shrink-0 min-w-0" aria-hidden />
        <div className="w-14 shrink-0" aria-hidden />
        <div className="w-44 shrink-0" title="Delivery status">
          Status
        </div>
        <div
          className="w-44 shrink-0 min-w-0"
          title="Next milestone not yet done (from your milestone list)"
        >
          Next milestone
        </div>
        <div
          className="w-44 shrink-0 min-w-0"
          title="When this project counts as done"
        >
          Done when
        </div>
        <div
          className="w-28 shrink-0"
          title="Complexity — higher is harder to deliver"
        >
          Complexity
        </div>
        <div
          className="w-28 shrink-0"
          title="Confidence (20–100%). Hover or focus a cell for autonomy vs complexity."
        >
          Confidence
        </div>
        <div className="w-32 shrink-0">Progress</div>
        <div className="w-28 shrink-0" title="Target date">
          Date
        </div>
        <div
          className="w-44 shrink-0 flex items-center"
          title="Slack URL"
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </div>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
        <div className="w-[5.5rem] shrink-0 text-right pr-0">Review</div>
      </div>
    </div>
  );
}
