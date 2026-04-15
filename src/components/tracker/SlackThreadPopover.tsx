"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import {
  type SlackMemberRosterHint,
  type MilestoneLikelihoodRiskLevel,
} from "@/server/actions/slack";
import type { SlackThreadStatusOk } from "@/lib/slackThreadStatusCache";
import { displayInitials } from "@/lib/displayInitials";
import { formatRelativeCalendarDate } from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";
import { SlackLogo } from "./SlackLogo";

interface SlackThreadPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  slackUrl: string;
  milestoneName: string;
  status: SlackThreadStatusOk | null;
  rosterHints?: SlackMemberRosterHint[];
  onRefreshStatus: () => void;
  onOpenPing: () => void;
  onOpenNudge: () => void;
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

function nudgeButtonAccent(level: MilestoneLikelihoodRiskLevel | null): string {
  if (!level || level === "low")
    return "border-amber-600/45 bg-amber-950/35 text-amber-100 hover:bg-amber-900/45";
  if (level === "medium")
    return "border-orange-600/50 bg-orange-950/40 text-orange-100 hover:bg-orange-900/50";
  return "border-red-600/55 bg-red-950/45 text-red-100 hover:bg-red-900/55";
}

function computePlacement(
  el: HTMLElement,
  winW: number,
  winH: number
): { top: number; right: number } {
  const rect = el.getBoundingClientRect();
  const panelW = Math.min(880, winW - 24);
  const rightEdge = winW - rect.right;
  const clampedRight = Math.min(
    Math.max(8, rightEdge),
    winW - panelW - 8
  );

  const gap = 6;
  const margin = 8;
  // Upper bound for “would this overflow?” — matches max-h ~ min(84vh, 44rem)
  const maxPanelH = Math.min(winH * 0.84, 44 * 16);

  let top = rect.bottom + gap;
  // Prefer below the anchor; if the panel would extend past the viewport, try above.
  if (top + maxPanelH > winH - margin) {
    const above = rect.top - gap - maxPanelH;
    if (above >= margin) {
      top = above;
    }
  }

  return {
    top,
    right: clampedRight,
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

/** Slack-like @mention pill — up to @First Last before message body. */
const MENTION_PREVIEW_RE =
  /@(?:[^\s@]+(?:\s+[A-Za-z][a-z]+)?)(?=\s|$|[.,!?;:\u2014\u2013\-])/g;

function slackPreviewMentionParts(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  MENTION_PREVIEW_RE.lastIndex = 0;
  while ((m = MENTION_PREVIEW_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span
        key={`m-${k++}`}
        className="mx-0.5 inline-block rounded-[3px] bg-[#3d1f00]/85 px-1 py-px align-baseline text-[13px] font-medium text-[#fbe6a2]"
      >
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
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
            className="mx-0.5 inline rounded bg-black/40 px-1 py-0.5 font-mono text-[12px] text-[#e8912d]"
          >
            {p.value}
          </code>
        ) : (
          <span key={i}>{slackPreviewMentionParts(p.value)}</span>
        )
      )}
    </>
  );
}

export function SlackThreadPopover({
  open,
  onClose,
  anchorRef,
  slackUrl,
  milestoneName,
  status,
  rosterHints = [],
  onRefreshStatus,
  onOpenPing,
  onOpenNudge,
  targetDate,
  ownerName,
  ownerAutonomy,
  projectComplexity,
  likelihood,
  likelihoodLoading,
  likelihoodError,
}: SlackThreadPopoverProps) {
  const popoverId = useId();
  const [placement, setPlacement] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const targetTrim = targetDate.trim();
  const showDeadlineBlock = Boolean(targetTrim);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const el = anchorRef.current;
    if (!el || typeof window === "undefined") return;
    setPlacement(computePlacement(el, window.innerWidth, window.innerHeight));
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    onRefreshStatus();
  }, [open, onRefreshStatus]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => {
      const el = anchorRef.current;
      if (!el || typeof window === "undefined") return;
      setPlacement(
        computePlacement(el, window.innerWidth, window.innerHeight)
      );
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, anchorRef]);

  const portal =
    open &&
    placement &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[200]"
          aria-hidden
          onClick={() => onClose()}
        />
        <div
          id={popoverId}
          role="dialog"
          aria-label="Slack thread"
          className="fixed z-[210] flex max-h-[min(84vh,44rem)] w-[min(55rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/40"
          style={{ top: placement.top, right: placement.right }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 px-4 pt-3.5 pb-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <SlackLogo className="h-3.5 w-3.5 opacity-95" />
                <p className="text-[13px] font-semibold tracking-tight text-zinc-100">
                  Slack thread
                </p>
              </div>
              <a
                href={slackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
                title="Open in Slack"
              >
                Open <ExternalLink className="h-2.5 w-2.5" aria-hidden />
              </a>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {milestoneName}
              {status ? (
                <>
                  {" · "}
                  {status.replyCount} msg{status.replyCount === 1 ? "" : "s"}
                  {" · "}
                  {status.lastReplyRelative}
                  {status.isStale ? (
                    <span className="text-amber-400/95"> · Quiet 24h+</span>
                  ) : null}
                </>
              ) : null}
            </p>
            {likelihood?.threadSummaryLine ? (
              <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                <span className="font-semibold text-zinc-300">Summary:</span>{" "}
                {likelihood.threadSummaryLine}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800/90 lg:flex-row lg:items-stretch">
            {/* Left: deadline stats, reasoning; actions pinned at bottom */}
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
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-zinc-800/40 px-2 py-2.5 text-center">
                          <p
                            className={cn(
                              "text-2xl font-bold tabular-nums leading-none tracking-tight",
                              riskLabelClass(likelihood.riskLevel)
                            )}
                          >
                            {likelihood.likelihood}%
                          </p>
                          <p className="mt-2 text-[9px] font-medium leading-tight text-zinc-500">
                            On-time estimate
                          </p>
                        </div>
                        <div className="rounded-lg bg-zinc-800/40 px-2 py-2.5 text-center">
                          <p className="text-2xl font-bold tabular-nums leading-none tracking-tight text-zinc-100">
                            {Math.min(
                              100,
                              Math.max(0, Math.round(likelihood.progressEstimate))
                            )}
                            %
                          </p>
                          <p className="mt-2 text-[9px] font-medium leading-tight text-zinc-500">
                            Completed so far
                          </p>
                        </div>
                        <div
                          className={cn(
                            "rounded-lg bg-zinc-800/40 px-2 py-2.5 text-center",
                            likelihood.daysRemaining < 0
                              ? "text-red-300/95"
                              : ""
                          )}
                        >
                          <p
                            className={cn(
                              "text-2xl font-bold tabular-nums leading-none tracking-tight",
                              likelihood.daysRemaining < 0
                                ? "text-red-300/95"
                                : "text-zinc-100"
                            )}
                          >
                            {likelihood.daysRemaining >= 0
                              ? `${likelihood.daysRemaining}d`
                              : `${Math.abs(likelihood.daysRemaining)}d`}
                          </p>
                          <p
                            className={cn(
                              "mt-2 text-[9px] font-medium leading-tight",
                              likelihood.daysRemaining < 0
                                ? "text-red-400/80"
                                : "text-zinc-500"
                            )}
                          >
                            {likelihood.daysRemaining >= 0
                              ? "Time left"
                              : "Overdue"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                          Reasoning
                        </p>
                        <p className="text-[11px] leading-snug text-zinc-400">
                          {truncateReasoning(likelihood.reasoning)}
                        </p>
                      </div>
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

              <div className="flex shrink-0 flex-col gap-2 border-t border-zinc-800/90 px-5 py-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPing();
                  }}
                  className="w-full rounded-md border border-violet-600/50 bg-violet-950/40 px-2 py-1.5 text-[11px] font-medium text-violet-200 hover:bg-violet-900/50"
                >
                  Ask for update…
                </button>
                {showDeadlineBlock ? (
                  <button
                    type="button"
                    disabled={
                      likelihoodLoading ||
                      !likelihood ||
                      Boolean(likelihoodError)
                    }
                    title={
                      !likelihood && !likelihoodLoading && !likelihoodError
                        ? "Waiting for deadline assessment"
                        : likelihoodError
                          ? "Assessment error"
                          : undefined
                    }
                    onClick={() => {
                      onClose();
                      onOpenNudge();
                    }}
                    className={cn(
                      "w-full rounded-md border px-2 py-1.5 text-[11px] font-medium disabled:opacity-40",
                      nudgeButtonAccent(likelihood?.riskLevel ?? null)
                    )}
                  >
                    Nudge on deadline…
                  </button>
                ) : null}
              </div>
            </aside>

            {/* Right: Slack messages */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t border-zinc-800/90 px-4 py-3 lg:border-t-0 lg:pl-4">
              {status && status.recentMessages.length > 0 ? (
                <div className="space-y-2">
                  {status.recentMessages.map((m, i) => (
                    <div
                      key={`${m.slackUserId ?? m.userLabel}-${i}`}
                      className="flex gap-3 rounded-md border border-zinc-800/60 bg-[#1a1d21]/85 px-3 py-2"
                    >
                      {m.avatarSrc ? (
                        <img
                          src={m.avatarSrc}
                          alt=""
                          className="mt-0.5 h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-zinc-700/70"
                        />
                      ) : (
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-[11px] font-semibold text-zinc-300 ring-1 ring-zinc-700/70"
                          aria-hidden
                        >
                          {displayInitials(m.userLabel)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[15px] font-bold leading-tight text-zinc-100">
                            {m.userLabel}
                          </span>
                          {m.postedRelative ? (
                            <span className="text-[12px] font-normal text-zinc-500">
                              {m.postedRelative}
                            </span>
                          ) : null}
                        </div>
                        {m.text?.trim() ? (
                          <div className="mt-1 max-h-[min(16rem,38vh)] overflow-y-auto overscroll-contain rounded-sm pr-0.5 text-[13px] leading-[1.466] text-[#d1d2d3] [scrollbar-gutter:stable]">
                            <div className="whitespace-pre-wrap break-words">
                              <SlackThreadMessageBody text={m.text} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-zinc-500">
                  No recent messages loaded yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </>,
      document.body
    );

  return <>{portal}</>;
}
