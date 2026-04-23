import type { Person } from "@/lib/types/tracker";
import {
  bucketsForCompany,
  companyActivityScore,
  isProjectAtRisk,
  isProjectStale,
  milestoneColor,
  projectColor,
  type GroupBucket,
} from "./atlas-activity";
import type {
  CompanyWithGoals,
  GroupingKey,
  LaidCompany,
  LaidGroup,
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

  // Sort descending by activity so the biggest lands first.
  withScores.sort((a, b) => b.activity - a.activity);

  const result: LaidCompany[] = [];
  const margin = 40;

  withScores.forEach((entry, index) => {
    const r = Math.max(
      MIN_COMPANY_R,
      MIN_COMPANY_R + (MAX_COMPANY_R - MIN_COMPANY_R) * (entry.activity / 100)
    );

    const { cx, cy } = placeCircle(result, r, margin, index, entry.company.id);
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
 * Pick a non-overlapping center for a circle of radius `r`. Tries seeded
 * candidates; falls back to a ring around the canvas center if all collide.
 */
function placeCircle(
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
      (p) =>
        Math.hypot(cx - p.cx, cy - p.cy) >= p.r + r + pad
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
 * Lay out the inside of one company: grouping circles on a ring, and projects
 * placed on an inner ring within each group. Milestones are placed on demand
 * via {@link positionMilestones}.
 */
export function layoutCompanyInner(
  company: LaidCompany,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): { groups: LaidGroup[]; projects: LaidProject[] } {
  const buckets = bucketsForCompany(company.company, grouping, peopleById);
  if (buckets.length === 0) {
    return { groups: [], projects: [] };
  }

  const nGroups = buckets.length;
  const ringR = company.r * 0.5;
  const maxGroupR =
    nGroups === 1
      ? company.r * 0.7
      : Math.min(
          company.r * 0.42,
          ringR * Math.sin(Math.PI / nGroups) * 0.92
        );
  const maxProjects = Math.max(1, ...buckets.map((b) => b.projects.length));

  const groups: LaidGroup[] = [];
  const projects: LaidProject[] = [];

  buckets.forEach((bucket, i) => {
    // Empty buckets (goals without projects) collapse to the minimum ring
    // size so they're still visible but don't claim space from populated
    // goals.
    const groupR =
      nGroups === 1
        ? maxGroupR
        : bucket.projects.length === 0
          ? maxGroupR * 0.45
          : Math.max(
              maxGroupR * 0.5,
              maxGroupR * Math.sqrt(bucket.projects.length / maxProjects)
            );
    const angle =
      nGroups === 1 ? 0 : (i / nGroups) * Math.PI * 2 - Math.PI / 2;
    const gcx =
      nGroups === 1 ? company.cx : company.cx + Math.cos(angle) * ringR;
    const gcy =
      nGroups === 1 ? company.cy : company.cy + Math.sin(angle) * ringR;

    const groupId = `${company.id}:${grouping}:${bucket.key}`;
    groups.push({
      id: groupId,
      bucketKey: bucket.key,
      label: bucket.label,
      color: bucket.color,
      cx: gcx,
      cy: gcy,
      r: groupR,
      projectCount: bucket.projects.length,
      projects: bucket.projects,
    });

    projects.push(
      ...placeProjectsInGroup(bucket, groupId, company.id, gcx, gcy, groupR, grouping, peopleById)
    );
  });

  return { groups, projects };
}

function placeProjectsInGroup(
  bucket: GroupBucket,
  groupId: string,
  companyId: string,
  gcx: number,
  gcy: number,
  groupR: number,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): LaidProject[] {
  const n = bucket.projects.length;
  if (n === 0) return [];

  const toLaid = (
    project: ProjectWithMilestones,
    cx: number,
    cy: number,
    r: number
  ): LaidProject => ({
    id: project.id,
    companyId,
    groupId,
    bucketKey: bucket.key,
    cx,
    cy,
    r,
    project,
    color: projectColor(project, grouping, peopleById),
    isStale: isProjectStale(project),
    isAtRisk: isProjectAtRisk(project),
  });

  if (n === 1) {
    return [toLaid(bucket.projects[0]!, gcx, gcy, groupR * 0.6)];
  }

  const innerRingR = groupR * 0.48;
  const pr = Math.min(
    groupR * 0.4,
    2 * innerRingR * Math.sin(Math.PI / n) * 0.45
  );

  return bucket.projects.map((project, j) => {
    const angle = (j / n) * Math.PI * 2 - Math.PI / 2;
    return toLaid(
      project,
      gcx + Math.cos(angle) * innerRingR,
      gcy + Math.sin(angle) * innerRingR,
      pr * (0.85 + (project.progress / 100) * 0.15)
    );
  });
}

/**
 * Milestones on a chronological arc across the bottom of the project circle.
 *
 * Left-to-right reads like a timeline (earliest `targetDate` first).
 * Milestones without a target date sort to the right (they're effectively
 * "later / unscheduled"). Ties break by original index to keep the layout
 * stable when dates change.
 *
 * The arc spans ~140 degrees under the project center (SVG angles: 160° at
 * the leftmost tip down to 20° on the rightmost). Keeping the sweep below
 * the horizontal diameter keeps the top of the project circle free for the
 * breadcrumb camera target + "today" tick.
 */
export function positionMilestones(project: LaidProject): LaidMilestone[] {
  const milestones = project.project.milestones;
  const n = milestones.length;
  if (n === 0) return [];

  // Sort chronologically; undated milestones drift right.
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

  const ringR = project.r * 0.58;
  // Angles in radians. In SVG: 0 = 3 o'clock, π/2 = 6 o'clock (below).
  const startAngleDeg = 160; // leftmost (≈ 8 o'clock)
  const endAngleDeg = 20; // rightmost (≈ 4 o'clock)
  const startAngle = (startAngleDeg * Math.PI) / 180;
  const endAngle = (endAngleDeg * Math.PI) / 180;

  return order.map(({ m }, idx) => {
    // Evenly distribute; with n === 1 pin to the arc's midpoint.
    const t = n === 1 ? 0.5 : idx / (n - 1);
    const angle = startAngle + (endAngle - startAngle) * t;
    return {
      id: m.id,
      projectId: project.id,
      cx: project.cx + Math.cos(angle) * ringR,
      cy: project.cy + Math.sin(angle) * ringR,
      r: project.r * 0.18,
      milestone: m,
      color: milestoneColor(m.status, m.targetDate),
    };
  });
}

/**
 * Extra geometry for the milestone arc: the path's center/radius + the
 * chronological range used to interpolate the "today" tick. Exposed so the
 * component layer can draw a connector curve under the milestones without
 * re-deriving constants.
 */
export interface MilestoneArcGeometry {
  cx: number;
  cy: number;
  r: number;
  /** Radians, SVG angle (0 = 3 o'clock, π/2 = 6 o'clock). */
  startAngle: number;
  endAngle: number;
  /** Earliest milestone targetDate in the sorted layout, or "" if all undated. */
  firstYmd: string;
  /** Latest dated milestone targetDate in the sorted layout, or "" if all undated. */
  lastYmd: string;
  /** Number of dated milestones — need ≥2 for a meaningful "today" interpolation. */
  datedCount: number;
}

export function getMilestoneArcGeometry(
  project: LaidProject
): MilestoneArcGeometry {
  const dated = project.project.milestones
    .map((m) => m.targetDate.trim())
    .filter((ymd) => ymd.length > 0)
    .sort();
  return {
    cx: project.cx,
    cy: project.cy,
    r: project.r * 0.58,
    startAngle: (160 * Math.PI) / 180,
    endAngle: (20 * Math.PI) / 180,
    firstYmd: dated[0] ?? "",
    lastYmd: dated[dated.length - 1] ?? "",
    datedCount: dated.length,
  };
}
