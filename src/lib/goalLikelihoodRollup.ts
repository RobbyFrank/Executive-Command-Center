import { getNextPendingMilestone } from "@/lib/next-milestone";
import type { GoalWithProjects, Person } from "@/lib/types/tracker";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";
import { isValidHttpUrl } from "@/lib/httpUrl";
import type {
  MilestoneLikelihoodRiskLevel,
  MilestoneLikelihoodResult,
} from "@/server/actions/slack";
import type { SlackThreadFreshnessSignal } from "@/lib/slackThreadFreshness";

type CachedOk = Extract<MilestoneLikelihoodResult, { ok: true }>;

const RISK_ORDER: Record<MilestoneLikelihoodRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function worstRisk(
  a: MilestoneLikelihoodRiskLevel,
  b: MilestoneLikelihoodRiskLevel
): MilestoneLikelihoodRiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export type GoalLikelihoodProjectSummary = {
  projectName: string;
  milestoneName: string;
  summaryLine: string;
  likelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  progressEstimate: number;
};

export type GoalLikelihoodRollup = {
  /** True when every assessable project slot has a cached milestone likelihood. */
  ready: boolean;
  onTimeLikelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  /** AI-style confidence from child milestone progress × on-time odds (not the roadmap Confidence column). */
  aiConfidence: number;
  projectSummaries: GoalLikelihoodProjectSummary[];
  coverage: { total: number; cached: number };
  /**
   * Slack URLs for the assessable next-pending milestones under this goal — used by the hook to
   * read cached {@link SlackThreadStatusOk} entries and fold them into {@link freshness}. Kept
   * on the rollup so other UI (e.g. {@link GoalSlackPopover}) can share the same source list.
   */
  threadSlackUrls: string[];
  /**
   * Most-recent "last reply" signal across the threads referenced by {@link threadSlackUrls},
   * read from the shared thread-status cache. `null` when no child row has populated that cache
   * yet (e.g. first paint before milestone rows hydrate). Deterministic given the cache contents.
   */
  freshness: SlackThreadFreshnessSignal | null;
};

export type ReadCachedMilestoneLikelihood = (args: {
  slackUrl: string;
  targetDate: string;
  ownerAutonomy: number | null;
  projectComplexity: number;
}) => CachedOk | null;

function milestoneHasAssessableDueDate(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return parseCalendarDateString(t) !== null;
}

/**
 * Roll up next-pending-milestone likelihoods for each project under the goal (same scope as
 * {@link ProjectRow}’s collapsed Slack strip). Returns `null` when no project has a dated,
 * Slack-linked next pending milestone.
 */
export function computeGoalLikelihoodRollup(
  goal: GoalWithProjects,
  peopleById: Map<string, Person>,
  readCached: ReadCachedMilestoneLikelihood
): GoalLikelihoodRollup | null {
  const slots: Array<{
    projectName: string;
    slackUrl: string;
    targetDate: string;
    ownerAutonomy: number | null;
    projectComplexity: number;
    milestoneName: string;
  }> = [];

  for (const p of goal.projects) {
    const next = getNextPendingMilestone(p.milestones);
    if (!next) continue;
    if (!milestoneHasAssessableDueDate(next.targetDate ?? "")) continue;
    const u = next.slackUrl.trim();
    if (!isValidHttpUrl(u)) continue;
    const owner = p.ownerId ? peopleById.get(p.ownerId) : undefined;
    slots.push({
      projectName: p.name,
      slackUrl: u,
      targetDate: next.targetDate.trim(),
      ownerAutonomy: owner?.autonomyScore ?? null,
      projectComplexity: p.complexityScore,
      milestoneName: next.name,
    });
  }

  if (slots.length === 0) return null;

  const threadSlackUrls = slots.map((s) => s.slackUrl);

  let cached = 0;
  const cachedRows: Array<{
    weight: number;
    likelihood: number;
    riskLevel: MilestoneLikelihoodRiskLevel;
    progressEstimate: number;
    threadSummaryLine: string;
    projectName: string;
    milestoneName: string;
  }> = [];

  for (const s of slots) {
    const w = Math.max(1, Math.min(5, Math.round(s.projectComplexity)));
    const hit = readCached({
      slackUrl: s.slackUrl,
      targetDate: s.targetDate,
      ownerAutonomy: s.ownerAutonomy,
      projectComplexity: s.projectComplexity,
    });
    if (hit) {
      cached += 1;
      cachedRows.push({
        weight: w,
        likelihood: hit.likelihood,
        riskLevel: hit.riskLevel,
        progressEstimate: hit.progressEstimate,
        threadSummaryLine:
          typeof hit.threadSummaryLine === "string"
            ? hit.threadSummaryLine.trim()
            : "",
        projectName: s.projectName,
        milestoneName: s.milestoneName,
      });
    }
  }

  const total = slots.length;

  if (cached < total) {
    return {
      ready: false,
      onTimeLikelihood: 0,
      riskLevel: "medium" as MilestoneLikelihoodRiskLevel,
      aiConfidence: 0,
      projectSummaries: [],
      coverage: { total, cached },
      threadSlackUrls,
      freshness: null,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let minLikelihood = Infinity;
  let aggRisk: MilestoneLikelihoodRiskLevel = "low";
  let confAcc = 0;

  for (const r of cachedRows) {
    weightedSum += r.likelihood * r.weight;
    weightTotal += r.weight;
    minLikelihood = Math.min(minLikelihood, r.likelihood);
    aggRisk = worstRisk(aggRisk, r.riskLevel);
    confAcc += r.progressEstimate * (r.likelihood / 100);
  }

  const weightedAvg =
    weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  const flooredMin =
    minLikelihood === Infinity ? weightedAvg : Math.round(minLikelihood);
  const onTimeLikelihood = Math.max(
    0,
    Math.min(100, Math.min(weightedAvg, flooredMin))
  );

  const aiConfidence = Math.max(
    0,
    Math.min(100, Math.round(confAcc / cachedRows.length))
  );

  const projectSummaries: GoalLikelihoodProjectSummary[] = cachedRows.map(
    (r) => ({
      projectName: r.projectName,
      milestoneName: r.milestoneName,
      summaryLine: r.threadSummaryLine,
      likelihood: r.likelihood,
      riskLevel: r.riskLevel,
      progressEstimate: r.progressEstimate,
    })
  );

  return {
    ready: true,
    onTimeLikelihood,
    riskLevel: aggRisk,
    aiConfidence,
    projectSummaries,
    coverage: { total, cached },
    threadSlackUrls,
    freshness: null,
  };
}
