import { z } from "zod";
import {
  CompanySchema,
  GoalSchema,
  ProjectSchema,
  MilestoneSchema,
  PersonSchema,
  TrackerDataSchema,
  EmploymentKindEnum,
  PriorityEnum,
  GoalStatusEnum,
  ProjectStatusEnum,
  ProjectTypeEnum,
  MilestoneStatusEnum,
  ReviewLogEntrySchema,
} from "@/lib/schemas/tracker";

export type Company = z.infer<typeof CompanySchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type TrackerData = z.infer<typeof TrackerDataSchema>;

export type Priority = z.infer<typeof PriorityEnum>;
export type GoalStatus = z.infer<typeof GoalStatusEnum>;
export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;
/** Goal delivery status (legacy name — same as `GoalStatus`). */
export type Status = GoalStatus;
export type ProjectType = z.infer<typeof ProjectTypeEnum>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusEnum>;
export type EmploymentKind = z.infer<typeof EmploymentKindEnum>;
export type ReviewLogEntry = z.infer<typeof ReviewLogEntrySchema>;

export interface GoalWithProjects extends Goal {
  projects: ProjectWithMilestones[];
}

export interface ProjectWithMilestones extends Project {
  milestones: Milestone[];
  progress: number;
  /** True when this row is shown under a mirrored goal (not the project's primary `goalId`). */
  isMirror?: boolean;
  /** True when `blockedByProjectId` points at a project that is not fully complete (milestones). */
  isBlocked?: boolean;
  /** Name of the blocking project (for tooltip when `isBlocked`). */
  blockedByProjectName?: string;
}

export interface CompanyWithGoals extends Company {
  goals: GoalWithProjects[];
}

/** One roster member shown in the Companies directory Team column (goal/project owners). */
export interface CompanyDirectoryTeamMember {
  id: string;
  name: string;
  profilePicturePath: string;
}

/** Aggregates for the Companies directory (goals / projects / distinct owners + momentum). */
export interface CompanyDirectoryStats {
  goals: number;
  projects: number;
  /** Non-founder team avatars only: count matches `teamMembers.length`. */
  owners: number;
  /** Goal/project owners for this company, excluding founders; autonomy 5→0 then name. */
  teamMembers: CompanyDirectoryTeamMember[];
  /** Goals with status In Progress. */
  activeGoals: number;
  /** Projects with status In Progress. */
  activeProjects: number;
  goalsWithSpotlight: number;
  goalsWithAtRisk: number;
  projectsWithSpotlight: number;
  projectsWithAtRisk: number;
  milestonesDone: number;
  milestonesTotal: number;
  /** Composite 0–100 from @/lib/companyMomentum.computeMomentumScore */
  momentumScore: number;
}

export interface PersonWorkload {
  person: Person;
  totalProjects: number;
  p0Projects: number;
  p1Projects: number;
  /** Company IDs where this person owns projects; sorted by short name. */
  projectCompanyIds: string[];
}
