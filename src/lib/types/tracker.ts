import { z } from "zod";
import {
  CompanySchema,
  GoalSchema,
  ProjectSchema,
  MilestoneSchema,
  PersonSchema,
  TrackerDataSchema,
  PriorityEnum,
  StatusEnum,
  CostOfDelayEnum,
  ExecutionModeEnum,
  ProjectTypeEnum,
  MilestoneStatusEnum,
} from "@/lib/schemas/tracker";

export type Company = z.infer<typeof CompanySchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type TrackerData = z.infer<typeof TrackerDataSchema>;

export type Priority = z.infer<typeof PriorityEnum>;
export type Status = z.infer<typeof StatusEnum>;
export type CostOfDelay = z.infer<typeof CostOfDelayEnum>;
export type ExecutionMode = z.infer<typeof ExecutionModeEnum>;
export type ProjectType = z.infer<typeof ProjectTypeEnum>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusEnum>;

export interface GoalWithProjects extends Goal {
  projects: ProjectWithMilestones[];
}

export interface ProjectWithMilestones extends Project {
  milestones: Milestone[];
  progress: number;
}

export interface CompanyWithGoals extends Company {
  goals: GoalWithProjects[];
}

/** Aggregates for the Companies directory (goals / projects / distinct owners). */
export interface CompanyDirectoryStats {
  goals: number;
  projects: number;
  /** Distinct people who own at least one goal or project under this company. */
  owners: number;
}

export interface PersonWorkload {
  person: Person;
  totalProjects: number;
  p0Projects: number;
  p1Projects: number;
  /** Company IDs where this person owns projects; sorted by short name. */
  projectCompanyIds: string[];
}
