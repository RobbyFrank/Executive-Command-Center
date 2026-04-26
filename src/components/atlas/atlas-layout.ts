import type { Person, Priority } from "@/lib/types/tracker";
import {
  companyActivityScore,
  goalCategoryFor,
  isProjectAtRisk,
  isProjectStale,
  milestoneColor,
  PRIORITY_RADIUS_KICKER,
  projectColor,
} from "./atlas-activity";
import type {
  CompanyWithGoals,
  GoalWithProjects,
  GroupingKey,
  LaidCompany,
  LaidGoal,
  LaidMilestone,
  LaidProject,
  ProjectWithMilestones,
} from "./atlas-types";

export const CANVAS_W = 1200;
export const CANVAS_H = 800;

const MIN_COMPANY_R = 40;
const MAX_COMPANY_R = 230;

/**
 * Place companies on the canvas. Uses a stable deterministic layout (seeded by
 * id) with radius ∝ activity score. Good enough for ≲20 companies without
 * introducing a physics engine.
 */
export function layoutCompanies(
  companies: CompanyWithGoals[]
): LaidCompany[] {
  const withScores = companies.map((company) => {
    const activity = companyActivityScore(company);
    const projects = company.goals.flatMap((g) => g.projects);
    return {
      company,
      activity,
      projectCount: projects.length,
      atRiskCount: projects.filter((p) => p.atRisk).length,
      stuckCount: projects.filter(
        (p) => p.status === "Stuck" || p.status === "Blocked"
      ).length,
    };
  });

  withScores.sort((a, b) => b.activity - a.activity);

  const result: LaidCompany[] = [];
  const margin = 40;

  withScores.forEach((entry, index) => {
    const r = Math.max(
      MIN_COMPANY_R,
      MIN_COMPANY_R + (MAX_COMPANY_R - MIN_COMPANY_R) * (entry.activity / 100)
    );

    const { cx, cy } = placeCircleOnCanvas(result, r, margin, index, entry.company.id);
    result.push({
      id: entry.company.id,
      name: entry.company.name,
      cx,
      cy,
      r,
      activity: entry.activity,
      projectCount: entry.projectCount,
      atRiskCount: entry.atRiskCount,
      stuckCount: entry.stuckCount,
      company: entry.company,
    });
  });

  return result;
}

/** Deterministic pseudo-random 0–1 from a string seed. */
function seededRandom(seed: string, salt: number): number {
  let h = 2166136261;
  const combined = `${seed}:${salt}`;
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Pick a non-overlapping center for a circle of radius `r` against the full
 * canvas. Used for the company-level layout. Tries seeded candidates; falls
 * back to a ring around the canvas center if all collide.
 */
function placeCircleOnCanvas(
  placed: LaidCompany[],
  r: number,
  margin: number,
  index: number,
  seed: string
): { cx: number; cy: number } {
  const pad = 14;
  const minX = margin + r;
  const maxX = CANVAS_W - margin - r;
  const minY = margin + r;
  const maxY = CANVAS_H - margin - r;

  for (let attempt = 0; attempt < 200; attempt++) {
    const cx = minX + (maxX - minX) * seededRandom(seed, attempt * 2);
    const cy = minY + (maxY - minY) * seededRandom(seed, attempt * 2 + 1);
    const ok = placed.every(
      (p) => Math.hypot(cx - p.cx, cy - p.cy) >= p.r + r + pad
    );
    if (ok) return { cx, cy };
  }

  // Fallback: ring around canvas center (rare; only if many large circles).
  const angle = (index / Math.max(1, placed.length + 1)) * Math.PI * 2;
  return {
    cx: CANVAS_W / 2 + Math.cos(angle) * (CANVAS_W / 3),
    cy: CANVAS_H / 2 + Math.sin(angle) * (CANVAS_H / 3),
  };
}

/**
 * Generic non-overlap rejection sampling inside an arbitrary bounding circle.
 * Used for goals (inside a company) and projects (inside a focused goal).
 *
 * `existing` only needs `cx`/`cy`/`r`. `bias` (when provided) shifts the
 * random target toward a point inside the bounding region — used for the
 * priority quadrant clustering.
 */
interface PlacedCircle {
  cx: number;
  cy: number;
  r: number;
}

function placeCircleInBoundingCircle(
  existing: readonly PlacedCircle[],
  r: number,
  bound: { cx: number; cy: number; r: number },
  seed: string,
  pad: number,
  bias?: { x: number; y: number; strength: number }
): { cx: number; cy: number } {
  const innerR = Math.max(0, bound.r - r - pad);
  for (let attempt = 0; attempt < 220; attempt++) {
    // Uniform sample inside a disc via sqrt() radius scaling.
    const u = seededRandom(seed, attempt * 2);
    const v = seededRandom(seed, attempt * 2 + 1);
    const radius = innerR * Math.sqrt(u);
    const angle = v * Math.PI * 2;
    let cx = bound.cx + Math.cos(angle) * radius;
    let cy = bound.cy + Math.sin(angle) * radius;
    if (bias && bias.strength > 0) {
      cx = cx + (bias.x - cx) * bias.strength;
      cy = cy + (bias.y - cy) * bias.strength;
    }
    const ok = existing.every(
      (p) => Math.hypot(cx - p.cx, cy - p.cy) >= p.r + r + pad
    );
    if (ok) return { cx, cy };
  }
  // Fallback: ring around the bounding center.
  const ringR = Math.max(0, bound.r - r - pad);
  const angle =
    (existing.length / Math.max(1, existing.length + 1)) * Math.PI * 2;
  return {
    cx: bound.cx + Math.cos(angle) * ringR * 0.9,
    cy: bound.cy + Math.sin(angle) * ringR * 0.9,
  };
}

const MIN_GOAL_R = 22;
const MAX_GOAL_R = 70;

/**
 * Place goals as freely-floating bubbles inside the focused company's
 * bounding circle. Bubble size is driven by the goal's project count plus a
 * subtle priority kicker so urgent goals quietly draw the eye even before
 * the priority-tinted glow / flag color reach the user.
 *
 * When `grouping === "priority"`, candidate placements are softly biased
 * toward a quadrant per priority — Urgent top-left, High top-right, Normal
 * bottom-left, Low bottom-right. The bias is gentle (random jitter still
 * dominates) so the layout reads as "subtle clustering" rather than a
 * strict grid.
 */
export function layoutGoalsInEther(
  company: LaidCompany,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): LaidGoal[] {
  const goals = company.company.goals;
  if (goals.length === 0) return [];

  const maxProjects = Math.max(
    1,
    ...goals.map((g) => g.projects.filter((p) => !p.isMirror).length)
  );

  // Bounding circle inside the focused company. Slight inset so labels can
  // breathe and the company's own outer chrome doesn't get clipped.
  const bound = { cx: company.cx, cy: company.cy, r: company.r * 0.82 };

  // Dynamic radius envelope: a single goal can occupy up to ~45% of the
  // bound; with N goals, the cap drops as 0.7/√N so they all have room to
  // pack without colliding into the rejection-sampling fallback. Final
  // values are clamped against the desktop-feel constants
  // (MIN_GOAL_R / MAX_GOAL_R) so bubbles still feel goal-shaped.
  const N = goals.length;
  const dynamicMax = bound.r * Math.min(0.45, 0.7 / Math.sqrt(N));
  const effectiveMaxR = Math.min(MAX_GOAL_R, dynamicMax);
  const effectiveMinR = Math.min(MIN_GOAL_R, effectiveMaxR * 0.55);

  const result: LaidGoal[] = [];
  const sorted = [...goals].sort(priorityFirstThenName);

  for (const goal of sorted) {
    const projects = goal.projects.filter((p) => !p.isMirror);
    const projectCount = projects.length;
    const baseFrac =
      0.45 + 0.55 * (projectCount / maxProjects);
    const r = Math.max(
      effectiveMinR,
      Math.min(
        effectiveMaxR,
        (effectiveMinR + (effectiveMaxR - effectiveMinR) * baseFrac) *
          PRIORITY_RADIUS_KICKER[goal.priority]
      )
    );

    const cat = goalCategoryFor(goal, grouping, peopleById);
    const seed = `${company.id}:${goal.id}:${grouping}`;

    const bias =
      grouping === "priority"
        ? quadrantBiasFor(goal.priority, bound)
        : undefined;

    const { cx, cy } = placeCircleInBoundingCircle(
      result,
      r,
      bound,
      seed,
      6,
      bias
    );

    result.push({
      id: `${company.id}:${goal.id}`,
      bucketKey: goal.id,
      label: goal.description,
      color: cat.color,
      categoryKey: cat.key,
      categoryLabel: cat.label,
      cx,
      cy,
      r,
      projectCount,
      projects: goal.projects,
      goal,
    });
  }

  return result;
}

/**
 * Quadrant target inside a bounding circle for a given priority. Returned
 * as `(x, y, strength)`; strength of 0.45 pulls a candidate roughly halfway
 * toward the quadrant centroid, leaving plenty of room for jitter so two
 * urgent goals don't sit on top of each other.
 */
function quadrantBiasFor(
  priority: Priority,
  bound: { cx: number; cy: number; r: number }
): { x: number; y: number; strength: number } {
  const offset = bound.r * 0.5;
  switch (priority) {
    case "P0":
      return { x: bound.cx - offset, y: bound.cy - offset, strength: 0.45 };
    case "P1":
      return { x: bound.cx + offset, y: bound.cy - offset, strength: 0.45 };
    case "P2":
      return { x: bound.cx - offset, y: bound.cy + offset, strength: 0.45 };
    case "P3":
    default:
      return { x: bound.cx + offset, y: bound.cy + offset, strength: 0.45 };
  }
}

/** P0 first, then P1, P2, P3; ties break alphabetically by description. */
function priorityFirstThenName(a: GoalWithProjects, b: GoalWithProjects): number {
  const ord: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const da = ord[a.priority] ?? 9;
  const db = ord[b.priority] ?? 9;
  if (da !== db) return da - db;
  return a.description.localeCompare(b.description);
}

/**
 * Inner layout for one focused company. Returns:
 * - `goals` — the level-1 goal bubbles (always present, freely placed in the
 *   ether).
 * - `projects` — the level-2 project bubbles (one per non-mirror project on
 *   any goal). Projects are placed inside their parent goal's bounding
 *   circle via `layoutProjectsInEther`.
 *
 * Camera framing in `PortfolioAtlas` decides which level is currently
 * visible; both layers are computed up front so the focus snap doesn't have
 * to wait on layout.
 */
export function layoutCompanyInner(
  company: LaidCompany,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): { goals: LaidGoal[]; projects: LaidProject[] } {
  const goals = layoutGoalsInEther(company, grouping, peopleById);
  const projects: LaidProject[] = [];
  for (const goal of goals) {
    projects.push(...layoutProjectsInEther(goal, grouping, peopleById));
  }
  return { goals, projects };
}

const MIN_PROJECT_R_FRAC = 0.18;
const MAX_PROJECT_R_FRAC = 0.34;

/**
 * Place projects inside a focused goal's bubble as freely-floating circles.
 * Same rejection-sampling primitive as goals/companies, scoped to the
 * goal's bounding circle. Bubble size is driven by milestone count plus the
 * project's priority kicker so urgent projects subtly read larger inside
 * any goal.
 */
export function layoutProjectsInEther(
  goal: LaidGoal,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): LaidProject[] {
  const projects = goal.projects.filter((p) => !p.isMirror);
  if (projects.length === 0) return [];

  const maxMilestones = Math.max(1, ...projects.map((p) => p.milestones.length));

  const bound = { cx: goal.cx, cy: goal.cy, r: goal.r * 0.78 };
  const baseMin = goal.r * MIN_PROJECT_R_FRAC;
  const baseMax = goal.r * MAX_PROJECT_R_FRAC;

  // Same dynamic-cap scheme as goals: ensures multiple project bubbles can
  // actually pack inside the goal's bounding circle without colliding into
  // the rejection-sampling fallback. With 1 project, max ≈ 35% of bound;
  // with 9 projects, ≈ 20%.
  const N = projects.length;
  const dynamicMax = bound.r * Math.min(0.55, 0.6 / Math.sqrt(N));
  const effectiveMaxR = Math.min(baseMax, dynamicMax);
  const effectiveMinR = Math.min(baseMin, effectiveMaxR * 0.55);

  const result: LaidProject[] = [];
  const sorted = [...projects].sort((a, b) => {
    const ord: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const da = ord[a.priority] ?? 9;
    const db = ord[b.priority] ?? 9;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });

  for (const project of sorted) {
    const baseFrac =
      0.55 + 0.45 * (project.milestones.length / maxMilestones);
    const r = Math.max(
      effectiveMinR,
      Math.min(
        effectiveMaxR,
        (effectiveMinR + (effectiveMaxR - effectiveMinR) * baseFrac) *
          PRIORITY_RADIUS_KICKER[project.priority]
      )
    );
    const seed = `${goal.id}:${project.id}`;
    const { cx, cy } = placeCircleInBoundingCircle(result, r, bound, seed, 4);
    result.push({
      id: project.id,
      companyId: goal.id.split(":")[0] ?? "",
      groupId: goal.id,
      bucketKey: goal.bucketKey,
      cx,
      cy,
      r,
      project,
      color: projectColor(project, grouping, peopleById),
      isStale: isProjectStale(project),
      isAtRisk: isProjectAtRisk(project),
    });
  }

  return result;
}

/**
 * Place milestones along a chronologically-ordered, gently-wandering path
 * inside the focused project's bubble. The path is a sine-wave serpentine
 * scoped to the project's diameter — earliest milestone on the left,
 * latest on the right — so the user reads the journey naturally left to
 * right while the wander breaks the visual rigidity of a flat line.
 *
 * Milestones without a target date sort to the right (effectively
 * "later/unscheduled"). Ties break by original index so the layout is
 * stable when dates coincide.
 *
 * `radius` is modulated by status: Done milestones get a small +bonus
 * (presence; "this happened"), undated ones get a small −penalty (less
 * concrete). Phase of the wander is seeded by `project.id` so the curve
 * looks organic but never shifts between renders.
 */
export function positionMilestones(project: LaidProject): LaidMilestone[] {
  const milestones = project.project.milestones;
  const n = milestones.length;
  if (n === 0) return [];

  const order = milestones
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const av = a.m.targetDate.trim();
      const bv = b.m.targetDate.trim();
      if (av && bv) return av < bv ? -1 : av > bv ? 1 : a.i - b.i;
      if (av) return -1;
      if (bv) return 1;
      return a.i - b.i;
    });

  const baseR = project.r * 0.18;
  const halfWidth = project.r * 0.7;
  const amplitude = project.r * 0.32;
  const phaseSeed = seededRandom(project.id, 1) * Math.PI * 2;

  return order.map(({ m }, idx) => {
    const t = n === 1 ? 0.5 : idx / (n - 1);
    const x = project.cx - halfWidth + 2 * halfWidth * t;
    const y =
      project.cy + Math.sin(phaseSeed + t * Math.PI * 2.4) * amplitude;
    const isDone = m.status === "Done";
    const hasDate = m.targetDate.trim().length > 0;
    const radius =
      baseR * (isDone ? 1.08 : hasDate ? 1.0 : 0.9);
    return {
      id: m.id,
      projectId: project.id,
      cx: x,
      cy: y,
      r: radius,
      milestone: m,
      color: milestoneColor(m.status, m.targetDate),
    };
  });
}

/**
 * Geometry for the wandering milestone path: the polyline through every
 * milestone center, plus the chronological range used to interpolate the
 * "today" marker. Exposed so the component layer can draw a smooth
 * connector spline without re-deriving the layout.
 */
export interface MilestonePathGeometry {
  /** Polyline points (chronological order). */
  points: { x: number; y: number }[];
  /** Earliest dated milestone targetDate, or "" if all undated. */
  firstYmd: string;
  /** Latest dated milestone targetDate, or "" if all undated. */
  lastYmd: string;
  /** Number of dated milestones — need ≥2 for a meaningful "today" interpolation. */
  datedCount: number;
}

export function getMilestonePathGeometry(
  project: LaidProject
): MilestonePathGeometry {
  const laid = positionMilestones(project);
  const dated = project.project.milestones
    .map((m) => m.targetDate.trim())
    .filter((ymd) => ymd.length > 0)
    .sort();
  return {
    points: laid.map((m) => ({ x: m.cx, y: m.cy })),
    firstYmd: dated[0] ?? "",
    lastYmd: dated[dated.length - 1] ?? "",
    datedCount: dated.length,
  };
}
