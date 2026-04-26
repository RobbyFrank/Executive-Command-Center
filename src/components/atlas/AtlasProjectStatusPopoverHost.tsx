"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GoalWithProjects,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";
import { useSlackThreadStatus } from "@/hooks/useSlackThreadStatus";
import { useMilestoneLikelihood } from "@/hooks/useMilestoneLikelihood";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { isValidHttpUrl } from "@/lib/httpUrl";
import {
  SlackMilestoneThreadPopovers,
  type SlackPingMode,
} from "@/components/tracker/SlackMilestoneThreadPopovers";

interface AtlasProjectStatusPopoverHostProps {
  project: ProjectWithMilestones;
  /** Parent goal — used for slack channel + goal description context. */
  parentGoal: GoalWithProjects | undefined;
  people: Person[];
  /** Resolved owner from `peopleById`. */
  owner: Person | undefined;
  /**
   * Screen-space rect captured when the user clicked the project's status
   * indicator. The popover anchors to a fixed-positioned proxy div placed at
   * this rect so the SlackThreadPopover (which expects an HTMLElement anchor)
   * can compute placement against a stable, unmoving target — bubbles in the
   * Atlas drift via SMIL so we don't track the live bubble position.
   */
  anchorRect: { left: number; top: number; width: number; height: number };
  /**
   * When set, the popover is anchored to a specific milestone pip click (that
   * milestone’s Slack thread + likelihood). When omitted, falls back to the
   * next pending milestone (Roadmap row behavior).
   */
  focusedMilestoneId?: string | null;
  onClose: () => void;
}

/**
 * Mounts the same Slack thread popover used on the Roadmap project row, but
 * anchored to a fixed-positioned proxy div over the Atlas project bubble so
 * the existing tracker popover code can be reused without modification.
 *
 * Hooks (`useSlackThreadStatus`, `useMilestoneLikelihood`) only run while the
 * popover is open — the host is mounted lazily by the parent atlas only when
 * a project status pip / at-risk pulse has been clicked.
 */
export function AtlasProjectStatusPopoverHost({
  project,
  parentGoal,
  people,
  owner,
  anchorRect,
  focusedMilestoneId = null,
  onClose,
}: AtlasProjectStatusPopoverHostProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);

  const [popoverOpen, setPopoverOpen] = useState(true);
  const [pingOpen, setPingOpen] = useState(false);
  const [pingMode, setPingMode] = useState<SlackPingMode>("ping");

  /** Closing the popover (X, Esc, outside-click) tears down the host. */
  useEffect(() => {
    if (!popoverOpen && !pingOpen) onClose();
  }, [popoverOpen, pingOpen, onClose]);

  const targetMilestone = useMemo(() => {
    if (focusedMilestoneId) {
      return (
        project.milestones.find((m) => m.id === focusedMilestoneId) ?? null
      );
    }
    return getNextPendingMilestone(project.milestones);
  }, [project.milestones, focusedMilestoneId]);

  const nextSlackUrl = useMemo(() => {
    if (!targetMilestone) return null;
    const u = targetMilestone.slackUrl.trim();
    return isValidHttpUrl(u) ? u : null;
  }, [targetMilestone]);

  const slackThread = useSlackThreadStatus(nextSlackUrl, people);

  const milestonesSummary = useMemo(
    () =>
      project.milestones
        .map(
          (m) =>
            `- ${m.name} [${m.status}]${m.targetDate ? ` ${m.targetDate}` : ""}`
        )
        .join("\n"),
    [project.milestones]
  );

  const roadmapForLikelihood = useMemo(
    () => `Project: ${project.name}\n\nMilestones:\n${milestonesSummary}`,
    [project.name, milestonesSummary]
  );

  const threadReplyCountForLikelihood = slackThread.loading
    ? null
    : (slackThread.status?.replyCount ?? null);

  const likelihood = useMilestoneLikelihood({
    slackUrl: nextSlackUrl,
    milestoneName: targetMilestone?.name ?? "",
    targetDate: targetMilestone?.targetDate ?? "",
    ownerAutonomy: owner?.autonomyScore ?? null,
    projectComplexity: project.complexityScore,
    rosterHints: slackThread.rosterHints,
    roadmapContext: roadmapForLikelihood,
    threadReplyCount:
      nextSlackUrl != null ? threadReplyCountForLikelihood : null,
  });

  if (!targetMilestone || !nextSlackUrl) {
    /**
     * Mirrors the Roadmap project row: the rich Slack popover only renders
     * when the milestone has a valid Slack thread URL. Without one there's
     * nothing meaningful to show, so we close immediately — hover on the
     * pip still shows basic milestone details.
     */
    return (
      <CloseImmediately onClose={onClose} />
    );
  }

  return (
    <>
      {/* Fixed-positioned proxy anchor — invisible, pointer-events disabled
          so it never intercepts clicks on the underlying Atlas SVG. The
          inner element is a `<button>` because `SlackMilestoneThreadPopovers`
          expects an HTMLButtonElement anchor. */}
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
        <button
          ref={anchorRef}
          type="button"
          aria-hidden
          tabIndex={-1}
          className="h-full w-full bg-transparent p-0"
          style={{ pointerEvents: "none" }}
        />
      </div>
      <SlackMilestoneThreadPopovers
        anchorRef={anchorRef}
        spotlightRef={spotlightRef}
        goalDescription={parentGoal?.description ?? ""}
        projectName={project.name}
        goalSlackChannelId={parentGoal?.slackChannelId ?? ""}
        goalSlackChannelName={parentGoal?.slackChannel ?? ""}
        people={people}
        slackUrl={nextSlackUrl}
        milestoneName={targetMilestone.name}
        status={slackThread.status}
        rosterHints={slackThread.rosterHints}
        popoverOpen={popoverOpen}
        onPopoverOpenChange={setPopoverOpen}
        pingOpen={pingOpen}
        onPingOpenChange={setPingOpen}
        pingMode={pingMode}
        onPingModeChange={setPingMode}
        onRefreshStatus={() => void slackThread.refresh({ force: true })}
        onPingSent={() => void slackThread.refresh({ force: true })}
        targetDate={targetMilestone.targetDate}
        ownerName={owner?.name ?? null}
        ownerAutonomy={owner?.autonomyScore ?? null}
        projectComplexity={project.complexityScore}
        likelihood={likelihood.result}
        likelihoodLoading={likelihood.loading}
        likelihoodError={likelihood.error}
      />
    </>
  );
}

/**
 * Helper component to call `onClose` exactly once on mount when the project
 * has nothing assessable (no next milestone or no Slack thread). Avoids
 * calling parent setState during the host's render.
 */
function CloseImmediately({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    onClose();
  }, [onClose]);
  return null;
}
