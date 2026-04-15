"use client";

import type { RefObject } from "react";
import type { SlackMemberRosterHint } from "@/server/actions/slack";
import type { SlackThreadStatusOk } from "@/lib/slackThreadStatusCache";
import { SlackThreadPopover } from "./SlackThreadPopover";
import { SlackPingDialog } from "./SlackPingDialog";

interface SlackMilestoneThreadPopoversProps {
  anchorRef: RefObject<HTMLButtonElement | null>;
  slackUrl: string;
  milestoneName: string;
  status: SlackThreadStatusOk | null;
  rosterHints: SlackMemberRosterHint[];
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  pingOpen: boolean;
  onPingOpenChange: (open: boolean) => void;
  onRefreshStatus: () => void;
  onPingSent: () => void;
}

/** Popover + ping dialog wired to an external anchor (e.g. inline thread summary). */
export function SlackMilestoneThreadPopovers({
  anchorRef,
  slackUrl,
  milestoneName,
  status,
  rosterHints,
  popoverOpen,
  onPopoverOpenChange,
  pingOpen,
  onPingOpenChange,
  onRefreshStatus,
  onPingSent,
}: SlackMilestoneThreadPopoversProps) {
  return (
    <>
      <SlackThreadPopover
        open={popoverOpen}
        onClose={() => onPopoverOpenChange(false)}
        anchorRef={anchorRef}
        slackUrl={slackUrl}
        milestoneName={milestoneName}
        status={status}
        rosterHints={rosterHints}
        onRefreshStatus={onRefreshStatus}
        onOpenPing={() => onPingOpenChange(true)}
      />
      <SlackPingDialog
        open={pingOpen}
        onClose={() => onPingOpenChange(false)}
        slackUrl={slackUrl}
        milestoneName={milestoneName}
        rosterHints={rosterHints}
        onSent={onPingSent}
      />
    </>
  );
}
