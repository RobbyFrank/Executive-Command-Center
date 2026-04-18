"use client";

import { cn } from "@/lib/utils";
import { ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX } from "@/lib/tracker-sticky-layout";
import {
  ROADMAP_DATA_COL_CLASS,
  ROADMAP_DELAY_COMPLEXITY_COL_CLASS,
  ROADMAP_GOAL_GRID_PADDING_CLASS,
  ROADMAP_GOAL_TITLE_COL_CLASS,
  ROADMAP_GRID_GAP_CLASS,
  ROADMAP_NEXT_MILESTONE_COL_CLASS,
  ROADMAP_OWNER_COL_CLASS,
  ROADMAP_GOAL_SLACK_COL_CLASS,
} from "@/lib/tracker-roadmap-columns";
import { AddEntityMenuButton } from "./AddEntityMenuButton";

const PH = "text-xs tabular-nums text-zinc-600/90";

interface CompanyEmptyGoalRowPlaceholderProps {
  roadmapGoalRowStickyTopPx: number;
  companyId: string;
  onManualAdd: () => void;
  onGoalCreated: (goalId: string) => void;
}

/**
 * When a company has no goals — one row that matches a real {@link GoalSection} header (grid,
 * chrome, sticky) with “Add goal” (menu: AI or blank) in the title column and muted placeholders elsewhere.
 */
export function CompanyEmptyGoalRowPlaceholder({
  roadmapGoalRowStickyTopPx,
  companyId,
  onManualAdd,
  onGoalCreated,
}: CompanyEmptyGoalRowPlaceholderProps) {
  const goalStickyTopPx =
    roadmapGoalRowStickyTopPx - ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX;

  return (
    <div
      className={cn(
        "max-w-full min-w-0 transition-colors duration-150",
        "mb-2 rounded-md",
      )}
    >
      <div
        style={{ top: goalStickyTopPx }}
        className={cn(
          "sticky z-[27] w-full min-w-0 max-w-full backdrop-blur-sm transition-colors duration-150 motion-reduce:transition-none",
          "rounded-t-md border-b border-zinc-800/60 shadow-[0_1px_0_rgba(0,0,0,0.2)]",
          "bg-zinc-950/95 hover:bg-zinc-900/85",
        )}
      >
        <div
          className={cn(
            "group/goal flex min-h-[28px] w-full min-w-max max-w-full cursor-default items-center py-1 transition-colors",
            ROADMAP_GRID_GAP_CLASS,
            ROADMAP_GOAL_GRID_PADDING_CLASS,
          )}
        >
          {/* Same width as goal-row chevron column; no expand affordance on this placeholder */}
          <div className="w-8 shrink-0" aria-hidden />

          <div className={cn(ROADMAP_GOAL_TITLE_COL_CLASS, "min-w-0")}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <AddEntityMenuButton
                kind="goal"
                companyId={companyId}
                label="Add goal"
                buttonTitle="Add a new goal for this company"
                onManualAdd={onManualAdd}
                onAiCreated={onGoalCreated}
              />
            </div>
          </div>

          <div
            className={cn(
              ROADMAP_OWNER_COL_CLASS,
              "flex items-center justify-center",
            )}
          >
            <span className={PH}>—</span>
          </div>
          <div className={ROADMAP_DATA_COL_CLASS}>
            <span className={PH}>—</span>
          </div>
          <div className={ROADMAP_DELAY_COMPLEXITY_COL_CLASS}>
            <span className={PH}>—</span>
          </div>
          <div
            className={cn(
              ROADMAP_DATA_COL_CLASS,
              "flex items-center justify-start pl-0.5",
            )}
          >
            <span className={PH}>—</span>
          </div>
          <div className={cn(ROADMAP_DATA_COL_CLASS, "flex items-center justify-start pl-2")}>
            <span className={PH}>—</span>
          </div>
          <div className={ROADMAP_DATA_COL_CLASS}>
            <span className={PH}>—</span>
          </div>
          <div className={ROADMAP_GOAL_SLACK_COL_CLASS}>
            <span className={PH}>—</span>
          </div>

          <div className={ROADMAP_NEXT_MILESTONE_COL_CLASS} aria-hidden />

          <div className="min-w-2 flex-1" aria-hidden />

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5" aria-hidden />

          {/* Reserve the same width as goal row + / ⋯ actions */}
          <div
            className="flex shrink-0 items-center gap-2 pr-0.5"
            aria-hidden
          >
            <div className="h-7 w-7 rounded p-0.5" />
            <div className="h-7 w-7 rounded p-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
