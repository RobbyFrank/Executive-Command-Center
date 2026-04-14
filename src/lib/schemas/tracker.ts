import { z } from "zod";
import { SLACK_USER_ID_RE } from "@/lib/slackUserId";
import {
  isValidPersonEmail,
  isValidPersonPhone,
} from "@/lib/personContactValidation";

// --- Enums ---

export const PriorityEnum = z.enum(["P0", "P1", "P2", "P3"]);

/** Goal-level delivery status (Roadmap goal fields / filters). */
export const GoalStatusEnum = z.enum([
  "In Progress",
  "Not Started",
  "Planning",
  "Blocked",
  "Ongoing",
  "Demand Testing",
  "Evaluating",
  "Idea",
]);

/**
 * Project-level workflow status. Legacy JSON values are coerced on load
 * (e.g. `Blocked` → `Stuck`, `Not Started` → `Pending`).
 */
export const ProjectStatusEnum = z.enum([
  "Idea",
  "Pending",
  "In Progress",
  "Stuck",
  "For Review",
  "Done",
]);

const LEGACY_PROJECT_STATUS: Record<string, string> = {
  "Not Started": "Pending",
  Planning: "Idea",
  Blocked: "Stuck",
  Ongoing: "In Progress",
  "Demand Testing": "In Progress",
  Evaluating: "In Progress",
  "In Progress": "In Progress",
  Idea: "Idea",
  Pending: "Pending",
  Stuck: "Stuck",
  "For Review": "For Review",
  Done: "Done",
};

function normalizeProjectStatusRaw(input: unknown): string {
  if (input === undefined || input === null) return "Pending";
  const s = String(input);
  if ((ProjectStatusEnum.options as string[]).includes(s)) return s;
  return LEGACY_PROJECT_STATUS[s] ?? "Pending";
}

/** @deprecated Use `GoalStatusEnum` or `ProjectStatusEnum`. */
export const StatusEnum = GoalStatusEnum;

export const CostOfDelayEnum = z.enum(["High", "Medium", "Low"]);

export const ProjectTypeEnum = z.enum([
  "Engineering",
  "Product",
  "Sales",
  "Strategic",
  "Operations",
  "Hiring",
  "Marketing",
]);

export const MilestoneStatusEnum = z.enum(["Done", "Not Done"]);

/** One dated feedback entry from a review (goal or project). */
export const ReviewLogEntrySchema = z.object({
  id: z.string(),
  /** ISO timestamp when the note was recorded */
  at: z.string(),
  text: z.string().min(1),
});

// --- Entities ---

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Short label for UI (e.g. VD, 1L) — used in Team company lists */
  shortName: z.string().min(1),
  /**
   * Monthly MRR in **thousands of USD** (0–999). E.g. 220 → $220K. Legacy JSON
   * with full-dollar amounts is coerced on load (values over 999 → ÷ 1000).
   */
  revenue: z.preprocess(
    (val) => {
      if (typeof val === "number" && Number.isFinite(val) && val > 999) {
        return Math.round(val / 1000);
      }
      return val;
    },
    z.number().int().min(0).max(999).default(0)
  ),
  /** Site path to file under public/, e.g. /uploads/companies/voicedrop.png */
  logoPath: z.string().default(""),
  /** Calendar date (YYYY-MM-DD) when development began */
  developmentStartDate: z.string().default(""),
  /** Calendar date (YYYY-MM-DD) when the product/company launched */
  launchDate: z.string().default(""),
  /** Public company website (https://…); empty if unset */
  website: z.string().default(""),
  /**
   * Free-form description (same editing pattern as goal **Description** / `measurableTarget` on Roadmap).
   */
  description: z.string().default(""),
});

export const GoalSchema = z.object({
  id: z.string(),
  /** Local calendar date (YYYY-MM-DD) when the goal was created; not shown in UI. Empty for legacy rows. */
  createdAt: z.string().default(""),
  companyId: z.string(),
  description: z.string().min(1),
  measurableTarget: z.string().default(""),
  /** What we stand to gain; why achieving this goal matters (Roadmap **Why** column). */
  whyItMatters: z.string().default(""),
  currentValue: z.string().default(""),
  impactScore: z.number().int().min(1).max(5).default(3),
  /** Confidence in achieving this goal (0–5 band; legacy / unused on Roadmap grid). */
  confidenceScore: z.number().int().min(0).max(5).default(0),
  costOfDelay: z
    .preprocess(
      (v) =>
        v === "High" ? 4 : v === "Medium" ? 3 : v === "Low" ? 2 : v,
      z.number().int().min(1).max(5).default(3),
    ),
  ownerId: z.string().default(""),
  priority: PriorityEnum.default("P2"),
  slackChannel: z.string().default(""),
  /** Slack channel ID (e.g. C0G9QF9GW); empty when set manually without the picker. */
  slackChannelId: z.string().default(""),
  lastReviewed: z.string().default(""),
  status: GoalStatusEnum.default("Not Started"),
  /** Executive signal: goal needs attention (mutually exclusive with spotlight) */
  atRisk: z.boolean().default(false),
  /** Executive signal: highlight win or momentum (mutually exclusive with atRisk) */
  spotlight: z.boolean().default(false),
  /** Optional dated notes from reviews (newest-first in UI). */
  reviewLog: z.array(ReviewLogEntrySchema).default([]),
});

export const ProjectSchema = z.object({
  id: z.string(),
  /** Local calendar date (YYYY-MM-DD) when the project was created; not shown in UI. Empty for legacy rows. */
  createdAt: z.string().default(""),
  goalId: z.string(),
  /**
   * Additional goals where this project is mirrored (shown under those goals).
   * Primary goal remains `goalId`.
   */
  mirroredGoalIds: z.array(z.string()).default([]),
  /**
   * When set, this project is considered blocked until that project's milestones
   * are all done. Empty string means not blocked.
   */
  blockedByProjectId: z.string().default(""),
  name: z.string().min(1),
  /** Outcome or scope (Roadmap **Description** column; aligns under goal Description). */
  description: z.string().default(""),
  ownerId: z.string().default(""),
  assigneeIds: z.array(z.string()).default([]),
  type: ProjectTypeEnum.default("Engineering"),
  priority: PriorityEnum.default("P2"),
  status: z.preprocess(
    normalizeProjectStatusRaw,
    ProjectStatusEnum
  ).default("Pending"),
  complexityScore: z.number().int().min(1).max(5).default(3),
  definitionOfDone: z.string().default(""),
  startDate: z.string().default(""),
  targetDate: z.string().default(""),
  /** @deprecated Slack threads are now tracked per-milestone. Kept for backward-compat on load. */
  slackUrl: z.string().default(""),
  lastReviewed: z.string().default(""),
  /** Executive signal: project needs attention (mutually exclusive with spotlight) */
  atRisk: z.boolean().default(false),
  /** Executive signal: highlight win or momentum (mutually exclusive with atRisk) */
  spotlight: z.boolean().default(false),
  /** Optional dated notes from reviews (newest-first in UI). */
  reviewLog: z.array(ReviewLogEntrySchema).default([]),
});

export const MilestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  status: MilestoneStatusEnum.default("Not Done"),
  targetDate: z.string().default(""),
  slackUrl: z.string().default(""),
});

/** How someone is engaged: staff vs hourly in-house vs external. */
export const EmploymentKindEnum = z.enum([
  "inhouse_salaried",
  "inhouse_hourly",
  "outsourced",
]);

const PersonInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().default(""),
  /** Team grouping for roster and tracker owner filter, e.g. Sales, Marketing */
  department: z.string().default(""),
  autonomyScore: z.number().int().min(1).max(5).default(3),
  slackHandle: z
    .string()
    .default("")
    .transform((s) => s.trim())
    .refine((s) => s === "" || SLACK_USER_ID_RE.test(s), {
      message:
        "Slack user ID must be U + 10 characters (e.g. U09684T0D0X) or empty.",
    })
    .transform((s) => (s === "" ? "" : s.toUpperCase())),
  /** Site path to profile image under public/, e.g. /uploads/people/robby.png */
  profilePicturePath: z.string().default(""),
  /** Calendar date (YYYY-MM-DD) when the person joined */
  joinDate: z.string().default(""),
  /** Work email (optional). Invalid stored values are cleared on load (legacy / bad data). */
  email: z
    .string()
    .default("")
    .transform((s) => s.trim())
    .transform((s) => (isValidPersonEmail(s) ? s : "")),
  /** Phone (optional). Invalid stored values are cleared on load (legacy / bad data). */
  phone: z
    .string()
    .default("")
    .transform((s) => s.trim())
    .transform((s) => (isValidPersonPhone(s) ? s : "")),
  /** Estimated gross monthly compensation in USD (whole dollars). */
  estimatedMonthlySalary: z.number().min(0).default(0),
  employment: EmploymentKindEnum.optional(),
  /** Legacy: prefer `employment` when present */
  outsourced: z.boolean().optional(),
  /**
   * Founder flag (Team roster). When omitted, legacy ids `robby` / `nadav` still
   * count as founders; explicit `false` opts out.
   */
  isFounder: z.boolean().optional(),
});

export const PersonSchema = PersonInputSchema.transform((p) => {
  const employment =
    p.employment ??
    (p.outsourced === true ? "outsourced" : "inhouse_salaried");
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    department: p.department,
    autonomyScore: p.autonomyScore,
    slackHandle: p.slackHandle,
    profilePicturePath: p.profilePicturePath,
    joinDate: p.joinDate,
    email: p.email,
    phone: p.phone,
    estimatedMonthlySalary: Math.max(
      0,
      Math.round(Number.isFinite(p.estimatedMonthlySalary) ? p.estimatedMonthlySalary : 0)
    ),
    employment,
    ...(p.isFounder !== undefined ? { isFounder: p.isFounder } : {}),
  };
});

// --- Root data store ---

/**
 * Optimistic-lock generation. `0` = never persisted (empty KV). Stored docs use
 * `>= 1`. Legacy JSON without `revision` is treated as `1` on load.
 */
export const TrackerDataSchema = z.object({
  revision: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return 1;
      if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
      return 1;
    },
    z.number().int().min(0)
  ),
  companies: z.array(CompanySchema),
  goals: z.array(GoalSchema),
  projects: z.array(ProjectSchema),
  milestones: z.array(MilestoneSchema),
  people: z.array(PersonSchema),
});
