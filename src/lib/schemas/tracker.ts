import { z } from "zod";
import { SLACK_USER_ID_RE } from "@/lib/slackUserId";
import {
  isValidPersonEmail,
  isValidPersonPhone,
  normalizePersonEmail,
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
 * (e.g. `Not Started` → `Pending`). `Blocked` is reserved for dependency blocks
 * (shown in the UI when another project’s milestones are incomplete); it is not
 * chosen from the status dropdown.
 */
export const ProjectStatusEnum = z.enum([
  "Idea",
  "Pending",
  "In Progress",
  "Stuck",
  "Blocked",
  "For Review",
  "Done",
]);

const LEGACY_PROJECT_STATUS: Record<string, string> = {
  "Not Started": "Pending",
  Planning: "Idea",
  Blocked: "Blocked",
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
  /** When true, listed first on Companies and Roadmap (and company pickers that use tier grouping). */
  pinned: z.boolean().default(false),
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
  autonomyScore: z.number().int().min(0).max(5).default(3),
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
  /** Permalink to Nadav's welcome message in the onboarding group DM (optional). */
  welcomeSlackUrl: z.string().default(""),
  /** Slack channel ID of the onboarding MPIM (optional). */
  welcomeSlackChannelId: z.string().default(""),
  /** Work email (optional). Invalid stored values are cleared on load (legacy / bad data). */
  email: z
    .string()
    .default("")
    .transform((s) => normalizePersonEmail(s))
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
  /**
   * When true, hide this person from the Team page "New hires" strip until their
   * join date changes (cleared automatically in `updatePerson`).
   */
  skippedFromNewHires: z.boolean().optional(),
  /** bcrypt hash for app login; empty means no login. Never expose to the client. */
  passwordHash: z
    .string()
    .default("")
    .transform((s) => s.trim()),
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
    welcomeSlackUrl: p.welcomeSlackUrl,
    welcomeSlackChannelId: p.welcomeSlackChannelId,
    email: p.email,
    phone: p.phone,
    estimatedMonthlySalary: Math.max(
      0,
      Math.round(Number.isFinite(p.estimatedMonthlySalary) ? p.estimatedMonthlySalary : 0)
    ),
    employment,
    passwordHash: p.passwordHash,
    ...(p.isFounder !== undefined ? { isFounder: p.isFounder } : {}),
    ...(p.skippedFromNewHires !== undefined
      ? { skippedFromNewHires: p.skippedFromNewHires }
      : {}),
  };
});

// --- Slack scrape suggestions (AI output, validated before create) ---

export const SlackScrapeEvidenceSchema = z.object({
  channel: z.string().min(1),
  ts: z.string().min(1),
  quote: z.string().min(1),
  /** Slack user id of the message author (filled server-side from transcript). */
  authorSlackUserId: z.string().optional(),
  /** Tracker person id when the author maps to the roster (filled server-side). */
  authorPersonId: z.string().optional(),
});

/** Goal fields proposed for a new goal (ids set server-side). */
export const SlackScrapeGoalDraftSchema = z.object({
  description: z.string().min(1),
  measurableTarget: z.string().default(""),
  whyItMatters: z.string().default(""),
  currentValue: z.string().default(""),
  impactScore: z.number().int().min(1).max(5).default(3),
  priority: PriorityEnum.default("P2"),
  status: GoalStatusEnum.default("Idea"),
  /**
   * Tracker `Person.id` when the model matched an owner from the roster / transcript.
   * `slackChannel` / `slackChannelId` are filled server-side from evidence channels.
   */
  ownerPersonId: z.string().default(""),
  slackChannel: z.string().default(""),
  slackChannelId: z.string().default(""),
});

export const SlackScrapeMilestoneDraftSchema = z.object({
  name: z.string().min(1),
  targetDate: z.string().min(1),
});

/** Project fields proposed for creation (goal id resolved server-side). */
export const SlackScrapeProjectDraftSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  definitionOfDone: z.string().default(""),
  priority: PriorityEnum.default("P2"),
  complexityScore: z.number().int().min(1).max(5).default(3),
  type: ProjectTypeEnum.default("Engineering"),
  milestones: z.array(SlackScrapeMilestoneDraftSchema).default([]),
  /** Tracker `Person.id` for the primary assignee (project `assigneeIds`). */
  assigneePersonId: z.string().default(""),
});

/** Proposed field updates for an existing goal (ids map to `Goal` fields; description is the goal title on Roadmap). */
export const SlackScrapeEditGoalPatchSchema = z
  .object({
    description: z.string().min(1).optional(),
    measurableTarget: z.string().optional(),
    whyItMatters: z.string().optional(),
    currentValue: z.string().optional(),
    ownerPersonId: z.string().optional(),
    slackChannelId: z.string().optional(),
  })
  .refine(
    (p) => Object.values(p).some((v) => v !== undefined),
    { message: "At least one patch field must be set" }
  );

export const SlackScrapeEditProjectPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    assigneePersonId: z.string().optional(),
    status: ProjectStatusEnum.optional(),
    priority: PriorityEnum.optional(),
  })
  .refine(
    (p) => Object.values(p).some((v) => v !== undefined),
    { message: "At least one patch field must be set" }
  );

export const SlackScrapeEditMilestonePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    targetDate: z.string().min(1).optional(),
  })
  .refine(
    (p) => p.name !== undefined || p.targetDate !== undefined,
    { message: "At least one of name or targetDate must be set" }
  );

export const SlackScrapeSuggestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("newGoalWithProjects"),
    goal: SlackScrapeGoalDraftSchema,
    projects: z.array(SlackScrapeProjectDraftSchema).default([]),
    evidence: z.array(SlackScrapeEvidenceSchema).min(1),
    rationale: z.string().default(""),
  }),
  z.object({
    kind: z.literal("newProjectOnExistingGoal"),
    existingGoalId: z.string().min(1),
    project: SlackScrapeProjectDraftSchema,
    evidence: z.array(SlackScrapeEvidenceSchema).min(1),
    rationale: z.string().default(""),
  }),
  z.object({
    kind: z.literal("editGoal"),
    existingGoalId: z.string().min(1),
    patch: SlackScrapeEditGoalPatchSchema,
    evidence: z.array(SlackScrapeEvidenceSchema).min(1),
    rationale: z.string().min(1),
  }),
  z.object({
    kind: z.literal("editProject"),
    existingProjectId: z.string().min(1),
    patch: SlackScrapeEditProjectPatchSchema,
    evidence: z.array(SlackScrapeEvidenceSchema).min(1),
    rationale: z.string().min(1),
  }),
  z.object({
    kind: z.literal("addMilestoneToExistingProject"),
    existingProjectId: z.string().min(1),
    milestone: SlackScrapeMilestoneDraftSchema,
    evidence: z.array(SlackScrapeEvidenceSchema).min(1),
    rationale: z.string().min(1),
  }),
  z.object({
    kind: z.literal("editMilestone"),
    existingMilestoneId: z.string().min(1),
    patch: SlackScrapeEditMilestonePatchSchema,
    evidence: z.array(SlackScrapeEvidenceSchema).min(1),
    rationale: z.string().min(1),
  }),
]);

export type SlackScrapeSuggestion = z.infer<typeof SlackScrapeSuggestionSchema>;

// --- Pending Slack sync queue (Upstash) ---

export const SlackSuggestionStatusEnum = z.enum([
  "pending",
  "approved",
  "rejected",
]);

export const SlackSuggestionRecordSchema = z.object({
  id: z.string(),
  companyId: z.string().min(1),
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
  status: SlackSuggestionStatusEnum.default("pending"),
  dedupeKey: z.string().min(1),
  rationale: z.string().default(""),
  payload: SlackScrapeSuggestionSchema,
});

export type SlackSuggestionRecord = z.infer<typeof SlackSuggestionRecordSchema>;

export const SlackSuggestionsDataSchema = z.object({
  revision: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return 0;
      if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
      return 0;
    },
    z.number().int().min(0)
  ),
  items: z.array(SlackSuggestionRecordSchema).default([]),
  rejectedKeysByCompany: z
    .record(z.string(), z.array(z.string()))
    .default({}),
});

export type SlackSuggestionsData = z.infer<typeof SlackSuggestionsDataSchema>;

const scrapedBundleSchema = z.object({
  goal: SlackScrapeGoalDraftSchema,
  projects: z.array(SlackScrapeProjectDraftSchema),
});

/** Payload for `createScrapedItems` server action (kept out of `"use server"` files). */
export const createScrapedItemsPayloadSchema = z.object({
  companyId: z.string().min(1),
  bundles: z.array(scrapedBundleSchema),
  projectsOnExistingGoals: z.array(
    z.object({
      goalId: z.string().min(1),
      project: SlackScrapeProjectDraftSchema,
    })
  ),
});

export type CreateScrapedItemsPayload = z.infer<
  typeof createScrapedItemsPayloadSchema
>;

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
