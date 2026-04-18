import type {
  Company,
  Goal,
  Project,
  Milestone,
  Person,
  TrackerData,
  CompanyWithGoals,
  CompanyDirectoryStats,
  PersonWorkload,
} from "@/lib/types/tracker";

/** Single-transaction batch create for Slack scrape import. */
export type ScrapedItemsBatch = {
  goals: Goal[];
  projects: Project[];
  milestones: Milestone[];
};

export interface TrackerRepository {
  load(): Promise<TrackerData>;

  getCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | undefined>;
  createCompany(company: Company): Promise<Company>;
  updateCompany(id: string, updates: Partial<Company>): Promise<Company>;
  deleteCompany(id: string): Promise<void>;

  getGoals(): Promise<Goal[]>;
  getGoalsByCompany(companyId: string): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | undefined>;
  createGoal(goal: Goal): Promise<Goal>;
  updateGoal(id: string, updates: Partial<Goal>): Promise<Goal>;
  deleteGoal(id: string): Promise<void>;

  getProjects(): Promise<Project[]>;
  getProjectsByGoal(goalId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: Project): Promise<Project>;
  updateProject(id: string, updates: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  getMilestones(): Promise<Milestone[]>;
  getMilestonesByProject(projectId: string): Promise<Milestone[]>;
  getMilestone(id: string): Promise<Milestone | undefined>;
  createMilestone(milestone: Milestone): Promise<Milestone>;
  updateMilestone(id: string, updates: Partial<Milestone>): Promise<Milestone>;
  deleteMilestone(id: string): Promise<void>;

  getPeople(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  createPerson(person: Person): Promise<Person>;
  updatePerson(id: string, updates: Partial<Person>): Promise<Person>;
  deletePerson(id: string): Promise<void>;

  getHierarchy(): Promise<CompanyWithGoals[]>;
  getPersonWorkloads(): Promise<PersonWorkload[]>;
  /** Per-company aggregates for the Companies directory (momentum, counts). */
  getCompanyStatsByCompanyId(): Promise<
    Record<string, CompanyDirectoryStats>
  >;

  createScrapedItemsBatch(batch: ScrapedItemsBatch): Promise<void>;
}
