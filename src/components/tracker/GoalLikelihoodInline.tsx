"use client";

import { CircleCheck, Clock, Loader2 } from "lucide-react";
import type { MilestoneLikelihoodRiskLevel } from "@/server/actions/slack";
import { cn } from "@/lib/utils";

const SUMMARY_MAX_CHARS = 140;

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
}

/**
 * Collapsed goal row: on-time odds, AI confidence, and one-line summary (after Slack column).
 * Display-only — no thread popover.
 */
export function GoalLikelihoodInline({
  metricsReady,
  onTimeLikelihood,
  riskLevel,
  aiConfidence,
  metricsLoading,
  summaryLine,
  summaryLoading,
  summaryError,
}: GoalLikelihoodInlineProps) {
  const showMetricsLoader = metricsLoading || !metricsReady;
  const showSummaryLoader = summaryLoading && !summaryLine;

  const titleParts: string[] = [];
  if (metricsReady) {
    titleParts.push(`On-time ${onTimeLikelihood}% (${riskLevel})`);
    titleParts.push(`AI confidence ${aiConfidence}%`);
  }
  if (summaryLine) titleParts.push(summaryLine);
  if (summaryError) titleParts.push(summaryError);
  const title = titleParts.join(" · ") || "Goal delivery outlook";

  return (
    <div
      className={cn(
        "group/goal-inline flex min-w-0 max-w-full min-h-6 flex-1 items-center justify-start gap-1 rounded-md py-0.5 text-left",
        "text-[10px] leading-snug"
      )}
      title={title}
    >
      {showMetricsLoader ? (
        <>
          <Loader2
            className="h-2.5 w-2.5 shrink-0 animate-spin text-zinc-500"
            aria-hidden
          />
          <span className="sr-only">Loading goal on-time rollup</span>
        </>
      ) : (
        <>
          <span
            className="inline-flex shrink-0 items-center gap-px"
            title="On-time likelihood (rollup of next milestones)"
          >
            <Clock
              className={cn(
                "h-2.5 w-2.5 shrink-0 opacity-90",
                likelihoodTextClass(riskLevel)
              )}
              aria-hidden
            />
            <span
              className={cn(
                PERCENT_SPAN_CLASS,
                "shrink-0 text-[10px]",
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
            className="inline-flex shrink-0 items-center gap-px"
            title="AI confidence (progress × on-time across projects)"
          >
            <CircleCheck
              className={cn(
                "h-2.5 w-2.5 shrink-0",
                progressIconClass(aiConfidence)
              )}
              aria-hidden
            />
            <span
              className={cn(
                PERCENT_SPAN_CLASS,
                "shrink-0 text-[10px]",
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
          <Loader2
            className="h-2.5 w-2.5 shrink-0 animate-spin text-zinc-500"
            aria-hidden
          />
          <span className="sr-only">Generating goal summary</span>
        </>
      ) : summaryLine ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-500 group-hover/goal-inline:text-zinc-400">
            {truncateSummary(summaryLine, SUMMARY_MAX_CHARS)}
          </span>
        </>
      ) : summaryError ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-600">
            Summary unavailable
          </span>
        </>
      ) : null}
    </div>
  );
}
