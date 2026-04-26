import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";
import type { Person, Priority } from "@/lib/types/tracker";
import {
  companyActivityScore,
  goalCategoryFor,
  isProjectAtRisk,
  isProjectStale,
  milestoneColor,
  PRIORITY_COLOR,
  PRIORITY_RADIUS_KICKER,
  projectCategoryFor,
  projectColor,
} from "./atlas-activity";
import type {
  AtlasSection,
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
  const placed: PlacedCircle[] = [];
  const canvasRect = {
    x: 40,
    y: 40,
    width: CANVAS_W - 80,
    height: CANVAS_H - 80,
  };

  withScores.forEach((entry) => {
    const r = Math.max(
      MIN_COMPANY_R,
      MIN_COMPANY_R + (MAX_COMPANY_R - MIN_COMPANY_R) * (entry.activity / 100)
    );

    const { cx, cy } = placeCircleInRect(
      placed,
      r,
      canvasRect,
      entry.company.id,
      14,
      0
    );
    placed.push({ cx, cy, r });
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

interface PlacedCircle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Pick a non-overlapping center for a circle of radius `r` inside an
 * arbitrary rectangle (in canvas viewBox coordinates). Generic over any
 * `PlacedCircle[]`. Tries `attempts` random candidates, then falls back to
 * a deterministic grid sweep that *guarantees* no overlap with `placed`
 * provided the rectangle has any unoccupied cell.
 *
 * The grid fallback is critical for tight sections (priority quadrants,
 * crowded department buckets) where rejection sampling can trip on its
 * own probability tail and otherwise pile bubbles on a corner.
 */
function placeCircleInRect(
  placed: readonly PlacedCircle[],
  r: number,
  rect: { x: number; y: number; width: number; height: number },
  seed: string,
  pad = 14,
  reservedTop = 0
): { cx: number; cy: number } {
  const minX = rect.x + r + pad;
  const maxX = rect.x + rect.width - r - pad;
  const minY = rect.y + reservedTop + r + pad;
  const maxY = rect.y + rect.height - r - pad;

  if (maxX <= minX || maxY <= minY) {
    // Rect is too small for this bubble — center it and let the caller
    // deal with sizing on the next pass. Better than NaN.
    return {
      cx: rect.x + rect.width / 2,
      cy: rect.y + reservedTop + (rect.height - reservedTop) / 2,
    };
  }

  for (let attempt = 0; attempt < 240; attempt++) {
    const cx = minX + (maxX - minX) * seededRandom(seed, attempt * 2);
    const cy = minY + (maxY - minY) * seededRandom(seed, attempt * 2 + 1);
    const ok = placed.every(
      (p) => Math.hypot(cx - p.cx, cy - p.cy) >= p.r + r + pad
    );
    if (ok) return { cx, cy };
  }

  // Deterministic grid fallback — guarantees non-overlap if the rect has
  // any cell where a circle of radius r doesn't collide with existing
  // placements. Step size is 2r + small pad so adjacent grid cells just
  // barely touch.
  const step = 2 * r + pad;
  for (let cy = minY; cy <= maxY; cy += step) {
    for (let cx = minX; cx <= maxX; cx += step) {
      const ok = placed.every(
        (p) => Math.hypot(cx - p.cx, cy - p.cy) >= p.r + r + pad * 0.5
      );
      if (ok) return { cx, cy };
    }
  }

  // Last resort — center of rect. Only hit when the rect is fully packed
  // and we have to oversubscribe.
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** P0 first, then P1, P2, P3; ties break alphabetically by description. */
function priorityFirstThenName(a: GoalWithProjects, b: GoalWithProjects): number {
  const ord: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const da = ord[a.priority] ?? 9;
  const db = ord[b.priority] ?? 9;
  if (da !== db) return da - db;
  return a.description.localeCompare(b.description);
}

const MIN_GOAL_R = 38;
const MAX_GOAL_R = 130;

const SECTION_CANVAS_MARGIN = 36;
const SECTION_GAP = 16;
const SECTION_HEADER_H = 30;
const SECTION_INNER_PAD = 10;

/**
 * Build the level-1 sections for a given grouping. Each section is a
 * rectangular region of the canvas where goals of the same category live.
 *
 * - "goal" (Ungrouped) — a single section spanning the canvas (no
 *   visible chrome, acts as a generous pack region).
 * - "priority" — fixed 2×2 quadrant: Urgent top-left, High top-right,
 *   Normal bottom-left, Low bottom-right. All four are always present
 *   even when empty so the layout reads consistently.
 * - "department" / "owner" — N sections (one per category found),
 *   arranged in a square-ish grid.
 */
export function buildGoalSections(
  goals: readonly GoalWithProjects[],
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): AtlasSection[] {
  if (grouping === "goal") {
    return [
      {
        key: "all",
        label: "",
        color: "#3f3f46",
        x: SECTION_CANVAS_MARGIN,
        y: SECTION_CANVAS_MARGIN,
        width: CANVAS_W - 2 * SECTION_CANVAS_MARGIN,
        height: CANVAS_H - 2 * SECTION_CANVAS_MARGIN,
        goalCount: goals.length,
      },
    ];
  }

  // Count goals per category so empty buckets stay out of the layout
  // (except priority where all four are reserved on principle).
  const counts = new Map<string, number>();
  const categories = new Map<
    string,
    { key: string; label: string; color: string }
  >();
  for (const goal of goals) {
    const cat = goalCategoryFor(goal, grouping, peopleById);
    counts.set(cat.key, (counts.get(cat.key) ?? 0) + 1);
    categories.set(cat.key, cat);
  }

  let ordered: { key: string; label: string; color: string; count: number }[];
  if (grouping === "priority") {
    const priorities: Priority[] = ["P0", "P1", "P2", "P3"];
    ordered = priorities.map((p) => ({
      key: p,
      label: PRIORITY_MENU_LABEL[p].toUpperCase(),
      color: PRIORITY_COLOR[p],
      count: counts.get(p) ?? 0,
    }));
  } else {
    ordered = [...categories.values()]
      .map((c) => ({ ...c, label: c.label.toUpperCase(), count: counts.get(c.key) ?? 0 }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }

  const N = ordered.length;
  const cols = grouping === "priority" ? 2 : Math.max(1, Math.ceil(Math.sqrt(N)));
  const rows = Math.ceil(N / cols);

  const usableW = CANVAS_W - 2 * SECTION_CANVAS_MARGIN - (cols - 1) * SECTION_GAP;
  const usableH = CANVAS_H - 2 * SECTION_CANVAS_MARGIN - (rows - 1) * SECTION_GAP;
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  return ordered.map((bucket, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      x: SECTION_CANVAS_MARGIN + col * (cellW + SECTION_GAP),
      y: SECTION_CANVAS_MARGIN + row * (cellH + SECTION_GAP),
      width: cellW,
      height: cellH,
      goalCount: bucket.count,
    };
  });
}

/**
 * Level-2 sections: partition projects of the focused goal the same way
 * `buildGoalSections` does for company goals.
 */
export function buildProjectSections(
  projects: readonly ProjectWithMilestones[],
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): AtlasSection[] {
  if (grouping === "goal") {
    return [
      {
        key: "all",
        label: "",
        color: "#3f3f46",
        x: SECTION_CANVAS_MARGIN,
        y: SECTION_CANVAS_MARGIN,
        width: CANVAS_W - 2 * SECTION_CANVAS_MARGIN,
        height: CANVAS_H - 2 * SECTION_CANVAS_MARGIN,
        goalCount: projects.length,
      },
    ];
  }

  const counts = new Map<string, number>();
  const categories = new Map<
    string,
    { key: string; label: string; color: string }
  >();
  for (const project of projects) {
    const cat = projectCategoryFor(project, grouping, peopleById);
    counts.set(cat.key, (counts.get(cat.key) ?? 0) + 1);
    categories.set(cat.key, cat);
  }

  let ordered: { key: string; label: string; color: string; count: number }[];
  if (grouping === "priority") {
    const priorities: Priority[] = ["P0", "P1", "P2", "P3"];
    ordered = priorities.map((p) => ({
      key: p,
      label: PRIORITY_MENU_LABEL[p].toUpperCase(),
      color: PRIORITY_COLOR[p],
      count: counts.get(p) ?? 0,
    }));
  } else {
    ordered = [...categories.values()]
      .map((c) => ({
        ...c,
        label: c.label.toUpperCase(),
        count: counts.get(c.key) ?? 0,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }

  const N = ordered.length;
  const cols = grouping === "priority" ? 2 : Math.max(1, Math.ceil(Math.sqrt(N)));
  const rows = Math.ceil(N / cols);

  const usableW = CANVAS_W - 2 * SECTION_CANVAS_MARGIN - (cols - 1) * SECTION_GAP;
  const usableH = CANVAS_H - 2 * SECTION_CANVAS_MARGIN - (rows - 1) * SECTION_GAP;
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  return ordered.map((bucket, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      x: SECTION_CANVAS_MARGIN + col * (cellW + SECTION_GAP),
      y: SECTION_CANVAS_MARGIN + row * (cellH + SECTION_GAP),
      width: cellW,
      height: cellH,
      goalCount: bucket.count,
    };
  });
}

/**
 * Place every goal of the focused company across the canvas, grouped into
 * sections per the active `GroupingKey`. The sections are returned
 * alongside the laid goals so the parent component can render the
 * section backgrounds + headers without re-deriving anything.
 *
 * Within each section, goals never overlap — we use rejection sampling
 * and fall back to a deterministic grid sweep when the section is tight,
 * so the visual stays clean at every density.
 */
export function layoutGoalsInEther(
  company: LaidCompany,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): { goals: LaidGoal[]; sections: AtlasSection[] } {
  const goals = company.company.goals;
  if (goals.length === 0) {
    return { goals: [], sections: [] };
  }

  const maxProjects = Math.max(
    1,
    ...goals.map((g) => g.projects.filter((p) => !p.isMirror).length)
  );

  const sections = buildGoalSections(goals, grouping, peopleById);
  const sectionByKey = new Map<string, AtlasSection>();
  for (const s of sections) sectionByKey.set(s.key, s);

  // Group goals by their section key so we can size each section's bubbles
  // based on its own count, not the total.
  const goalsBySection = new Map<string, GoalWithProjects[]>();
  for (const goal of goals) {
    const cat = goalCategoryFor(goal, grouping, peopleById);
    const key = grouping === "goal" ? "all" : cat.key;
    if (!goalsBySection.has(key)) goalsBySection.set(key, []);
    goalsBySection.get(key)!.push(goal);
  }

  const result: LaidGoal[] = [];

  for (const section of sections) {
    const sectionGoals = goalsBySection.get(section.key) ?? [];
    if (sectionGoals.length === 0) continue;

    const sortedGoals = [...sectionGoals].sort(priorityFirstThenName);

    // Section-aware radius envelope: target ~30% packing density inside
    // the section's interior so rejection sampling has room to maneuver.
    const reservedTop = grouping === "goal" ? 0 : SECTION_HEADER_H;
    const innerW = Math.max(40, section.width - 2 * SECTION_INNER_PAD);
    const innerH = Math.max(40, section.height - reservedTop - 2 * SECTION_INNER_PAD);
    const sectionArea = innerW * innerH;
    const targetDensity = grouping === "goal" ? 0.32 : 0.28;
    const fitR = Math.sqrt(
      (targetDensity * sectionArea) / (Math.PI * Math.max(1, sectionGoals.length))
    );
    const rectMaxR = Math.min(innerW, innerH) * 0.45;
    const sectionMaxR = Math.min(MAX_GOAL_R, fitR, rectMaxR);
    const sectionMinR = Math.min(MIN_GOAL_R, sectionMaxR * 0.65);

    // Place goals (priority-first) inside this section's rectangle.
    const placedInSection: PlacedCircle[] = [];
    sortedGoals.forEach((goal, idx) => {
      const projects = goal.projects.filter((p) => !p.isMirror);
      const projectCount = projects.length;
      const baseFrac = 0.45 + 0.55 * (projectCount / maxProjects);
      const r = Math.max(
        sectionMinR,
        Math.min(
          sectionMaxR,
          (sectionMinR + (sectionMaxR - sectionMinR) * baseFrac) *
            PRIORITY_RADIUS_KICKER[goal.priority]
        )
      );

      const cat = goalCategoryFor(goal, grouping, peopleById);
      const seed = `${company.id}:${goal.id}:${grouping}:${idx}`;
      const { cx, cy } = placeCircleInRect(
        placedInSection,
        r,
        section,
        seed,
        14,
        reservedTop
      );

      placedInSection.push({ cx, cy, r });
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
    });
  }

  return { goals: result, sections };
}

const MIN_PROJECT_R = 45;
const MAX_PROJECT_R = 120;

/**
 * Place projects of one focused goal across the canvas. When grouping is
 * not "goal" (ungrouped), uses the same section grid as goals (Owner /
 * Department / Priority). Non-overlap guarantees match `layoutGoalsInEther`.
 */
export function layoutProjectsInEther(
  goal: LaidGoal,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): { projects: LaidProject[]; sections: AtlasSection[] } {
  const projects = goal.projects.filter((p) => !p.isMirror);
  if (projects.length === 0) {
    return { projects: [], sections: [] };
  }

  const maxMilestones = Math.max(
    1,
    ...projects.map((p) => p.milestones.length)
  );

  const sections = buildProjectSections(projects, grouping, peopleById);

  const projectsBySection = new Map<string, ProjectWithMilestones[]>();
  for (const project of projects) {
    const cat = projectCategoryFor(project, grouping, peopleById);
    const key = grouping === "goal" ? "all" : cat.key;
    if (!projectsBySection.has(key)) projectsBySection.set(key, []);
    projectsBySection.get(key)!.push(project);
  }

  const result: LaidProject[] = [];

  for (const section of sections) {
    const sectionProjects = projectsBySection.get(section.key) ?? [];
    if (sectionProjects.length === 0) continue;

    const sorted = [...sectionProjects].sort((a, b) => {
      const ord: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      const da = ord[a.priority] ?? 9;
      const db = ord[b.priority] ?? 9;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });

    const reservedTop = grouping === "goal" ? 0 : SECTION_HEADER_H;
    const innerW = Math.max(40, section.width - 2 * SECTION_INNER_PAD);
    const innerH = Math.max(40, section.height - reservedTop - 2 * SECTION_INNER_PAD);
    const sectionArea = innerW * innerH;
    const targetDensity = grouping === "goal" ? 0.32 : 0.28;
    const fitR = Math.sqrt(
      (targetDensity * sectionArea) / (Math.PI * Math.max(1, sectionProjects.length))
    );
    const rectMaxR = Math.min(innerW, innerH) * 0.45;
    const sectionMaxR = Math.min(MAX_PROJECT_R, fitR, rectMaxR);
    const sectionMinR = Math.min(MIN_PROJECT_R, sectionMaxR * 0.65);

    const placedInSection: PlacedCircle[] = [];
    sorted.forEach((project, idx) => {
      const baseFrac =
        0.55 + 0.45 * (project.milestones.length / maxMilestones);
      const r = Math.max(
        sectionMinR,
        Math.min(
          sectionMaxR,
          (sectionMinR + (sectionMaxR - sectionMinR) * baseFrac) *
            PRIORITY_RADIUS_KICKER[project.priority]
        )
      );
      const seed = `${goal.id}:${project.id}:${grouping}:${idx}`;
      const { cx, cy } = placeCircleInRect(
        placedInSection,
        r,
        section,
        seed,
        14,
        reservedTop
      );
      placedInSection.push({ cx, cy, r });
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
    });
  }

  return { projects: result, sections };
}

/**
 * Inner layout for one focused company. Returns the goals plus the
 * sections used to lay them out (so the renderer can draw the section
 * chrome at level 1).
 */
export function layoutCompanyInner(
  company: LaidCompany,
  grouping: GroupingKey,
  peopleById: Map<string, Person>
): { goals: LaidGoal[]; sections: AtlasSection[] } {
  return layoutGoalsInEther(company, grouping, peopleById);
}

const MIN_MILESTONE_R = 30;
const MAX_MILESTONE_R = 70;

/**
 * Place milestones along a chronologically-ordered, gently-wandering path
 * spanning most of the canvas width. Earliest milestone on the left,
 * latest on the right — the user reads the journey naturally left-to-right
 * while the wander breaks the visual rigidity of a flat line.
 *
 * Milestones without a target date sort to the right ("later /
 * unscheduled"). Ties break by original index so the layout is stable when
 * dates coincide.
 *
 * Radius is modulated by status: Done milestones get a small + bonus
 * (presence; "this happened"), undated ones get a small − penalty. Phase
 * of the wander is seeded by `project.id` so the curve looks organic but
 * never shifts between renders.
 */
export function positionMilestones(
  project: LaidProject,
  asOf: Date = new Date()
): LaidMilestone[] {
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

  // Path geometry — span 80% of the canvas width, centered vertically.
  const xMargin = CANVAS_W * 0.1;
  const xLeft = xMargin;
  const xRight = CANVAS_W - xMargin;
  const yCenter = CANVAS_H * 0.5;
  const amplitude = CANVAS_H * 0.18;
  const phaseSeed = seededRandom(project.id, 1) * Math.PI * 2;

  // Adapt milestone size to count so they don't overlap horizontally. Width
  // per slot = pathWidth / max(n, 1); milestone diameter ≤ 0.7 of a slot
  // leaves a 30% gap between adjacent milestones.
  const pathWidth = xRight - xLeft;
  const slotWidth = pathWidth / Math.max(1, n);
  const dynamicMax = slotWidth * 0.42;
  const effectiveMaxR = Math.min(MAX_MILESTONE_R, dynamicMax);
  const effectiveMinR = Math.min(MIN_MILESTONE_R, effectiveMaxR * 0.6);

  return order.map(({ m }, idx) => {
    const t = n === 1 ? 0.5 : idx / (n - 1);
    const x = xLeft + t * pathWidth;
    const y = yCenter + Math.sin(phaseSeed + t * Math.PI * 2.4) * amplitude;
    const isDone = m.status === "Done";
    const hasDate = m.targetDate.trim().length > 0;
    const baseR = effectiveMinR + (effectiveMaxR - effectiveMinR) * 0.7;
    const radius = baseR * (isDone ? 1.1 : hasDate ? 1.0 : 0.85);
    return {
      id: m.id,
      projectId: project.id,
      cx: x,
      cy: y,
      r: Math.max(effectiveMinR, Math.min(effectiveMaxR, radius)),
      milestone: m,
      color: milestoneColor(m.status, m.targetDate, asOf),
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
  project: LaidProject,
  asOf: Date = new Date()
): MilestonePathGeometry {
  const laid = positionMilestones(project, asOf);
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
