import { z } from "zod";

// --- Enums ---

export const PriorityEnum = z.enum(["P0", "P1", "P2", "P3"]);

export const StatusEnum = z.enum([
  "In Progress",
  "Not Started",
  "Planning",
  "Blocked",
  "Ongoing",
  "Demand Testing",
  "Evaluating",
  "Idea",
]);

export const CostOfDelayEnum = z.enum(["High", "Medium", "Low"]);

export const ExecutionModeEnum = z.enum(["Sync", "Async"]);

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
});

export const GoalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  description: z.string().min(1),
  measurableTarget: z.string().default(""),
  currentValue: z.string().default(""),
  impactScore: z.number().int().min(1).max(5).default(3),
  /** Confidence in achieving this goal (1–5 band). */
  confidenceScore: z.number().int().min(1).max(5).default(3),
  costOfDelay: CostOfDelayEnum.default("Medium"),
  ownerId: z.string().default(""),
  priority: PriorityEnum.default("P2"),
  executionMode: ExecutionModeEnum.default("Async"),
  slackChannel: z.string().default(""),
  lastReviewed: z.string().default(""),
  status: StatusEnum.default("Not Started"),
  /** Executive signal: goal needs attention (mutually exclusive with spotlight) */
  atRisk: z.boolean().default(false),
  /** Executive signal: highlight win or momentum (mutually exclusive with atRisk) */
  spotlight: z.boolean().default(false),
});

export const ProjectSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  name: z.string().min(1),
  ownerId: z.string().default(""),
  assigneeIds: z.array(z.string()).default([]),
  type: ProjectTypeEnum.default("Engineering"),
  priority: PriorityEnum.default("P2"),
  status: StatusEnum.default("Not Started"),
  complexityScore: z.number().int().min(1).max(5).default(3),
  definitionOfDone: z.string().default(""),
  startDate: z.string().default(""),
  targetDate: z.string().default(""),
  slackUrl: z.string().default(""),
  lastReviewed: z.string().default(""),
  /** Executive signal: project needs attention (mutually exclusive with spotlight) */
  atRisk: z.boolean().default(false),
  /** Executive signal: highlight win or momentum (mutually exclusive with atRisk) */
  spotlight: z.boolean().default(false),
});

export const MilestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  status: MilestoneStatusEnum.default("Not Done"),
  targetDate: z.string().default(""),
});

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().default(""),
  /** Team grouping for roster and tracker owner filter, e.g. Sales, Marketing */
  department: z.string().default(""),
  autonomyScore: z.number().int().min(1).max(5).default(3),
  slackHandle: z.string().default(""),
  /** Site path to profile image under public/, e.g. /uploads/people/robby.png */
  profilePicturePath: z.string().default(""),
  /** Calendar date (YYYY-MM-DD) when the person joined */
  joinDate: z.string().default(""),
  /** Contractor/agency vs salaried in-house team */
  outsourced: z.boolean().default(false),
});

// --- Root data store ---

export const TrackerDataSchema = z.object({
  companies: z.array(CompanySchema),
  goals: z.array(GoalSchema),
  projects: z.array(ProjectSchema),
  milestones: z.array(MilestoneSchema),
  people: z.array(PersonSchema),
});
