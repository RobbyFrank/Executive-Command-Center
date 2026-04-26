"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GoalWithProjects, Person } from "@/lib/types/tracker";
import { useGoalLikelihoodRollup } from "@/hooks/useGoalLikelihoodRollup";
import { useGoalOneLiner } from "@/hooks/useGoalOneLiner";
import {
  buildGoalPopoverProjectRows,
  buildGoalPopoverProjectOwners,
  buildGoalPopoverChannelAiContext,
} from "@/lib/goalPopoverData";
import {
  GoalSlackPopover,
  type GoalSlackPopoverAction,
} from "@/components/tracker/GoalSlackPopover";
import { SlackChannelMessageDialog } from "@/components/tracker/SlackChannelMessageDialog";

interface AtlasGoalStatusPopoverHostProps {
  goal: GoalWithProjects;
  people: Person[];
  peopleById: ReadonlyMap<string, Person>;
  /**
   * Screen-space rect captured when the user clicked the goal's status pip.
   * Anchors a fixed-position proxy div that the existing tracker popover
   * uses for placement; bubbles drift via SMIL so we deliberately don't
   * track the live position once the popover is open.
   */
  anchorRect: { left: number; top: number; width: number; height: number };
  onClose: () => void;
  /**
   * Called when the user picks "View thread" on a project row inside the
   * popover. The Atlas should drill into that project at L2 (atlas-side
   * navigation) so the user lands inside the right project context.
   */
  onOpenProjectInAtlas?: (projectId: string) => void;
}

/**
 * Mounts the same `GoalSlackPopover` (delivery rollup + per-project rows +
 * channel actions) used on the Roadmap goal row, anchored to a fixed proxy
 * div over an Atlas goal bubble. Hooks (`useGoalLikelihoodRollup`,
 * `useGoalOneLiner`) only run while the popover is open — the host is
 * mounted lazily by the parent atlas only when a status pip has been
 * clicked.
 */
export function AtlasGoalStatusPopoverHost({
  goal,
  people,
  peopleById,
  anchorRect,
  onClose,
  onOpenProjectInAtlas,
}: AtlasGoalStatusPopoverHostProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);

  const [popoverOpen, setPopoverOpen] = useState(true);
  const [channelMessageOpen, setChannelMessageOpen] = useState(false);
  const [channelMessageMode, setChannelMessageMode] =
    useState<GoalSlackPopoverAction>("reply");

  /** Closing both the popover and the optional message dialog tears down the host. */
  useEffect(() => {
    if (!popoverOpen && !channelMessageOpen) onClose();
  }, [popoverOpen, channelMessageOpen, onClose]);

  /**
   * The goal popover hooks are gated by an `enabled` flag in the source so
   * they only fire on collapsed Roadmap rows. Inside the Atlas the popover
   * is itself "the collapsed view" — rollup data is exactly what the user
   * just clicked to see, so always enable.
   */
  const { rollup: goalLikelihoodRollup, loading: goalLikelihoodLoading } =
    useGoalLikelihoodRollup(goal, people, true);

  const oneLinerEnabled = Boolean(goalLikelihoodRollup?.ready);
  const {
    summaryLine: goalOneLinerSummary,
    loading: goalOneLinerLoading,
    error: goalOneLinerError,
  } = useGoalOneLiner(
    goal.id,
    goal.description,
    goalLikelihoodRollup,
    oneLinerEnabled
  );

  const projectRows = useMemo(
    () =>
      buildGoalPopoverProjectRows({
        goal,
        rollup: goalLikelihoodRollup,
        peopleById,
      }),
    [goal, goalLikelihoodRollup, peopleById]
  );

  const owners = useMemo(
    () =>
      buildGoalPopoverProjectOwners({
        goal,
        rollup: goalLikelihoodRollup,
        projectRows,
        peopleById,
      }),
    [goal, goalLikelihoodRollup, projectRows, peopleById]
  );

  const channelAiContext = useMemo(
    () =>
      buildGoalPopoverChannelAiContext({
        goal,
        rollup: goalLikelihoodRollup,
        oneLinerSummary: goalOneLinerSummary,
        projectRows,
        projectOwners: owners,
        peopleById,
      }),
    [
      goal,
      goalLikelihoodRollup,
      goalOneLinerSummary,
      projectRows,
      owners,
      peopleById,
    ]
  );

  return (
    <>
      {/* Fixed-positioned proxy anchor — invisible, pointer-events disabled. */}
      <div
        ref={spotlightRef}
        aria-hidden
        style={{
          position: "fixed",
          left: anchorRect.left,
          top: anchorRect.top,
          width: anchorRect.width,
          height: anchorRect.height,
          pointerEvents: "none",
        }}
      >
        <div ref={anchorRef} className="h-full w-full" />
      </div>
      <GoalSlackPopover
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        anchorRef={anchorRef}
        spotlightRef={spotlightRef}
        goalDescription={goal.description}
        goalSlackChannelName={goal.slackChannel ?? ""}
        goalSlackChannelId={goal.slackChannelId ?? ""}
        rollup={goalLikelihoodRollup}
        rollupLoading={goalLikelihoodLoading}
        oneLinerSummary={goalOneLinerSummary}
        oneLinerLoading={goalOneLinerLoading}
        oneLinerError={goalOneLinerError}
        projectRows={projectRows}
        owners={owners}
        onOpenChannelMessage={(mode) => {
          setChannelMessageMode(mode);
          setChannelMessageOpen(true);
        }}
        onOpenProjectSlackThread={(projectId) => {
          // Atlas navigation: close popover and let the parent drill into the
          // project at L2 — the project's milestone Slack thread is reachable
          // there via the project's own status pip.
          setPopoverOpen(false);
          onOpenProjectInAtlas?.(projectId);
        }}
      />
      <SlackChannelMessageDialog
        open={channelMessageOpen}
        onClose={(reason) => {
          setChannelMessageOpen(false);
          // Roadmap re-opens the goal popover after a `dismiss` — mirror the
          // same UX so the user lands back where they started instead of an
          // empty Atlas canvas.
          if (reason === "dismiss") setPopoverOpen(true);
        }}
        goalId={goal.id}
        goalDescription={goal.description}
        channelId={goal.slackChannelId ?? ""}
        channelName={goal.slackChannel ?? ""}
        people={people}
        spotlightRef={spotlightRef}
        mode={channelMessageMode}
        goalContext={channelAiContext}
      />
    </>
  );
}
