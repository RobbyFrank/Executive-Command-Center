"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  ChevronDown,
  ExternalLink,
  MessageCircleQuestion,
  Reply,
  X,
} from "lucide-react";
import {
  type SlackMemberRosterHint,
  type MilestoneLikelihoodRiskLevel,
} from "@/server/actions/slack";
import type { SlackThreadStatusOk } from "@/lib/slackThreadStatusCache";
import { displayInitials } from "@/lib/displayInitials";
import {
  calendarDaysFromTodayYmd,
  formatRelativeCalendarDate,
} from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";
import { SlackLogo } from "./SlackLogo";
import {
  SlackThreadSpotlightBackdrop,
  readSpotlightHole,
  type SlackThreadSpotlightHole,
} from "./SlackThreadSpotlightBackdrop";

export type { SlackThreadSpotlightHole } from "./SlackThreadSpotlightBackdrop";

interface SlackThreadPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * Row/container to leave undimmed (spotlight). Omit to use the Slack control (`anchorRef`) only.
   */
  spotlightRef?: RefObject<HTMLElement | null>;
  slackUrl: string;
  milestoneName: string;
  status: SlackThreadStatusOk | null;
  rosterHints?: SlackMemberRosterHint[];
  onRefreshStatus: () => void;
  onOpenPing: () => void;
  onOpenNudge: () => void;
  onOpenReply: () => void;
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

function riskLabelClass(level: MilestoneLikelihoodRiskLevel): string {
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
  /** Tallest panel we can draw without crossing top/bottom viewport margins. */
  const maxFitH = Math.min(cssMaxH, winH - 2 * margin);

  const idealBelow = rect.bottom + gap;

  let top: number;
  // Prefer below the anchor; if the full panel would clip at the bottom, try above.
  if (idealBelow + maxFitH <= winH - margin) {
    top = idealBelow;
  } else {
    const idealAbove = rect.top - gap - maxFitH;
    if (idealAbove >= margin) {
      top = idealAbove;
    } else {
      // Neither side fits the ideal height: pin the panel so its bottom stays in view.
      top = Math.max(margin, winH - margin - maxFitH);
    }
  }

  // Never extend past the bottom safe inset (handles short viewports and rounding).
  const maxHeightPx = Math.min(cssMaxH, Math.max(0, winH - top - margin));

  return {
    top,
    right: clampedRight,
    maxHeightPx,
  };
}

type SlackThreadPopoverGeometry = {
  placement: { top: number; right: number; maxHeightPx: number };
  spotlight: { hole: SlackThreadSpotlightHole; vw: number; vh: number };
};

function measurePopoverGeometry(
  anchorEl: HTMLElement,
  spotlightEl: HTMLElement | null,
  winW: number,
  winH: number
): SlackThreadPopoverGeometry {
  const hole = readSpotlightHole(spotlightEl, anchorEl);
  return {
    placement: computePlacement(anchorEl, winW, winH),
    spotlight: {
      hole: hole!,
      vw: winW,
      vh: winH,
    },
  };
}

const REASONING_MAX = 140;

function truncateReasoning(s: string): string {
  const t = s.trim();
  if (t.length <= REASONING_MAX) return t;
  const cut = t.lastIndexOf(" ", REASONING_MAX);
  return `${t.slice(0, cut > 60 ? cut : REASONING_MAX)}…`;
}

type SlackInlinePiece = { kind: "text" | "code"; value: string };

/** Split on single backtick pairs (Slack inline code); unclosed ` stays as text. */
function splitSlackInlineCode(s: string): SlackInlinePiece[] {
  const out: SlackInlinePiece[] = [];
  let i = 0;
  while (i < s.length) {
    const tick = s.indexOf("`", i);
    if (tick === -1) {
      if (i < s.length) out.push({ kind: "text", value: s.slice(i) });
      break;
    }
    if (tick > i) out.push({ kind: "text", value: s.slice(i, tick) });
    const end = s.indexOf("`", tick + 1);
    if (end === -1) {
      out.push({ kind: "text", value: s.slice(tick) });
      break;
    }
    out.push({ kind: "code", value: s.slice(tick + 1, end) });
    i = end + 1;
  }
  return out;
}

/** Slack-like @mention — up to @First Last; avoids `@word` inside emails/URLs. */
const MENTION_PREVIEW_RE =
  /@(?:[^\s@]+(?:\s+[A-Za-z][a-z]+)?)(?=\s|$|[.,!?;:\u2014\u2013\-])/g;

/** Channel/hash refs like #engineering (not #5 — must start with a letter after #). */
const CHANNEL_PREVIEW_RE = /#[A-Za-z][\w-]*/g;

/** Slack dark theme: user/channel mention (approx. `.c-mrkdwn__mention`). Sized for thread preview body (`text-[11px]`). */
const SLACK_MENTION_CLASS =
  "mx-0.5 inline-block rounded-[3px] bg-[rgba(29,155,209,0.14)] px-[3px] py-px align-baseline text-[11px] font-semibold leading-relaxed text-[#1d9bd1]";

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>`]+/g;

function slackPreviewChannelParts(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  CHANNEL_PREVIEW_RE.lastIndex = 0;
  while ((m = CHANNEL_PREVIEW_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span key={`ch-${k++}`} className={SLACK_MENTION_CLASS}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

function slackPreviewMentionParts(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  MENTION_PREVIEW_RE.lastIndex = 0;
  while ((m = MENTION_PREVIEW_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(...slackPreviewChannelParts(text.slice(last, m.index)));
    nodes.push(
      <span key={`m-${k++}`} className={SLACK_MENTION_CLASS}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...slackPreviewChannelParts(text.slice(last)));
  return nodes.length ? nodes : [text];
}

function slackPreviewUrlsAndMentions(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  URL_IN_TEXT_RE.lastIndex = 0;
  while ((m = URL_IN_TEXT_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(...slackPreviewMentionParts(text.slice(last, m.index)));
    const href = m[0].replace(/[),.;]+$/g, "");
    const trailing = m[0].slice(href.length);
    nodes.push(
      <a
        key={`u-${k++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words text-[#1d9bd1] underline decoration-[#1d9bd1]/80 underline-offset-2 hover:text-[#56b8e6]"
      >
        {href}
      </a>
    );
    if (trailing) nodes.push(trailing);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...slackPreviewMentionParts(text.slice(last)));
  return nodes.length ? nodes : [text];
}

function SlackThreadMessageBody({ text }: { text: string }): ReactNode {
  const pieces = splitSlackInlineCode(text);
  return (
    <>
      {pieces.map((p, i) =>
        p.kind === "code" ? (
          <code
            key={i}
            className="mx-0.5 inline rounded-[3px] bg-[#1b1d21] px-1 py-px font-mono text-[11px] leading-snug text-[#e8912d] ring-1 ring-white/10"
          >
            {p.value}
          </code>
        ) : (
          <span key={i}>{slackPreviewUrlsAndMentions(p.value)}</span>
        )
      )}
    </>
  );
}

type NudgeDisabledReason = "loading" | "noAssessment" | "error" | null;

interface SlackThreadActionsMenuProps {
  onReply: () => void;
  onAsk: () => void;
  onNudge: () => void;
  showNudge: boolean;
  nudgeDisabled: boolean;
  nudgeDisabledReason: NudgeDisabledReason;
}

function SlackThreadActionsMenu({
  onReply,
  onAsk,
  onNudge,
  showNudge,
  nudgeDisabled,
  nudgeDisabledReason,
}: SlackThreadActionsMenuProps) {
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
      ? "Waiting for deadline assessment"
      : nudgeDisabledReason === "noAssessment"
        ? "Waiting for deadline assessment"
        : nudgeDisabledReason === "error"
          ? "Assessment error"
          : undefined;

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
          aria-label="Thread actions"
          className="fixed z-[230] w-max min-w-[12rem] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg shadow-black/50"
          style={{ top: placement.top, right: placement.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onReply();
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/70 focus:outline-none focus-visible:bg-zinc-800/70"
          >
            <Reply className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
            <span>Reply…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAsk();
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/70 focus:outline-none focus-visible:bg-zinc-800/70"
          >
            <MessageCircleQuestion
              className="h-3.5 w-3.5 shrink-0 text-zinc-400"
              aria-hidden
            />
            <span>Ask for update…</span>
          </button>
          {showNudge ? (
            <button
              type="button"
              role="menuitem"
              disabled={nudgeDisabled}
              title={nudgeTitle}
              onClick={() => {
                setOpen(false);
                onNudge();
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/70 focus:outline-none focus-visible:bg-zinc-800/70 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <AlarmClock
                className="h-3.5 w-3.5 shrink-0 text-zinc-400"
                aria-hidden
              />
              <span>Nudge on deadline…</span>
            </button>
          ) : null}
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
        title="Thread actions"
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

export function SlackThreadPopover({
  open,
  onClose,
  anchorRef,
  spotlightRef,
  slackUrl,
  milestoneName,
  status,
  rosterHints = [],
  onRefreshStatus,
  onOpenPing,
  onOpenNudge,
  onOpenReply,
  targetDate,
  ownerName,
  ownerAutonomy,
  projectComplexity,
  likelihood,
  likelihoodLoading,
  likelihoodError,
}: SlackThreadPopoverProps) {
  const popoverId = useId();
  const [geometry, setGeometry] = useState<SlackThreadPopoverGeometry | null>(
    null
  );
  const targetTrim = targetDate.trim();
  const showDeadlineBlock = Boolean(targetTrim);
  /** Live calendar-day diff vs cached AI `daysRemaining` (avoids stale "0d" after deadline). */
  const dayDiffFromTarget = useMemo(
    () => calendarDaysFromTodayYmd(targetTrim),
    [targetTrim]
  );

  const deadlineDayDiff = useMemo(() => {
    if (!likelihood) return null;
    return dayDiffFromTarget !== null
      ? dayDiffFromTarget
      : likelihood.daysRemaining;
  }, [likelihood, dayDiffFromTarget]);

  /** Calendar days until target: live from `targetDate`, not only cached AI `daysRemaining`. */
  const calendarDaysToDue = likelihood
    ? (deadlineDayDiff ?? likelihood.daysRemaining)
    : null;

  /** Parents often pass inline `() => refresh()`; must not be an effect dep or every re-render re-fetches. */
  const onRefreshStatusRef = useRef(onRefreshStatus);
  onRefreshStatusRef.current = onRefreshStatus;

  useLayoutEffect(() => {
    if (!open) {
      setGeometry(null);
      return;
    }
    const el = anchorRef.current;
    if (!el || typeof window === "undefined") return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    setGeometry(
      measurePopoverGeometry(el, spotlightRef?.current ?? null, winW, winH)
    );
  }, [open, anchorRef, spotlightRef]);

  /** Refresh once when the dialog opens — not on every parent render while it stays open. */
  useEffect(() => {
    if (!open) return;
    onRefreshStatusRef.current();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => {
      const el = anchorRef.current;
      if (!el || typeof window === "undefined") return;
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      setGeometry(
        measurePopoverGeometry(el, spotlightRef?.current ?? null, winW, winH)
      );
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, anchorRef, spotlightRef]);

  const portal =
    open &&
    geometry &&
    typeof document !== "undefined" &&
    createPortal(
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
          aria-label="Slack thread"
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
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <SlackLogo className="h-3.5 w-3.5 shrink-0 opacity-95" />
                    <p className="text-[13px] font-semibold tracking-tight text-zinc-100">
                      Slack thread
                    </p>
                  </div>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {milestoneName}
                  {status ? (
                    <>
                      {" · "}
                      {status.replyCount} msg{status.replyCount === 1 ? "" : "s"}
                    </>
                  ) : null}
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
            {/* Left: deadline stats + AI reasoning (read-only; actions live in the right panel Actions menu). */}
            <aside className="flex min-h-0 flex-col border-zinc-800/90 lg:h-full lg:w-[min(26rem,46%)] lg:shrink-0 lg:border-r lg:border-zinc-800/90">
              <div className="max-h-[min(42vh,20rem)] space-y-3 overflow-y-auto px-5 py-4 lg:max-h-none lg:min-h-0 lg:flex-1">
              {showDeadlineBlock ? (
                <div>
                  {likelihoodLoading ? (
                    <p className="text-[11px] text-zinc-500">
                      Analyzing deadline risk…
                    </p>
                  ) : likelihoodError ? (
                    <p className="text-[11px] text-red-400/90">
                      {likelihoodError}
                    </p>
                  ) : likelihood ? (
                    <div className="min-w-0">
                      {(() => {
                        const progressPct = Math.min(
                          100,
                          Math.max(0, Math.round(likelihood.progressEstimate))
                        );
                        const overdue =
                          calendarDaysToDue != null && calendarDaysToDue < 0;
                        const dueToday = calendarDaysToDue === 0;
                        const daysLabel = overdue
                          ? `${Math.abs(calendarDaysToDue!)}d overdue`
                          : dueToday
                            ? "Due today"
                            : calendarDaysToDue != null
                              ? `${calendarDaysToDue}d left`
                              : "No target date";
                        return (
                          <div className="rounded-lg bg-zinc-800/40 px-4 py-3.5">
                            <div className="flex items-baseline gap-2">
                              <p
                                className={cn(
                                  "text-3xl font-bold tabular-nums leading-none tracking-tight",
                                  riskLabelClass(likelihood.riskLevel)
                                )}
                              >
                                {likelihood.likelihood}%
                              </p>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                                On-time estimate
                              </p>
                            </div>
                            <div className="mt-3">
                              <div className="flex items-baseline justify-between gap-2">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                                  Completed
                                </p>
                                <p className="text-[11px] font-semibold tabular-nums text-zinc-300">
                                  {progressPct}%
                                </p>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/70">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-[width]",
                                    progressPct >= 85
                                      ? "bg-emerald-400/80"
                                      : progressPct >= 50
                                        ? "bg-sky-400/80"
                                        : "bg-zinc-400/70"
                                  )}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-700/50 pt-3 text-[11px] text-zinc-400">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5",
                                  overdue ? "text-red-300/95" : ""
                                )}
                                title={
                                  overdue
                                    ? `${Math.abs(calendarDaysToDue!)} calendar ${
                                        Math.abs(calendarDaysToDue!) === 1
                                          ? "day"
                                          : "days"
                                      } past the target date`
                                    : undefined
                                }
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    overdue
                                      ? "bg-red-400"
                                      : dueToday
                                        ? "bg-amber-400"
                                        : "bg-zinc-500"
                                  )}
                                  aria-hidden
                                />
                                <span className="tabular-nums">
                                  {daysLabel}
                                </span>
                              </span>
                              {status?.lastReplyRelative ? (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5",
                                    status.isStale ? "text-amber-200/90" : ""
                                  )}
                                  title={
                                    status.isStale
                                      ? "No thread replies in the last 24 hours"
                                      : "Time of the latest reply in this thread"
                                  }
                                >
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full",
                                      status.isStale
                                        ? "bg-amber-400"
                                        : "bg-zinc-500"
                                    )}
                                    aria-hidden
                                  />
                                  <span className="tabular-nums">
                                    Last reply {status.lastReplyRelative}
                                  </span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })()}
                      {likelihood.threadSummaryLine?.trim() ||
                      likelihood.reasoning?.trim() ? (
                        <div className="mt-4 space-y-3">
                          {likelihood.threadSummaryLine?.trim() ? (
                            <div>
                              <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                                Status
                              </p>
                              <p className="text-[11px] font-normal leading-relaxed text-zinc-300">
                                {likelihood.threadSummaryLine.trim()}
                              </p>
                            </div>
                          ) : null}
                          {likelihood.reasoning?.trim() ? (
                            <div>
                              <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                                Reasoning
                              </p>
                              <p className="text-[11px] font-normal leading-relaxed text-zinc-300">
                                {truncateReasoning(likelihood.reasoning)}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">
                      Due {formatRelativeCalendarDate(targetTrim)} · Assessment
                      pending
                    </p>
                  )}
                </div>
              ) : null}
              </div>

            </aside>

            {/* Right: Slack messages — header row stays visible; list scrolls independently. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-zinc-800/90 bg-[#1a1d21] lg:border-t-0">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 bg-[#1a1d21] px-3 pt-3 pb-2.5 lg:px-4">
                <p className="min-w-0 flex-1 text-[11px] font-semibold leading-snug text-[#9b9b9b]">
                  {status && status.recentMessages.length > 0
                    ? `Last ${status.recentMessages.length} ${
                        status.recentMessages.length === 1 ? "reply" : "replies"
                      }`
                    : "\u00a0"}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <SlackThreadActionsMenu
                    onReply={() => {
                      onClose();
                      onOpenReply();
                    }}
                    onAsk={() => {
                      onClose();
                      onOpenPing();
                    }}
                    onNudge={() => {
                      onClose();
                      onOpenNudge();
                    }}
                    showNudge={showDeadlineBlock}
                    nudgeDisabled={
                      likelihoodLoading ||
                      !likelihood ||
                      Boolean(likelihoodError)
                    }
                    nudgeDisabledReason={
                      likelihoodLoading
                        ? "loading"
                        : likelihoodError
                          ? "error"
                          : !likelihood
                            ? "noAssessment"
                            : null
                    }
                  />
                  <a
                    href={slackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/45"
                    title="View in Slack"
                    aria-label="Open this thread in Slack"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2 lg:px-4">
                {status && status.recentMessages.length > 0 ? (
                  <div className="space-y-3.5">
                    {status.recentMessages.map((m, i) => (
                      <div
                        key={`${m.slackUserId ?? m.userLabel}-${i}`}
                        className="flex gap-2"
                      >
                        {m.avatarSrc ? (
                          <img
                            src={m.avatarSrc}
                            alt=""
                            className="mt-0.5 h-7 w-7 shrink-0 rounded-[3px] object-cover"
                          />
                        ) : (
                          <div
                            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] bg-[#363636] text-[10px] font-bold text-[#e0e0e0]"
                            aria-hidden
                          >
                            {displayInitials(m.userLabel)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1 pt-px">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-[11px] font-bold leading-tight text-[#f8f8f8]">
                              {m.userLabel}
                            </span>
                            {m.postedRelative ? (
                              <span className="text-[11px] font-normal text-[#ababab]">
                                {m.postedRelative}
                              </span>
                            ) : null}
                          </div>
                          {m.text?.trim() ? (
                            <div className="mt-0.5 text-[11px] leading-relaxed text-[#e8e8e8]">
                              <div className="whitespace-pre-wrap break-words [word-break:break-word]">
                                <SlackThreadMessageBody text={m.text} />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#9b9b9b]">
                    No recent messages loaded yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </>,
      document.body
    );

  return <>{portal}</>;
}
