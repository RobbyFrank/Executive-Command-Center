import type { GoalWithProjects, Person, ProjectWithMilestones } from "@/lib/types/tracker";
import { clampAutonomy } from "@/lib/autonomyRoster";

/** Map 1–5 confidence band to a simple percentage for compact UI (20% … 100%). */
export function confidenceScoreToPercent(score: number): number {
  const s = Math.max(1, Math.min(5, Math.round(score)));
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
      headline: "Confidence 1/5 (20%)",
      paragraphs: [
        "No owner is assigned, so confidence stays at the minimum until someone owns delivery.",
        "After you assign an owner, we compare their autonomy (from Team) to this project’s complexity.",
      ],
      ariaLabel:
        "Confidence 1/5 (20%). No owner assigned. Assign an owner to use autonomy vs complexity.",
    };
  }
  const person = peopleById.get(project.ownerId);
  const autonomyRaw = person?.autonomyScore;
  if (autonomyRaw === undefined) {
    return {
      headline: "Confidence 1/5 (20%)",
      paragraphs: [
        "This owner id is not on Team, so autonomy is treated as missing (same as no owner).",
      ],
      ariaLabel:
        "Confidence 1/5 (20%). Owner id not found on Team; autonomy treated as missing.",
    };
  }
  const a = clampAutonomy(autonomyRaw);
  const c = Math.max(1, Math.min(5, project.complexityScore));
  const linear = a - c + 3;
  const score = computeProjectConfidence(autonomyRaw, project.complexityScore);
  const pct = confidenceScoreToPercent(score);
  const out: ConfidenceExplanation = {
    headline: `Confidence ${score}/5 (${pct}%)`,
    paragraphs: [
      `Owner “${person?.name ?? "?"}" has autonomy ${a}; this project’s complexity is ${c}.`,
      `Formula: ${a} − ${c} + 3 = ${linear}, then clamped to the 1–5 band.`,
      "Higher scores mean more execution headroom; lower scores mean tighter oversight.",
    ],
    ariaLabel: "",
  };
  out.ariaLabel = buildAriaLabel(out);
  return out;
}

/**
 * Average of per-project confidence under this goal.
 */
export function explainGoalConfidence(
  goal: GoalWithProjects,
  peopleById: Map<string, Person>
): ConfidenceExplanation {
  if (goal.projects.length === 0) {
    return {
      headline: "Confidence 3/5 (60%)",
      paragraphs: [
        "There are no projects under this goal yet, so we use a neutral middle score.",
        "Add projects to compute confidence from each owner’s autonomy vs complexity.",
      ],
      ariaLabel:
        "Confidence 3/5 (60%). No projects yet; neutral score until projects exist.",
    };
  }
  const bullets = goal.projects.map((p) => {
    const s = computeProjectConfidenceFromProject(p, peopleById);
    const pPct = confidenceScoreToPercent(s);
    return `"${p.name}" → ${s}/5 (${pPct}%)`;
  });
  const avg = computeGoalConfidence(goal.projects, peopleById);
  const pct = confidenceScoreToPercent(avg);
  const out: ConfidenceExplanation = {
    headline: `Confidence ${avg}/5 (${pct}%)`,
    paragraphs: [
      `Rounded average of ${goal.projects.length} project confidence score(s).`,
      "Each project uses clamp(owner autonomy − complexity + 3); this row shows the mean rounded to a whole step.",
    ],
    bullets,
    ariaLabel: "",
  };
  out.ariaLabel = buildAriaLabel(out);
  return out;
}

/**
 * Auto confidence: autonomy vs complexity. Equal scores → 3 (neutral).
 * Unassigned owner → 1.
 */
export function computeProjectConfidence(
  ownerAutonomy: number | null | undefined,
  complexityScore: number
): number {
  if (ownerAutonomy === null || ownerAutonomy === undefined) return 1;
  const a = clampAutonomy(ownerAutonomy);
  const c = Math.max(1, Math.min(5, complexityScore));
  return Math.max(1, Math.min(5, a - c + 3));
}

export function computeProjectConfidenceFromProject(
  project: ProjectWithMilestones,
  peopleById: Map<string, Person>
): number {
  if (!project.ownerId.trim()) return 1;
  const autonomy = peopleById.get(project.ownerId)?.autonomyScore;
  return computeProjectConfidence(autonomy ?? null, project.complexityScore);
}

/** Average of child project confidences, rounded; no projects → 3. */
export function computeGoalConfidence(
  projects: ProjectWithMilestones[],
  peopleById: Map<string, Person>
): number {
  if (projects.length === 0) return 3;
  const sum = projects.reduce(
    (acc, p) => acc + computeProjectConfidenceFromProject(p, peopleById),
    0
  );
  return Math.round(sum / projects.length);
}
