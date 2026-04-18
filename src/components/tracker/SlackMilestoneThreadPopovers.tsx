"use client";

import type { RefObject } from "react";
import type {
  SlackMemberRosterHint,
  MilestoneLikelihoodRiskLevel,
} from "@/server/actions/slack";
import type { SlackThreadStatusOk } from "@/lib/slackThreadStatusCache";
import type { Person } from "@/lib/types/tracker";
import { SlackThreadPopover } from "./SlackThreadPopover";
import { SlackPingDialog } from "./SlackPingDialog";

export type SlackPingMode = "ping" | "nudge" | "reply";

interface SlackMilestoneThreadPopoversProps {
  anchorRef: RefObject<HTMLButtonElement | null>;
  /** Row/card to keep clear of the dimmed overlay (defaults to Slack control only). */
  spotlightRef?: RefObject<HTMLElement | null>;
  goalDescription?: string;
  projectName?: string;
  goalSlackChannelId?: string;
  goalSlackChannelName?: string;
  people?: Person[];
  slackUrl: string;
  milestoneName: string;
  status: SlackThreadStatusOk | null;
  rosterHints: SlackMemberRosterHint[];
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  pingOpen: boolean;
  onPingOpenChange: (open: boolean) => void;
  pingMode: SlackPingMode;
  onPingModeChange: (mode: SlackPingMode) => void;
  onRefreshStatus: () => void;
  onPingSent: () => void;
  targetDate: string;
  ownerName: string | null;
  ownerAutonomy: number | null;
  projectComplexity: number;
  likelihood: {
    likelihood: number;
    riskLevel: MilestoneLikelihoodRiskLevel;
    reasoning: string;
    threadSummaryLine: string;
    progressEstimate: number;
    daysRemaining: number;
    daysElapsed: number;
  } | null;
  likelihoodLoading: boolean;
  likelihoodError: string | null;
}

/** Popover + ping/nudge dialog wired to an external anchor (e.g. inline thread summary). */
export function SlackMilestoneThreadPopovers({
  anchorRef,
  spotlightRef,
  goalDescription = "",
  projectName = "",
  goalSlackChannelId = "",
  goalSlackChannelName = "",
  people = [],
  slackUrl,
  milestoneName,
  status,
  rosterHints,
  popoverOpen,
  onPopoverOpenChange,
  pingOpen,
  onPingOpenChange,
  pingMode,
  onPingModeChange,
  onRefreshStatus,
  onPingSent,
  targetDate,
  ownerName,
  ownerAutonomy,
  projectComplexity,
  likelihood,
  likelihoodLoading,
  likelihoodError,
}: SlackMilestoneThreadPopoversProps) {
  return (
    <>
      <SlackThreadPopover
        open={popoverOpen}
        onClose={() => onPopoverOpenChange(false)}
        anchorRef={anchorRef}
        spotlightRef={spotlightRef}
        slackUrl={slackUrl}
        milestoneName={milestoneName}
        status={status}
        rosterHints={rosterHints}
        onRefreshStatus={onRefreshStatus}
        onOpenPing={() => {
          onPingModeChange("ping");
          onPingOpenChange(true);
        }}
        onOpenNudge={() => {
          onPingModeChange("nudge");
          onPingOpenChange(true);
        }}
        onOpenReply={() => {
          onPingModeChange("reply");
          onPingOpenChange(true);
        }}
        targetDate={targetDate}
        ownerName={ownerName}
        ownerAutonomy={ownerAutonomy}
        projectComplexity={projectComplexity}
        likelihood={likelihood}
        likelihoodLoading={likelihoodLoading}
        likelihoodError={likelihoodError}
      />
      <SlackPingDialog
        open={pingOpen}
        onClose={() => {
          onPingOpenChange(false);
          onPopoverOpenChange(true);
        }}
        slackUrl={slackUrl}
        milestoneName={milestoneName}
        goalDescription={goalDescription}
        projectName={projectName}
        channelId={goalSlackChannelId}
        channelName={goalSlackChannelName}
        people={people}
        rosterHints={rosterHints}
        onSent={onPingSent}
        mode={pingMode}
        targetDate={targetDate}
        assigneeName={ownerName}
        spotlightRef={spotlightRef}
        likelihoodContext={
          pingMode === "nudge" && likelihood
            ? {
                reasoning: likelihood.reasoning,
                riskLevel: likelihood.riskLevel,
                progressEstimate: likelihood.progressEstimate,
              }
            : null
        }
      />
    </>
  );
}
