import { readFile, writeFile, rename, access } from "fs/promises";
import { join } from "path";
import { TrackerDataSchema } from "@/lib/schemas/tracker";
import type {
  Company,
  Goal,
  Project,
  Milestone,
  Person,
  TrackerData,
  CompanyWithGoals,
  GoalWithProjects,
  ProjectWithMilestones,
  PersonWorkload,
} from "@/lib/types/tracker";
import type { TrackerRepository } from "./types";
import { compareMilestonesByTargetDate } from "@/lib/milestoneSort";
import { sortCompaniesByRevenueDesc } from "@/lib/companySort";
import { comparePriority } from "@/lib/prioritySort";
import { withFounderDepartmentRules } from "@/lib/autonomyRoster";

const DATA_PATH = join(process.cwd(), "data", "tracker.json");

/** atRisk and spotlight cannot both be true; resolve using the latest explicit update. */
function reconcileGoalProjectExecFlags<
  T extends { atRisk: boolean; spotlight: boolean },
>(merged: T, updates: Partial<T>): T {
  if (!merged.atRisk || !merged.spotlight) return merged;
  if (updates.atRisk === true) return { ...merged, spotlight: false };
  if (updates.spotlight === true) return { ...merged, atRisk: false };
  return { ...merged, spotlight: false };
}

const EMPTY_DATA: TrackerData = {
  companies: [],
  goals: [],
  projects: [],
  milestones: [],
  people: [],
};

export class JsonTrackerRepository implements TrackerRepository {
  private cache: TrackerData | null = null;

  async load(): Promise<TrackerData> {
    try {
      await access(DATA_PATH);
      const raw = await readFile(DATA_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = TrackerDataSchema.parse(parsed);
      this.cache = validated;
      return validated;
    } catch {
      this.cache = EMPTY_DATA;
      return EMPTY_DATA;
    }
  }

  async save(data: TrackerData): Promise<void> {
    const validated = TrackerDataSchema.parse(data);
    const tmpPath = DATA_PATH + ".tmp";
    await writeFile(tmpPath, JSON.stringify(validated, null, 2), "utf-8");
    await rename(tmpPath, DATA_PATH);
    this.cache = validated;
  }

  private async getData(): Promise<TrackerData> {
    if (this.cache) return this.cache;
    return this.load();
  }

  // --- Companies ---

  async getCompanies(): Promise<Company[]> {
    const data = await this.getData();
    return data.companies;
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const data = await this.getData();
    return data.companies.find((c) => c.id === id);
  }

  async createCompany(company: Company): Promise<Company> {
    const data = await this.getData();
    data.companies.push(company);
    await this.save(data);
    return company;
  }

  async updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
    const data = await this.getData();
    const idx = data.companies.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Company ${id} not found`);
    data.companies[idx] = { ...data.companies[idx], ...updates, id };
    await this.save(data);
    return data.companies[idx];
  }

  async deleteCompany(id: string): Promise<void> {
    const data = await this.getData();
    const goalsForCompany = data.goals.filter((g) => g.companyId === id);
    if (goalsForCompany.length > 0) {
      throw new Error(
        `Cannot delete this company: ${goalsForCompany.length} goal(s) still exist. Delete or move those goals first.`
      );
    }
    data.companies = data.companies.filter((c) => c.id !== id);
    await this.save(data);
  }

  // --- Goals ---

  async getGoals(): Promise<Goal[]> {
    const data = await this.getData();
    return data.goals;
  }

  async getGoalsByCompany(companyId: string): Promise<Goal[]> {
    const data = await this.getData();
    return data.goals.filter((g) => g.companyId === companyId);
  }

  async getGoal(id: string): Promise<Goal | undefined> {
    const data = await this.getData();
    return data.goals.find((g) => g.id === id);
  }

  async createGoal(goal: Goal): Promise<Goal> {
    const data = await this.getData();
    data.goals.push(goal);
    await this.save(data);
    return goal;
  }

  async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal> {
    const data = await this.getData();
    const idx = data.goals.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error(`Goal ${id} not found`);
    const merged = { ...data.goals[idx], ...updates, id };
    data.goals[idx] = reconcileGoalProjectExecFlags(merged, updates);
    await this.save(data);
    return data.goals[idx];
  }

  async deleteGoal(id: string): Promise<void> {
    const data = await this.getData();
    const projectIds = data.projects.filter((p) => p.goalId === id).map((p) => p.id);
    data.milestones = data.milestones.filter((m) => !projectIds.includes(m.projectId));
    data.projects = data.projects.filter((p) => p.goalId !== id);
    data.goals = data.goals.filter((g) => g.id !== id);
    await this.save(data);
  }

  // --- Projects ---

  async getProjects(): Promise<Project[]> {
    const data = await this.getData();
    return data.projects;
  }

  async getProjectsByGoal(goalId: string): Promise<Project[]> {
    const data = await this.getData();
    return data.projects.filter((p) => p.goalId === goalId);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const data = await this.getData();
    return data.projects.find((p) => p.id === id);
  }

  async createProject(project: Project): Promise<Project> {
    const data = await this.getData();
    data.projects.push(project);
    await this.save(data);
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    const data = await this.getData();
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Project ${id} not found`);
    const merged = { ...data.projects[idx], ...updates, id };
    data.projects[idx] = reconcileGoalProjectExecFlags(merged, updates);
    await this.save(data);
    return data.projects[idx];
  }

  async deleteProject(id: string): Promise<void> {
    const data = await this.getData();
    data.milestones = data.milestones.filter((m) => m.projectId !== id);
    data.projects = data.projects.filter((p) => p.id !== id);
    await this.save(data);
  }

  // --- Milestones ---

  async getMilestones(): Promise<Milestone[]> {
    const data = await this.getData();
    return data.milestones;
  }

  async getMilestonesByProject(projectId: string): Promise<Milestone[]> {
    const data = await this.getData();
    return data.milestones.filter((m) => m.projectId === projectId);
  }

  async getMilestone(id: string): Promise<Milestone | undefined> {
    const data = await this.getData();
    return data.milestones.find((m) => m.id === id);
  }

  async createMilestone(milestone: Milestone): Promise<Milestone> {
    const data = await this.getData();
    data.milestones.push(milestone);
    await this.save(data);
    return milestone;
  }

  async updateMilestone(id: string, updates: Partial<Milestone>): Promise<Milestone> {
    const data = await this.getData();
    const idx = data.milestones.findIndex((m) => m.id === id);
    if (idx === -1) throw new Error(`Milestone ${id} not found`);
    data.milestones[idx] = { ...data.milestones[idx], ...updates, id };
    await this.save(data);
    return data.milestones[idx];
  }

  async deleteMilestone(id: string): Promise<void> {
    const data = await this.getData();
    data.milestones = data.milestones.filter((m) => m.id !== id);
    await this.save(data);
  }

  // --- People ---

  async getPeople(): Promise<Person[]> {
    const data = await this.getData();
    return data.people.map(withFounderDepartmentRules);
  }

  async getPerson(id: string): Promise<Person | undefined> {
    const data = await this.getData();
    const p = data.people.find((p) => p.id === id);
    return p ? withFounderDepartmentRules(p) : undefined;
  }

  async createPerson(person: Person): Promise<Person> {
    const data = await this.getData();
    const normalized = withFounderDepartmentRules(person);
    data.people.push(normalized);
    await this.save(data);
    return normalized;
  }

  async updatePerson(id: string, updates: Partial<Person>): Promise<Person> {
    const data = await this.getData();
    const idx = data.people.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Person ${id} not found`);
    const merged = { ...data.people[idx], ...updates, id };
    data.people[idx] = withFounderDepartmentRules(merged);
    await this.save(data);
    return data.people[idx];
  }

  async deletePerson(id: string): Promise<void> {
    const data = await this.getData();
    const goalsOwned = data.goals.filter((g) => g.ownerId === id);
    const projectsOwned = data.projects.filter((p) => p.ownerId === id);
    const projectsAsAssigneeOnly = data.projects.filter(
      (p) => p.assigneeIds.includes(id) && p.ownerId !== id
    );
    const parts: string[] = [];
    if (goalsOwned.length > 0) {
      parts.push(
        `${goalsOwned.length} goal(s) as owner`
      );
    }
    if (projectsOwned.length > 0) {
      parts.push(
        `${projectsOwned.length} project(s) as owner`
      );
    }
    if (projectsAsAssigneeOnly.length > 0) {
      parts.push(
        `${projectsAsAssigneeOnly.length} project(s) as assignee`
      );
    }
    if (parts.length > 0) {
      throw new Error(
        `Cannot delete this person: still assigned to ${parts.join(", ")}. Reassign or remove those first.`
      );
    }
    data.people = data.people.filter((p) => p.id !== id);
    await this.save(data);
  }

  // --- Computed views ---

  async getHierarchy(): Promise<CompanyWithGoals[]> {
    const data = await this.getData();
    const companiesOrdered = sortCompaniesByRevenueDesc(data.companies);
    return companiesOrdered.map((company) => {
      const companyGoals = data.goals
        .filter((g) => g.companyId === company.id)
        .sort((a, b) => comparePriority(a.priority, b.priority));
      const goals: GoalWithProjects[] = companyGoals.map((goal) => {
        const goalProjects = data.projects.filter((p) => p.goalId === goal.id);
        const orderedProjects =
          goal.executionMode === "Sync"
            ? goalProjects
            : [...goalProjects].sort((a, b) =>
                comparePriority(a.priority, b.priority)
              );
        const projects: ProjectWithMilestones[] = orderedProjects.map((project) => {
          const projectMilestones = data.milestones
            .filter((m) => m.projectId === project.id)
            .sort(compareMilestonesByTargetDate);
          const done = projectMilestones.filter((m) => m.status === "Done").length;
          const total = projectMilestones.length;
          return {
            ...project,
            milestones: projectMilestones,
            progress: total === 0 ? 0 : Math.round((done / total) * 100),
          };
        });
        return { ...goal, projects };
      });
      return { ...company, goals };
    });
  }

  async getPersonWorkloads(): Promise<PersonWorkload[]> {
    const data = await this.getData();
    return data.people.map((person) => {
      const personNorm = withFounderDepartmentRules(person);
      const owned = data.projects.filter((p) => p.ownerId === personNorm.id);
      const companyIds = new Set<string>();
      for (const project of owned) {
        const goal = data.goals.find((g) => g.id === project.goalId);
        if (goal) companyIds.add(goal.companyId);
      }
      const projectCompanyIds = [...companyIds].sort((a, b) => {
        const sa = data.companies.find((c) => c.id === a)?.shortName ?? a;
        const sb = data.companies.find((c) => c.id === b)?.shortName ?? b;
        return sa.localeCompare(sb, undefined, { sensitivity: "base" });
      });
      return {
        person: personNorm,
        totalProjects: owned.length,
        p0Projects: owned.filter((p) => p.priority === "P0").length,
        p1Projects: owned.filter((p) => p.priority === "P1").length,
        projectCompanyIds,
      };
    });
  }
}
