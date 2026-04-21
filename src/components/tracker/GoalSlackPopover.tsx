"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  ChevronDown,
  CircleCheck,
  Clock,
  Loader2,
  MessageCircleQuestion,
  Reply,
  X,
} from "lucide-react";
import type {
  MilestoneLikelihoodRiskLevel,
} from "@/server/actions/slack";
import type { GoalLikelihoodRollup } from "@/lib/goalLikelihoodRollup";
import { cn } from "@/lib/utils";
import { SlackLogo } from "./SlackLogo";
import {
  SlackThreadSpotlightBackdrop,
  readSpotlightHole,
  type SlackThreadSpotlightHole,
} from "./SlackThreadSpotlightBackdrop";
import { displayInitials } from "@/lib/displayInitials";
import type { GoalLikelihoodInlineOwner } from "./GoalLikelihoodInline";

/** Matches Tailwind `max-h-[min(84vh,44rem)]` on the popover panel. */
function popoverCssMaxHeightPx(winH: number): number {
  return Math.min(winH * 0.84, 44 * 16);
}

function computePlacement(
  el: HTMLElement,
  winW: number,
  winH: number
): { top: number; right: number; maxHeightPx: number } {
  const rect = el.getBoundingClientRect();
  const panelW = Math.min(880, winW - 24);
  const rightEdge = winW - rect.right;
  const clampedRight = Math.min(
    Math.max(8, rightEdge),
    winW - panelW - 8
  );

  const gap = 6;
  const margin = 8;
  const cssMaxH = popoverCssMaxHeightPx(winH);
  const maxFitH = Math.min(cssMaxH, winH - 2 * margin);

  const idealBelow = rect.bottom + gap;

  let top: number;
  if (idealBelow + maxFitH <= winH - margin) {
    top = idealBelow;
  } else {
    const idealAbove = rect.top - gap - maxFitH;
    if (idealAbove >= margin) {
      top = idealAbove;
    } else {
      top = Math.max(margin, winH - margin - maxFitH);
    }
  }

  const maxHeightPx = Math.min(cssMaxH, Math.max(0, winH - top - margin));

  return { top, right: clampedRight, maxHeightPx };
}

type PopoverGeometry = {
  placement: { top: number; right: number; maxHeightPx: number };
  spotlight: { hole: SlackThreadSpotlightHole; vw: number; vh: number };
};

function measurePopoverGeometry(
  anchorEl: HTMLElement,
  spotlightEl: HTMLElement | null,
  winW: number,
  winH: number
): PopoverGeometry | null {
  const hole = readSpotlightHole(spotlightEl, anchorEl);
  if (!hole) return null;
  return {
    placement: computePlacement(anchorEl, winW, winH),
    spotlight: { hole, vw: winW, vh: winH },
  };
}

const RISK_ORDER: Record<MilestoneLikelihoodRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function likelihoodTextClass(level: MilestoneLikelihoodRiskLevel): string {
  switch (level) {
    case "low":
      return "text-emerald-300/95";
    case "medium":
      return "text-amber-200/95";
    case "high":
      return "text-orange-300/95";
    case "critical":
      return "text-red-300/95";
    default:
      return "text-zinc-300";
  }
}

function progressTextClass(pct: number): string {
  if (pct >= 90) return "text-emerald-300";
  if (pct >= 70) return "text-emerald-300/80";
  if (pct >= 45) return "text-sky-300/90";
  return "text-zinc-300/90";
}

const REASONING_MAX = 220;

function truncateSummary(s: string, maxChars = REASONING_MAX): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  const cut = t.lastIndexOf(" ", maxChars);
  return `${t.slice(0, cut > 60 ? cut : maxChars)}…`;
}

/** Why a project row has no AI assessment yet — drives the inline label in place of 0% pills. */
export type GoalSlackPopoverUnscoredReason =
  | "noMilestones"
  | "completed"
  | "notStarted"
  | "noTargetDate"
  | "noSlackThread"
  | "assessing";

/** Within unscored, sort needs-attention first, completed last, with scheduling gaps in between. */
const UNSCORED_ORDER: Record<GoalSlackPopoverUnscoredReason, number> = {
  noTargetDate: 0,
  noSlackThread: 1,
  noMilestones: 2,
  notStarted: 3,
  assessing: 4,
  completed: 5,
};

export interface GoalSlackPopoverProjectRow {
  projectId: string;
  projectName: string;
  /** Empty when the project has no milestones / no pending milestone. */
  milestoneName: string;
  summaryLine: string;
  likelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  progressEstimate: number;
  /** Thread URL for "View thread →" (blank means no link). */
  slackUrl: string;
  /** Owner for mini avatar (omit → initials from blank). */
  owner: { name: string; profilePicturePath: string } | null;
  /** True when we have a cached on-time + progress estimate. Drives pills vs. reason label. */
  scored: boolean;
  /** Short machine code for the unscored reason; only set when `!scored`. */
  reasonCode?: GoalSlackPopoverUnscoredReason;
  /** Human label rendered in the card instead of pills when `!scored`. */
  reasonLabel?: string;
  /**
   * Separate from `reasonCode`: a project can be blocked AND have a cached estimate.
   * Rendered as a small note under the project name (e.g. "Blocked by Rebranding").
   */
  blockerNote?: string;
}

/** Which channel-message flow the user picked from the Actions menu. */
export type GoalSlackPopoverAction = "ping" | "nudge" | "reply";

export interface GoalSlackPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  spotlightRef?: RefObject<HTMLElement | null>;
  goalDescription: string;
  goalSlackChannelName: string;
  goalSlackChannelId: string;
  rollup: GoalLikelihoodRollup | null;
  rollupLoading: boolean;
  oneLinerSummary: string | null;
  oneLinerLoading: boolean;
  oneLinerError: string | null;
  /** Rows enriched with owner + slackUrl from the parent; sorted externally (worst-first) is fine but we re-sort defensively. */
  projectRows: GoalSlackPopoverProjectRow[];
  /** Full project-owner list (for the header avatar stack). */
  owners: GoalLikelihoodInlineOwner[];
  /** Opens the channel composer in the requested mode. */
  onOpenChannelMessage: (mode: GoalSlackPopoverAction) => void;
  /**
   * Requests opening the in-app Slack thread window for a project row.
   * `ProjectRow` is not mounted here, so the parent forwards this to a shared
   * pub/sub that `GoalSection` + `ProjectRow` subscribe to (expand goal, open
   * the row's existing thread popover).
   */
  onOpenProjectSlackThread?: (projectId: string) => void;
}

type NudgeDisabledReason = "noChannel" | "loading" | "notReady" | null;

interface GoalActionsMenuProps {
  onAction: (mode: GoalSlackPopoverAction) => void;
  /** Whole menu disabled (usually because no channel is set). */
  allDisabled: boolean;
  allDisabledReason: string | undefined;
  nudgeDisabled: boolean;
  nudgeDisabledReason: NudgeDisabledReason;
}

function GoalActionsMenu({
  onAction,
  allDisabled,
  allDisabledReason,
  nudgeDisabled,
  nudgeDisabledReason,
}: GoalActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const menuId = useId();

  const updatePlacement = () => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    setPlacement({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePlacement();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const nudgeTitle =
    nudgeDisabledReason === "loading"
      ? "Waiting for goal assessment"
      : nudgeDisabledReason === "notReady"
        ? "Goal rollup isn't ready yet"
        : nudgeDisabledReason === "noChannel"
          ? allDisabledReason
          : undefined;

  const itemClass =
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/70 focus:outline-none focus-visible:bg-zinc-800/70 disabled:opacity-40 disabled:hover:bg-transparent";

  const menuPortal =
    open &&
    placement &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[220]"
          aria-hidden
          onClick={() => setOpen(false)}
        />
        <div
          id={menuId}
          role="menu"
          aria-label="Goal actions"
          className="fixed z-[230] w-max min-w-[14rem] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg shadow-black/50"
          style={{ top: placement.top, right: placement.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={allDisabled}
            title={allDisabled ? allDisabledReason : undefined}
            onClick={() => {
              if (allDisabled) return;
              setOpen(false);
              onAction("ping");
            }}
            className={itemClass}
          >
            <MessageCircleQuestion
              className="h-3.5 w-3.5 shrink-0 text-zinc-400"
              aria-hidden
            />
            <span>Ask for update…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={allDisabled || nudgeDisabled}
            title={
              allDisabled ? allDisabledReason : nudgeDisabled ? nudgeTitle : undefined
            }
            onClick={() => {
              if (allDisabled || nudgeDisabled) return;
              setOpen(false);
              onAction("nudge");
            }}
            className={itemClass}
          >
            <AlarmClock
              className="h-3.5 w-3.5 shrink-0 text-zinc-400"
              aria-hidden
            />
            <span>Push on timeline…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={allDisabled}
            title={allDisabled ? allDisabledReason : undefined}
            onClick={() => {
              if (allDisabled) return;
              setOpen(false);
              onAction("reply");
            }}
            className={itemClass}
          >
            <Reply className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
            <span>Draft a custom message…</span>
          </button>
        </div>
      </>,
      document.body
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-600/80 bg-transparent px-2 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/45"
        title="Goal actions"
      >
        Actions
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-zinc-400 transition-transform",
            open ? "rotate-180" : ""
          )}
          aria-hidden
        />
      </button>
      {menuPortal}
    </>
  );
}

function OwnerMiniAvatar({
  owner,
}: {
  owner: { name: string; profilePicturePath: string } | null;
}) {
  if (!owner) {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-500"
        aria-hidden
      >
        ?
      </span>
    );
  }
  if (owner.profilePicturePath.trim()) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={owner.profilePicturePath.trim()}
        alt=""
        className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/80"
      />
    );
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-200 ring-1 ring-zinc-700/80"
      aria-hidden
    >
      {displayInitials(owner.name)}
    </span>
  );
}

/** Background tint for the unscored pill — stays subtle across reason codes. */
function unscoredReasonPillClass(code: GoalSlackPopoverUnscoredReason): string {
  switch (code) {
    case "assessing":
      return "border border-sky-500/35 bg-sky-500/10 text-sky-200/90";
    case "completed":
      return "border border-emerald-500/35 bg-emerald-500/10 text-emerald-200/90";
    case "noMilestones":
    case "noTargetDate":
    case "noSlackThread":
    case "notStarted":
    default:
      return "border border-zinc-600/60 bg-zinc-800/60 text-zinc-300";
  }
}

function ProjectMiniCard({
  row,
  onOpenThread,
}: {
  row: GoalSlackPopoverProjectRow;
  onOpenThread?: (projectId: string) => void;
}) {
  const prog = Math.min(100, Math.max(0, Math.round(row.progressEstimate)));
  const subtitle = row.milestoneName.trim()
    ? `Next: ${row.milestoneName.trim()}`
    : row.reasonCode === "noMilestones"
      ? "No milestones defined yet"
      : row.reasonCode === "completed"
        ? "All milestones complete"
        : "No active milestone";
  const noteBodyClass =
    "whitespace-normal break-words text-[11.5px] font-normal leading-relaxed text-zinc-300";
  const hasNoteBody =
    Boolean(row.blockerNote?.trim()) || Boolean(row.summaryLine.trim());

  /**
   * Whole-card click target: only when there's a Slack thread AND a handler.
   * Unscored/blocked rows without a thread remain non-interactive so users
   * aren't misled into thinking they'll open something.
   */
  const clickable = Boolean(row.slackUrl.trim() && onOpenThread);
  const hoverTitle = clickable
    ? `Open Slack thread preview for ${row.projectName}`
    : undefined;

  const cardContent = (
    <>
      <div className="flex min-w-0 items-start gap-2">
        <OwnerMiniAvatar owner={row.owner} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-snug text-zinc-100">
            {row.projectName}
          </p>
          <p className="truncate text-[10.5px] leading-snug text-zinc-500">
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.scored ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums",
                  likelihoodTextClass(row.riskLevel)
                )}
                title={`On-time likelihood (${row.riskLevel})`}
              >
                <Clock className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
                {row.likelihood}%
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums",
                  progressTextClass(prog)
                )}
                title="Estimated completion"
              >
                <CircleCheck className="h-3 w-3 shrink-0" aria-hidden />
                {prog}%
              </span>
            </>
          ) : row.reasonCode ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight",
                unscoredReasonPillClass(row.reasonCode)
              )}
              title={row.reasonLabel ?? "No assessment yet"}
            >
              {row.reasonCode === "assessing" ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
              ) : null}
              {row.reasonLabel ?? "Not assessed"}
            </span>
          ) : null}
        </div>
      </div>
      {hasNoteBody ? (
        <div className="mt-1.5 min-w-0 space-y-1.5">
          {row.blockerNote?.trim() ? (
            <p className={noteBodyClass}>{row.blockerNote.trim()}</p>
          ) : null}
          {row.summaryLine.trim() ? (
            <p className={noteBodyClass}>
              {truncateSummary(row.summaryLine)}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenThread?.(row.projectId);
        }}
        title={hoverTitle}
        aria-label={hoverTitle}
        className={cn(
          "group/project-mini block w-full rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2.5 text-left transition-colors",
          "hover:border-zinc-700 hover:bg-zinc-900",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/45",
          "cursor-pointer"
        )}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2.5">
      {cardContent}
    </div>
  );
}

export function GoalSlackPopover({
  open,
  onClose,
  anchorRef,
  spotlightRef,
  goalDescription,
  goalSlackChannelName,
  goalSlackChannelId,
  rollup,
  rollupLoading,
  oneLinerSummary,
  oneLinerLoading,
  oneLinerError,
  projectRows,
  owners,
  onOpenChannelMessage,
  onOpenProjectSlackThread,
}: GoalSlackPopoverProps) {
  const popoverId = useId();
  const [geometry, setGeometry] = useState<PopoverGeometry | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setGeometry(null);
      return;
    }
    const el = anchorRef.current;
    if (!el || typeof window === "undefined") return;
    setGeometry(
      measurePopoverGeometry(
        el,
        spotlightRef?.current ?? null,
        window.innerWidth,
        window.innerHeight
      )
    );
  }, [open, anchorRef, spotlightRef]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => {
      const el = anchorRef.current;
      if (!el || typeof window === "undefined") return;
      setGeometry(
        measurePopoverGeometry(
          el,
          spotlightRef?.current ?? null,
          window.innerWidth,
          window.innerHeight
        )
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, spotlightRef, onClose]);

  const sortedRows = useMemo(() => {
    const copy = projectRows.slice();
    copy.sort((a, b) => {
      if (a.scored !== b.scored) return a.scored ? -1 : 1;
      if (a.scored && b.scored) {
        const r = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
        if (r !== 0) return r;
        const l = a.likelihood - b.likelihood;
        if (l !== 0) return l;
        return a.projectName.localeCompare(b.projectName);
      }
      const ac = a.reasonCode;
      const bc = b.reasonCode;
      if (ac && bc && ac !== bc) {
        return UNSCORED_ORDER[ac] - UNSCORED_ORDER[bc];
      }
      return a.projectName.localeCompare(b.projectName);
    });
    return copy;
  }, [projectRows]);

  /** Two most impactful projects — scored only; used as the "Reasoning" call-outs. */
  const topRisks = sortedRows
    .filter(
      (r) =>
        r.scored &&
        (r.riskLevel === "high" ||
          r.riskLevel === "critical" ||
          r.likelihood < 70)
    )
    .slice(0, 2);

  const hasChannel = Boolean(goalSlackChannelId.trim());
  const actionsDisabledReason = hasChannel
    ? undefined
    : "Set a Slack channel on this goal first.";

  /** Nudge needs a ready rollup so AI has signals to cite. */
  const rollupReady = Boolean(rollup?.ready);
  const nudgeDisabled = !rollupReady;
  const nudgeDisabledReason: NudgeDisabledReason = !hasChannel
    ? "noChannel"
    : rollupLoading && !rollupReady
      ? "loading"
      : !rollupReady
        ? "notReady"
        : null;

  if (!open || !geometry) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <SlackThreadSpotlightBackdrop
        hole={geometry.spotlight.hole}
        winW={geometry.spotlight.vw}
        winH={geometry.spotlight.vh}
        onDismiss={onClose}
      />
      <div
        id={popoverId}
        role="dialog"
        aria-label="Goal delivery outlook"
        className="fixed z-[210] flex w-[min(55rem,calc(100vw-1.5rem))] min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/40"
        style={{
          top: geometry.placement.top,
          right: geometry.placement.right,
          maxHeight: geometry.placement.maxHeightPx,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-4 pt-3.5 pb-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <SlackLogo className="h-3.5 w-3.5 shrink-0 opacity-95" />
                <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">
                  Goal delivery
                </p>
                {goalSlackChannelName.trim() ? (
                  <span className="truncate text-[11px] font-medium text-zinc-400">
                    #{goalSlackChannelName.trim().replace(/^#/, "")}
                  </span>
                ) : null}
              </div>
              <p
                className="mt-0.5 truncate text-[11px] text-zinc-500"
                title={goalDescription}
              >
                {goalDescription || "(untitled goal)"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800/90 lg:flex-row lg:items-stretch">
          {/* Left: goal stats + AI summary + reasoning */}
          <aside className="flex min-h-0 flex-col border-zinc-800/90 lg:h-full lg:w-[min(26rem,46%)] lg:shrink-0 lg:border-r lg:border-zinc-800/90">
            <div className="max-h-[min(42vh,22rem)] space-y-3 overflow-y-auto px-5 py-4 lg:max-h-none lg:min-h-0 lg:flex-1">
              {rollupLoading && !rollup ? (
                <p className="text-[11px] text-zinc-500">
                  Rolling up project signals…
                </p>
              ) : rollup?.ready ? (
                <>
                  <div className="rounded-lg bg-zinc-800/40 px-4 py-3.5">
                    <div className="flex items-baseline gap-2">
                      <p
                        className={cn(
                          "text-3xl font-bold tabular-nums leading-none tracking-tight",
                          likelihoodTextClass(rollup.riskLevel)
                        )}
                      >
                        {rollup.onTimeLikelihood}%
                      </p>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        On-time estimate
                      </p>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                          AI confidence
                        </p>
                        <p className="text-[11px] font-semibold tabular-nums text-zinc-300">
                          {rollup.aiConfidence}%
                        </p>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/70">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width]",
                            rollup.aiConfidence >= 85
                              ? "bg-emerald-400/80"
                              : rollup.aiConfidence >= 50
                                ? "bg-sky-400/80"
                                : "bg-zinc-400/70"
                          )}
                          style={{ width: `${rollup.aiConfidence}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-700/50 pt-3 text-[11px] text-zinc-400">
                      <span
                        className="inline-flex items-center gap-1.5"
                        title="Number of projects included in the rollup"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-zinc-500"
                          aria-hidden
                        />
                        <span className="tabular-nums">
                          {rollup.coverage.cached}/{rollup.coverage.total}{" "}
                          project{rollup.coverage.total === 1 ? "" : "s"} scored
                        </span>
                      </span>
                      {owners.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-zinc-500"
                            aria-hidden
                          />
                          <span className="tabular-nums">
                            {owners.length} owner
                            {owners.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {oneLinerSummary?.trim() ||
                  oneLinerLoading ||
                  oneLinerError ? (
                    <div>
                      <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        Summary
                      </p>
                      {oneLinerLoading && !oneLinerSummary ? (
                        <p className="text-[11px] text-zinc-500">
                          Summarizing goal…
                        </p>
                      ) : oneLinerSummary?.trim() ? (
                        <p className="text-[11px] font-normal leading-relaxed text-zinc-300">
                          {oneLinerSummary.trim()}
                        </p>
                      ) : oneLinerError ? (
                        <p className="text-[11px] text-red-400/90">
                          {oneLinerError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {topRisks.length > 0 ? (
                    <div>
                      <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        Reasoning
                      </p>
                      <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                        {topRisks.map((r) => (
                          <li
                            key={r.projectId}
                            className="flex min-w-0 items-start gap-2"
                          >
                            <span
                              className={cn(
                                "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                                r.riskLevel === "critical"
                                  ? "bg-red-400"
                                  : r.riskLevel === "high"
                                    ? "bg-orange-400"
                                    : r.riskLevel === "medium"
                                      ? "bg-amber-300"
                                      : "bg-emerald-400"
                              )}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold text-zinc-200">
                                {r.projectName}
                              </span>
                              <span className="text-zinc-500">
                                {" "}
                                · {r.likelihood}% on-time
                              </span>
                              {r.summaryLine.trim() ? (
                                <>
                                  <span className="text-zinc-600"> — </span>
                                  <span className="text-zinc-400">
                                    {truncateSummary(r.summaryLine, 160)}
                                  </span>
                                </>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  No dated, Slack-linked next milestone on any project in this
                  goal.
                </p>
              )}
            </div>
          </aside>

          {/* Right: per-project drill-down (worst-first). */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t border-zinc-800/90 bg-zinc-950/60 px-3 py-3 lg:border-t-0 lg:pl-3 lg:pr-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Projects{" "}
                {sortedRows.length > 0 ? (
                  <span className="text-zinc-600">
                    · {sortedRows.length}
                  </span>
                ) : null}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <GoalActionsMenu
                  onAction={(m) => {
                    onClose();
                    onOpenChannelMessage(m);
                  }}
                  allDisabled={!hasChannel}
                  allDisabledReason={actionsDisabledReason}
                  nudgeDisabled={nudgeDisabled}
                  nudgeDisabledReason={nudgeDisabledReason}
                />
              </div>
            </div>
            {sortedRows.length > 0 ? (
              <div className="space-y-2">
                {sortedRows.map((r) => (
                  <ProjectMiniCard
                    key={r.projectId}
                    row={r}
                    onOpenThread={
                      onOpenProjectSlackThread
                        ? (pid) => {
                            onClose();
                            onOpenProjectSlackThread(pid);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 py-6 text-center text-[11.5px] text-zinc-500">
                No project signals yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
