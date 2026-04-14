import { TrackerDataSchema } from "@/lib/schemas/tracker";
import { milestoneProgressPercent } from "@/lib/milestone-progress";
import { isBlockingProjectIncomplete } from "@/lib/blocked-status";
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
import type { TrackerStorage } from "./tracker-storage";
import { TrackerConcurrentModificationError } from "./errors";
import { compareMilestonesByTargetDate } from "@/lib/milestoneSort";
import { sortCompaniesByRevenueDesc } from "@/lib/companySort";
import { comparePriority } from "@/lib/prioritySort";
import { withFounderDepartmentRules } from "@/lib/autonomyRoster";

const MAX_COMMIT_ATTEMPTS = 12;

/** atRisk and spotlight cannot both be true; resolve using the latest explicit update. */
function reconcileGoalProjectExecFlags<
  T extends { atRisk: boolean; spotlight: boolean },
>(merged: T, updates: Partial<T>): T {
  if (!merged.atRisk || !merged.spotlight) return merged;
  if (updates.atRisk === true) return { ...merged, spotlight: false };
  if (updates.spotlight === true) return { ...merged, atRisk: false };
  return { ...merged, spotlight: false };
}

export class TrackerRepositoryCore implements TrackerRepository {
  constructor(private readonly storage: TrackerStorage) {}

  async load(): Promise<TrackerData> {
    return this.storage.read();
  }

  private async getData(): Promise<TrackerData> {
    return this.storage.read();
  }

  private async commitWithRetry(
    mutate: (data: TrackerData) => void
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const data = await this.storage.read();
      const expected = data.revision;
      mutate(data);
      data.revision = expected + 1;
      const validated = TrackerDataSchema.parse(data);
      const ok = await this.storage.writeIfRevisionMatches(validated, expected);
      if (ok) return;
    }
    throw new TrackerConcurrentModificationError();
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
    await this.commitWithRetry((data) => {
      if (data.companies.some((c) => c.id === company.id)) return;
      data.companies.push(company);
    });
    return company;
  }

  async updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
    let result!: Company;
    await this.commitWithRetry((data) => {
      const idx = data.companies.findIndex((c) => c.id === id);
      if (idx === -1) throw new Error(`Company ${id} not found`);
      data.companies[idx] = { ...data.companies[idx], ...updates, id };
      result = data.companies[idx];
    });
    return result;
  }

  async deleteCompany(id: string): Promise<void> {
    await this.commitWithRetry((data) => {
      const goalsForCompany = data.goals.filter((g) => g.companyId === id);
      if (goalsForCompany.length > 0) {
        throw new Error(
          `Cannot delete this company: ${goalsForCompany.length} goal(s) still exist. Delete or move those goals first.`
        );
      }
      data.companies = data.companies.filter((c) => c.id !== id);
    });
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
    await this.commitWithRetry((data) => {
      if (data.goals.some((g) => g.id === goal.id)) return;
      data.goals.push(goal);
    });
    return goal;
  }

  async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal> {
    let result!: Goal;
    await this.commitWithRetry((data) => {
      const idx = data.goals.findIndex((g) => g.id === id);
      if (idx === -1) throw new Error(`Goal ${id} not found`);
      const merged = { ...data.goals[idx], ...updates, id };
      data.goals[idx] = reconcileGoalProjectExecFlags(merged, updates);
      result = data.goals[idx];
    });
    return result;
  }

  async deleteGoal(id: string): Promise<void> {
    await this.commitWithRetry((data) => {
      const projectsForGoal = data.projects.filter((p) => p.goalId === id);
      if (projectsForGoal.length > 0) {
        throw new Error(
          `Cannot delete this goal: ${projectsForGoal.length} project(s) still exist. Delete those projects first.`
        );
      }
      for (const p of data.projects) {
        const mids = p.mirroredGoalIds ?? [];
        if (mids.includes(id)) {
          p.mirroredGoalIds = mids.filter((g) => g !== id);
        }
      }
      data.goals = data.goals.filter((g) => g.id !== id);
    });
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
    await this.commitWithRetry((data) => {
      if (data.projects.some((p) => p.id === project.id)) return;
      data.projects.push(project);
    });
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    let result!: Project;
    await this.commitWithRetry((data) => {
      const idx = data.projects.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error(`Project ${id} not found`);
      const merged = { ...data.projects[idx], ...updates, id };
      data.projects[idx] = reconcileGoalProjectExecFlags(merged, updates);
      result = data.projects[idx];
    });
    return result;
  }

  async deleteProject(id: string): Promise<void> {
    await this.commitWithRetry((data) => {
      for (const p of data.projects) {
        if ((p.blockedByProjectId ?? "").trim() === id) {
          p.blockedByProjectId = "";
        }
      }
      data.milestones = data.milestones.filter((m) => m.projectId !== id);
      data.projects = data.projects.filter((p) => p.id !== id);
    });
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
    await this.commitWithRetry((data) => {
      if (data.milestones.some((m) => m.id === milestone.id)) return;
      data.milestones.push(milestone);
    });
    return milestone;
  }

  async updateMilestone(
    id: string,
    updates: Partial<Milestone>
  ): Promise<Milestone> {
    let result!: Milestone;
    await this.commitWithRetry((data) => {
      const idx = data.milestones.findIndex((m) => m.id === id);
      if (idx === -1) throw new Error(`Milestone ${id} not found`);
      data.milestones[idx] = { ...data.milestones[idx], ...updates, id };
      result = data.milestones[idx];
    });
    return result;
  }

  async deleteMilestone(id: string): Promise<void> {
    await this.commitWithRetry((data) => {
      data.milestones = data.milestones.filter((m) => m.id !== id);
    });
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
    const normalized = withFounderDepartmentRules(person);
    await this.commitWithRetry((data) => {
      if (data.people.some((p) => p.id === normalized.id)) return;
      data.people.push(normalized);
    });
    return normalized;
  }

  async updatePerson(id: string, updates: Partial<Person>): Promise<Person> {
    let result!: Person;
    await this.commitWithRetry((data) => {
      const idx = data.people.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error(`Person ${id} not found`);
      const merged = { ...data.people[idx], ...updates, id };
      data.people[idx] = withFounderDepartmentRules(merged);
      result = data.people[idx];
    });
    return result;
  }

  async deletePerson(id: string): Promise<void> {
    await this.commitWithRetry((data) => {
      const goalsOwned = data.goals.filter((g) => g.ownerId === id);
      const projectsOwned = data.projects.filter((p) => p.ownerId === id);
      const projectsAsAssigneeOnly = data.projects.filter(
        (p) => p.assigneeIds.includes(id) && p.ownerId !== id
      );
      const parts: string[] = [];
      if (goalsOwned.length > 0) {
        parts.push(`${goalsOwned.length} goal(s) as DRI`);
      }
      if (projectsOwned.length > 0) {
        parts.push(`${projectsOwned.length} project(s) as owner`);
      }
      if (projectsAsAssigneeOnly.length > 0) {
        parts.push(`${projectsAsAssigneeOnly.length} project(s) as assignee`);
      }
      if (parts.length > 0) {
        throw new Error(
          `Cannot delete this person: still assigned to ${parts.join(", ")}. Reassign or remove those first.`
        );
      }
      data.people = data.people.filter((p) => p.id !== id);
    });
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
        const primary = data.projects.filter((p) => p.goalId === goal.id);
        const mirrors = data.projects.filter(
          (p) =>
            p.goalId !== goal.id &&
            (p.mirroredGoalIds ?? []).includes(goal.id)
        );
        const orderedPrimary = [...primary].sort((a, b) =>
          comparePriority(a.priority, b.priority)
        );
        const orderedMirrors = [...mirrors].sort((a, b) =>
          comparePriority(a.priority, b.priority)
        );
        const orderedProjects = [...orderedPrimary, ...orderedMirrors];
        const projects: ProjectWithMilestones[] = orderedProjects.map(
          (project) => {
            const projectMilestones = data.milestones
              .filter((m) => m.projectId === project.id)
              .sort(compareMilestonesByTargetDate);
            const lastDatedMilestone = [...projectMilestones]
              .reverse()
              .find((m) => m.targetDate?.trim());
            const derivedTargetDate = lastDatedMilestone?.targetDate ?? "";

            const blockerId = (project.blockedByProjectId ?? "").trim();
            const blocker = blockerId
              ? data.projects.find((p) => p.id === blockerId)
              : undefined;
            const blockerMilestones = blocker
              ? data.milestones.filter((m) => m.projectId === blocker.id)
              : [];

            return {
              ...project,
              targetDate: derivedTargetDate,
              milestones: projectMilestones,
              progress: milestoneProgressPercent(projectMilestones),
              isMirror: project.goalId !== goal.id,
              ...(blocker
                ? {
                    isBlocked: isBlockingProjectIncomplete(blockerMilestones),
                    blockedByProjectName: blocker.name,
                  }
                : {}),
            };
          }
        );
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
