import type { GoalWithProjects, Person, ProjectWithMilestones } from "@/lib/types/tracker";
import { clampAutonomy } from "@/lib/autonomyRoster";

/**
 * How strongly cost of delay increases the weight of high-autonomy project owners
 * in the goal-level aggregate (0 = ignore COD; typical ~1.5).
 */
const GOAL_COD_AUTONOMY_WEIGHT_BETA = 1.5;

/** Map 1–5 cost of delay to [0,1]; at minimum delay, goal confidence is a plain average. */
function costOfDelayEmphasis(costOfDelay: number): number {
  const c = Math.max(1, Math.min(5, Math.round(costOfDelay)));
  return (c - 1) / 4;
}

/** Owner autonomy band (1–5) for weighting; mirrors missing-owner treatment in project confidence. */
function projectOwnerAutonomyBand(
  project: ProjectWithMilestones,
  peopleById: Map<string, Person>
): number {
  if (!project.ownerId.trim()) return 1;
  const raw = peopleById.get(project.ownerId)?.autonomyScore;
  if (raw === undefined) return 1;
  return clampAutonomy(raw);
}

/**
 * Relative weight for this project in the goal aggregate. At minimum cost of delay, all weights are 1.
 * As delay cost rises, owners with higher autonomy get larger weights.
 */
function goalProjectConfidenceWeight(
  project: ProjectWithMilestones,
  peopleById: Map<string, Person>,
  costOfDelay: number
): number {
  const cod = costOfDelayEmphasis(costOfDelay);
  if (cod === 0) return 1;
  const a = projectOwnerAutonomyBand(project, peopleById);
  const autonomyHeadroom = (a - 1) / 4;
  return 1 + GOAL_COD_AUTONOMY_WEIGHT_BETA * cod * autonomyHeadroom;
}

/** Map 0–5 confidence band to a percentage for compact UI (0% … 100%). */
export function confidenceScoreToPercent(score: number): number {
  const s = Math.max(0, Math.min(5, Math.round(score)));
  return s * 20;
}

/** Structured copy for the Roadmap confidence popover. */
export type ConfidenceExplanation = {
  headline: string;
  paragraphs: string[];
  /** Optional list (e.g. per-project breakdown). */
  bullets?: string[];
  /** Plain text for accessibility. */
  ariaLabel: string;
};

function buildAriaLabel(e: ConfidenceExplanation): string {
  const chunks = [e.headline, ...e.paragraphs];
  if (e.bullets?.length) chunks.push(e.bullets.join(". "));
  return chunks.join(" ");
}

export function fallbackConfidenceExplanation(
  message: string
): ConfidenceExplanation {
  return {
    headline: "Confidence",
    paragraphs: [message],
    ariaLabel: message,
  };
}

/**
 * How project confidence was derived (autonomy vs complexity).
 */
export function explainProjectConfidence(
  project: ProjectWithMilestones,
  peopleById: Map<string, Person>
): ConfidenceExplanation {
  if (!project.ownerId.trim()) {
    return {
      headline: "Confidence 0/5 (0%)",
      paragraphs: ["Assign an owner to score confidence."],
      ariaLabel: "Confidence 0/5 (0%). No project owner assigned.",
    };
  }
  const person = peopleById.get(project.ownerId);
  const autonomyRaw = person?.autonomyScore;
  if (autonomyRaw === undefined) {
    return {
      headline: "Confidence 0/5 (0%)",
      paragraphs: ["Owner not found on Team."],
      ariaLabel: "Confidence 0/5 (0%). Owner not found on Team.",
    };
  }
  const a = clampAutonomy(autonomyRaw);
  const c = Math.max(1, Math.min(5, project.complexityScore));
  const score = computeProjectConfidence(autonomyRaw, project.complexityScore);
  const pct = confidenceScoreToPercent(score);
  const name = person?.name ?? "?";

  let summary: string;
  if (score >= 5)
    summary = `${name} can comfortably own this project independently.`;
  else if (score === 4)
    summary = `${name} has the autonomy for a project of this complexity.`;
  else if (score === 3)
    summary = `${name} can manage this, but some oversight would help.`;
  else if (score === 2)
    summary = `${name} may not have enough autonomy for a project this complex \u2014 oversight is needed.`;
  else
    summary = `${name} does not have enough autonomy to manage a project of this complexity \u2014 close oversight is needed.`;

  const out: ConfidenceExplanation = {
    headline: `Confidence ${score}/5 (${pct}%)`,
    paragraphs: [summary],
    ariaLabel: "",
  };
  out.ariaLabel = buildAriaLabel(out);
  return out;
}

/**
 * Aggregate of per-project confidence under this goal, weighted by cost of delay and owner autonomy.
 */
export function explainGoalConfidence(
  goal: GoalWithProjects,
  peopleById: Map<string, Person>
): ConfidenceExplanation {
  if (goal.projects.length === 0) {
    return {
      headline: "Confidence 0/5 (0%)",
      paragraphs: ["Add projects under this goal to see a blended score."],
      ariaLabel:
        "Confidence 0/5 (0%). No projects yet; add projects to compute confidence.",
    };
  }
  const codEmphasis = costOfDelayEmphasis(goal.costOfDelay);
  const bullets = goal.projects.map((p) => {
    const s = computeProjectConfidenceFromProject(p, peopleById);
    const pPct = confidenceScoreToPercent(s);
    return `"${p.name}" \u2192 ${s}/5 (${pPct}%)`;
  });
  const avg = computeGoalConfidence(goal.projects, peopleById, goal.costOfDelay);
  const pct = confidenceScoreToPercent(avg);
  const out: ConfidenceExplanation = {
    headline: `Confidence ${avg}/5 (${pct}%)`,
    paragraphs:
      codEmphasis === 0
        ? ["Straight average of project scores."]
        : [
            `Cost of delay ${goal.costOfDelay}/5 \u2014 higher-autonomy owners weigh more.`,
          ],
    bullets,
    ariaLabel: "",
  };
  out.ariaLabel = buildAriaLabel(out);
  return out;
}

/**
 * Auto confidence: autonomy vs complexity. Equal scores \u2192 3 (neutral).
 * Missing owner / missing autonomy on Team \u2192 0.
 */
export function computeProjectConfidence(
  ownerAutonomy: number | null | undefined,
  complexityScore: number
): number {
  if (ownerAutonomy === null || ownerAutonomy === undefined) return 0;
  const a = clampAutonomy(ownerAutonomy);
  const c = Math.max(1, Math.min(5, complexityScore));
  return Math.max(1, Math.min(5, a - c + 3));
}

export function computeProjectConfidenceFromProject(
  project: ProjectWithMilestones,
  peopleById: Map<string, Person>
): number {
  if (!project.ownerId.trim()) return 0;
  const autonomy = peopleById.get(project.ownerId)?.autonomyScore;
  return computeProjectConfidence(autonomy ?? null, project.complexityScore);
}

/**
 * Child project confidences combined with cost-of-delay-aware weights, rounded; no projects \u2192 0.
 * At minimum cost of delay this matches a straight average; as delay cost rises, projects owned by
 * higher-autonomy people count more (see `goalProjectConfidenceWeight`).
 */
export function computeGoalConfidence(
  projects: ProjectWithMilestones[],
  peopleById: Map<string, Person>,
  costOfDelay: number = 3
): number {
  if (projects.length === 0) return 0;
  let sumW = 0;
  let sumWeighted = 0;
  for (const p of projects) {
    const pc = computeProjectConfidenceFromProject(p, peopleById);
    const w = goalProjectConfidenceWeight(p, peopleById, costOfDelay);
    sumW += w;
    sumWeighted += w * pc;
  }
  const raw = sumWeighted / sumW;
  return Math.max(0, Math.min(5, Math.round(raw)));
}
