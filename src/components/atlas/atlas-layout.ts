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
  const maxProjects = Math.max(...buckets.map((b) => b.projects.length));

  const groups: LaidGroup[] = [];
  const projects: LaidProject[] = [];

  buckets.forEach((bucket, i) => {
    const groupR =
      nGroups === 1
        ? maxGroupR
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

/** Milestones on a ring inside one project. */
export function positionMilestones(project: LaidProject): LaidMilestone[] {
  const milestones = project.project.milestones;
  const n = milestones.length;
  if (n === 0) return [];

  const ringR = project.r * 0.55;
  return milestones.map((m, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      id: m.id,
      projectId: project.id,
      cx: project.cx + Math.cos(angle) * ringR,
      cy: project.cy + Math.sin(angle) * ringR,
      r: project.r * 0.2,
      milestone: m,
      color: milestoneColor(m.status, m.targetDate),
    };
  });
}
