"use client";

import { forwardRef } from "react";
import { CircleCheck, Clock, Loader2 } from "lucide-react";
import type { MilestoneLikelihoodRiskLevel } from "@/server/actions/slack";
import { displayInitials } from "@/lib/displayInitials";
import {
  formatShortRelativeSince,
  type SlackThreadFreshnessSignal,
} from "@/lib/slackThreadFreshness";
import { cn } from "@/lib/utils";

/**
 * Safety cap; CSS `truncate` still clips via ellipsis when the row is narrower than the full string.
 * Tuned to match {@link MilestoneSlackThreadInline} (`BODY_PREVIEW_MAX_CHARS`) so goal summaries use
 * comparable horizontal space to the Slack thread body text on expanded milestone rows.
 */
const SUMMARY_MAX_CHARS = 260;

/** Reserve width ≥ two digits + % — matches {@link MilestoneSlackThreadInline}. */
const PERCENT_SPAN_CLASS =
  "inline-block min-w-[4.5ch] text-start tabular-nums font-semibold";

function truncateSummary(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

function likelihoodTextClass(level: MilestoneLikelihoodRiskLevel): string {
  switch (level) {
    case "low":
      return "text-emerald-400/95";
    case "medium":
      return "text-amber-300/95";
    case "high":
      return "text-orange-400/95";
    case "critical":
      return "text-red-400/95";
    default:
      return "text-zinc-400";
  }
}

function progressTextClass(pct: number): string {
  if (pct >= 90) return "text-emerald-400";
  if (pct >= 70) return "text-emerald-400/70";
  if (pct >= 45) return "text-sky-400/80";
  return "text-zinc-400/90";
}

function progressIconClass(pct: number): string {
  if (pct >= 90) return "text-emerald-400 drop-shadow-[0_0_3px_rgba(52,211,153,0.5)]";
  if (pct >= 70) return "text-emerald-500/70";
  if (pct >= 45) return "text-sky-500/60";
  return "text-zinc-500";
}

export interface GoalLikelihoodInlineOwner {
  id: string;
  name: string;
  profilePicturePath: string;
  autonomyScore: number;
  /** Worst risk across this owner's projects under the goal; omitted until rollup is ready. */
  riskLevel?: MilestoneLikelihoodRiskLevel;
  /** Lowest likelihood% for this owner (matches `riskLevel`); used for tooltip. */
  worstLikelihood?: number;
}

/**
 * Risk ring for the owner avatar — same palette family as the likelihood % text
 * (emerald / amber / orange / red). Separator halo is preserved via a thin dark shadow
 * so overlapping faces still read as distinct.
 */
function ownerRiskRingClass(level: MilestoneLikelihoodRiskLevel | undefined): string {
  switch (level) {
    case "low":
      return "ring-emerald-400/80 shadow-[0_0_0_1px_rgb(9_9_11)]";
    case "medium":
      return "ring-amber-300/80 shadow-[0_0_0_1px_rgb(9_9_11)]";
    case "high":
      return "ring-orange-400/85 shadow-[0_0_0_1px_rgb(9_9_11)]";
    case "critical":
      return "ring-red-400/85 shadow-[0_0_0_1px_rgb(9_9_11)]";
    default:
      return "ring-zinc-950";
  }
}

function ownerRiskTooltip(o: GoalLikelihoodInlineOwner): string {
  if (!o.riskLevel || typeof o.worstLikelihood !== "number") return o.name;
  return `${o.name} · ${o.worstLikelihood}% on-time (${o.riskLevel})`;
}

export interface GoalLikelihoodInlineProps {
  /** Rollup ready with on-time % and AI confidence; omit loaders when true. */
  metricsReady: boolean;
  onTimeLikelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  aiConfidence: number;
  metricsLoading: boolean;
  summaryLine: string | null;
  summaryLoading: boolean;
  summaryError: string | null;
  /** Distinct project owners under the goal, already sorted autonomy desc then name asc. */
  owners: GoalLikelihoodInlineOwner[];
  /** Goal description — added to the hover title for context. */
  goalDescription?: string;
  /**
   * Most-recent "last reply" signal across all thread URLs in this goal's rollup (read
   * synchronously from the shared thread-status cache). When `null`, the status dot renders in a
   * neutral hydrating state — same visual language as {@link MilestoneSlackThreadInline}.
   */
  freshness: SlackThreadFreshnessSignal | null;
  /**
   * Number of threads whose status was resolved from the cache vs total linked threads under the
   * goal — used to dim the indicator and explain coverage in the tooltip when only some rows
   * have hydrated yet.
   */
  threadCoverage: { considered: number; total: number };
  /** Opens the goal delivery popover. */
  onOpen: () => void;
}

const MAX_AVATARS = 4;

/** Overlapping project-owner faces — most autonomous first. Matches `MilestoneSlackThreadInline` face size (h-5 w-5). */
function OwnerAvatarStack({ owners }: { owners: GoalLikelihoodInlineOwner[] }) {
  if (owners.length === 0) return null;
  const show =
    owners.length <= MAX_AVATARS + 1
      ? owners
      : owners.slice(0, MAX_AVATARS);
  const overflow = owners.length > MAX_AVATARS + 1 ? owners.length - MAX_AVATARS : 0;
  const title = owners.map((o) => o.name).join(", ");

  return (
    <span
      className="flex shrink-0 items-center -space-x-1.5"
      role="group"
      aria-label={`Project owners: ${title}`}
      title={title}
    >
      {show.map((o, i) => (
        <span
          key={o.id}
          className={cn(
            "relative inline-flex shrink-0 rounded-full ring-2",
            ownerRiskRingClass(o.riskLevel)
          )}
          style={{ zIndex: show.length - i }}
          title={ownerRiskTooltip(o)}
        >
          {o.profilePicturePath.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={o.profilePicturePath.trim()}
              alt=""
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-200"
              aria-hidden
            >
              {displayInitials(o.name)}
            </span>
          )}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-semibold tabular-nums text-zinc-200 ring-2 ring-zinc-950"
          style={{ zIndex: show.length + 2 }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Collapsed goal row: on-time %, AI confidence, then project-owner faces (sorted by autonomy)
 * anchored to the one-line summary — mirrors the author avatar + body layout used by
 * `MilestoneSlackThreadInline`, so the owner stack reads as "who produced this summary" instead
 * of floating at the start of the row. Click opens the {@link GoalSlackPopover} goal delivery popover.
 */
export const GoalLikelihoodInline = forwardRef<
  HTMLButtonElement,
  GoalLikelihoodInlineProps
>(function GoalLikelihoodInline(
  {
    metricsReady,
    onTimeLikelihood,
    riskLevel,
    aiConfidence,
    metricsLoading,
    summaryLine,
    summaryLoading,
    summaryError,
    owners,
    goalDescription,
    freshness,
    threadCoverage,
    onOpen,
  },
  ref
) {
  const showMetricsLoader = metricsLoading || !metricsReady;
  const showSummaryLoader = summaryLoading && !summaryLine;

  /** Re-format every render so the relative label stays fresh (cached `lastReplyRelative` on
   * individual milestone rows is bounded by a 1h TTL; at the goal level we want a label that
   * keeps pace with the clock without waiting for the next cache miss). */
  const freshnessLabel = freshness
    ? formatShortRelativeSince(freshness.lastReplyAt)
    : null;
  const showFreshness = threadCoverage.total > 0;
  const partialFreshness =
    freshness != null && threadCoverage.considered < threadCoverage.total;

  const titleParts: string[] = [];
  const desc = goalDescription?.trim();
  if (desc) titleParts.push(desc);
  if (freshness && freshnessLabel) {
    if (freshness.isStale) {
      titleParts.push(`No activity in 24h — last reply ${freshnessLabel}`);
    } else {
      titleParts.push(`Last activity ${freshnessLabel}`);
    }
    if (partialFreshness) {
      titleParts.push(
        `Thread status cached for ${threadCoverage.considered}/${threadCoverage.total} threads`
      );
    }
  } else if (showFreshness) {
    titleParts.push("Thread status hydrating");
  }
  if (metricsReady) {
    titleParts.push(`On-time ${onTimeLikelihood}% (${riskLevel})`);
    titleParts.push(`AI confidence ${aiConfidence}%`);
  }
  if (summaryLine) titleParts.push(summaryLine);
  if (summaryError) titleParts.push(summaryError);
  const title = titleParts.join(" · ") || "Goal delivery outlook";

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={cn(
        /* `w-full` (not `flex-1`): parent in GoalSection is often a plain block; flex-1 only works inside a flex container. */
        "group/goal-inline flex min-h-7 w-full min-w-0 max-w-full items-center justify-start gap-2 rounded-md py-0.5 pl-0 pr-1 text-left transition-colors",
        "text-[11px] leading-snug",
        "hover:bg-zinc-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
      )}
      title={title}
      aria-label={`Open goal delivery details${desc ? ` for ${desc}` : ""}`}
    >
      {/*
        Freshness block — leading "status dot + Xd ago" pair that mirrors the milestone-row
        Slack preview (`MilestoneSlackThreadInline`). Emerald when at least one thread moved
        in the last 24h, amber-pulsing when every thread is older than 24h, zinc while the
        thread-status cache is still hydrating. When `threadCoverage.total === 0` the whole
        block is skipped (goal has no Slack-linked next milestones yet).
      */}
      {showFreshness ? (
        <>
          {freshness == null ? (
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-500/50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-500" />
            </span>
          ) : freshness.isStale ? (
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-amber-500/40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          ) : (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
              aria-hidden
            />
          )}
          <span
            className={cn(
              "shrink-0 text-[11px] font-medium tabular-nums",
              freshness == null
                ? "text-zinc-500"
                : freshness.isStale
                  ? "text-amber-200/90"
                  : "text-zinc-400",
              partialFreshness && "opacity-80"
            )}
          >
            {freshnessLabel ?? "…"}
          </span>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
        </>
      ) : null}
      {showMetricsLoader ? (
        <>
          <Loader2
            className="h-3 w-3 shrink-0 animate-spin text-zinc-500"
            aria-hidden
          />
          <span className="sr-only">Loading goal on-time rollup</span>
        </>
      ) : (
        <>
          <span
            className="inline-flex shrink-0 items-center gap-0.5"
            title="On-time likelihood (rollup of next milestones)"
          >
            <Clock
              className={cn(
                "h-3 w-3 shrink-0 opacity-90",
                likelihoodTextClass(riskLevel)
              )}
              aria-hidden
            />
            <span
              className={cn(
                PERCENT_SPAN_CLASS,
                "shrink-0 text-[11px]",
                likelihoodTextClass(riskLevel)
              )}
            >
              {onTimeLikelihood}%
            </span>
          </span>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-0.5"
            title="AI confidence (progress × on-time across projects)"
          >
            <CircleCheck
              className={cn(
                "h-3 w-3 shrink-0",
                progressIconClass(aiConfidence)
              )}
              aria-hidden
            />
            <span
              className={cn(
                PERCENT_SPAN_CLASS,
                "shrink-0 text-[11px]",
                progressTextClass(aiConfidence)
              )}
            >
              {aiConfidence}%
            </span>
          </span>
          <span className="sr-only">
            On-time {onTimeLikelihood}%, AI confidence {aiConfidence}%
          </span>
        </>
      )}
      {showSummaryLoader ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          {owners.length > 0 ? <OwnerAvatarStack owners={owners} /> : null}
          <Loader2
            className="h-3 w-3 shrink-0 animate-spin text-zinc-500"
            aria-hidden
          />
          <span className="sr-only">Generating goal summary</span>
        </>
      ) : summaryLine ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          {/* Owner avatar stack anchors to the summary (mirrors the author avatar beside the body copy in {@link MilestoneSlackThreadInline}). */}
          {owners.length > 0 ? <OwnerAvatarStack owners={owners} /> : null}
          {/* Font / color / size kept in sync with the milestone Slack thread body in {@link MilestoneSlackThreadInline} so collapsed goal summaries read as the same text style as inline thread previews. */}
          <span className="min-w-0 flex-1 truncate text-[11px] font-normal leading-snug text-zinc-500 group-hover/goal-inline:text-zinc-400">
            {truncateSummary(summaryLine, SUMMARY_MAX_CHARS)}
          </span>
        </>
      ) : summaryError ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          {owners.length > 0 ? <OwnerAvatarStack owners={owners} /> : null}
          <span className="min-w-0 flex-1 truncate text-zinc-600">
            Summary unavailable
          </span>
        </>
      ) : owners.length > 0 ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          <OwnerAvatarStack owners={owners} />
        </>
      ) : null}
    </button>
  );
});
