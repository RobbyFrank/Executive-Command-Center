import { parseLastReviewed } from "@/lib/reviewStaleness";

/** Days within which a goal/project review counts toward “recent” momentum. */
export const MOMENTUM_RECENT_REVIEW_DAYS = 14;

const IN_PROGRESS = "In Progress" as const;

export type MomentumTier = "high" | "moderate" | "low" | "dormant";

export interface MomentumScoreInput {
  goals: number;
  projects: number;
  activeGoals: number;
  activeProjects: number;
  goalsWithSpotlight: number;
  projectsWithSpotlight: number;
  goalsWithAtRisk: number;
  projectsWithAtRisk: number;
  milestonesDone: number;
  milestonesTotal: number;
  recentlyReviewed: number;
}

export function isReviewedWithinDays(
  lastReviewed: string,
  days: number
): boolean {
  const d = parseLastReviewed(lastReviewed);
  if (!d) return false;
  const ms = days * 24 * 60 * 60 * 1000;
  return Date.now() - d.getTime() < ms;
}

/** Goal or project counts as active for momentum when status is In Progress. */
export function isActiveStatus(status: string): boolean {
  return status === IN_PROGRESS;
}

/**
 * Composite 0–100 score from activity, spotlight, milestones, reviews, and at-risk penalty.
 */
export function computeMomentumScore(input: MomentumScoreInput): number {
  const gTotal = input.goals;
  const pTotal = input.projects;
  if (gTotal === 0 && pTotal === 0) return 0;

  const activeGoalRatio = gTotal > 0 ? input.activeGoals / gTotal : 0;
  const activeProjectRatio = pTotal > 0 ? input.activeProjects / pTotal : 0;

  const totalItems = gTotal + pTotal;
  const spotlightTotal =
    input.goalsWithSpotlight + input.projectsWithSpotlight;
  const spotlightNorm = Math.min(1, spotlightTotal / Math.max(1, totalItems));

  const milestoneRatio =
    input.milestonesTotal > 0
      ? input.milestonesDone / input.milestonesTotal
      : 0;

  const recentRatio =
    totalItems > 0 ? input.recentlyReviewed / totalItems : 0;

  const riskTotal = input.goalsWithAtRisk + input.projectsWithAtRisk;
  const riskPenalty = Math.min(30, riskTotal * 8);

  let score =
    30 * activeGoalRatio +
    25 * activeProjectRatio +
    20 * spotlightNorm +
    15 * milestoneRatio +
    10 * recentRatio;

  score -= riskPenalty;

  return Math.round(Math.min(100, Math.max(0, score)));
}

export function momentumTierFromScore(score: number): MomentumTier {
  if (score >= 70) return "high";
  if (score >= 40) return "moderate";
  if (score >= 10) return "low";
  return "dormant";
}

/** Left border accent for a company row by momentum tier. */
export function momentumTierBorderClass(tier: MomentumTier): string {
  switch (tier) {
    case "high":
      return "border-l-emerald-500/45";
    case "moderate":
      return "border-l-blue-500/35";
    case "low":
      return "border-l-amber-500/35";
    default:
      return "border-l-zinc-700/50";
  }
}

export function buildMomentumTooltip(input: MomentumScoreInput): string {
  const lines = [
    `Momentum ${computeMomentumScore(input)}%`,
    `Active: ${input.activeGoals}/${input.goals} goals, ${input.activeProjects}/${input.projects} projects`,
    `Spotlight: ${input.goalsWithSpotlight + input.projectsWithSpotlight} · At risk: ${input.goalsWithAtRisk + input.projectsWithAtRisk}`,
    `Milestones: ${input.milestonesDone}/${input.milestonesTotal} done`,
    `Reviewed (last ${MOMENTUM_RECENT_REVIEW_DAYS}d): ${input.recentlyReviewed} of ${input.goals + input.projects} items`,
  ];
  return lines.join("\n");
}
