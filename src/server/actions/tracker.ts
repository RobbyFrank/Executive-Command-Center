"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/server/repository";
import { deleteFileIfInUploads } from "@/server/imageFiles";
import { v4 as uuid } from "uuid";
import type {
  Company,
  CompanyDirectoryStats,
  Goal,
  Project,
  Milestone,
  Person,
} from "@/lib/types/tracker";
import {
  computeMomentumScore,
  isActiveStatus,
  isReviewedWithinDays,
  MOMENTUM_RECENT_REVIEW_DAYS,
} from "@/lib/companyMomentum";

const repo = getRepository();

function revalidate() {
  revalidatePath("/");
  revalidatePath("/companies");
  revalidatePath("/team");
  revalidatePath("/summary");
  revalidatePath("/matrix");
  revalidatePath("/review");
}

// --- Companies ---

export async function createCompany(
  data: Omit<Company, "id">
): Promise<Company> {
  const id = uuid();
  const company = { id, ...data };
  await repo.createCompany(company);
  revalidate();
  return company;
}

export async function updateCompany(
  id: string,
  updates: Partial<Company>
): Promise<Company> {
  const result = await repo.updateCompany(id, updates);
  revalidate();
  return result;
}

export async function deleteCompany(
  id: string
): Promise<{ error: string | null }> {
  const company = await repo.getCompany(id);
  try {
    await repo.deleteCompany(id);
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not delete company.",
    };
  }
  if (company?.logoPath) {
    try {
      await deleteFileIfInUploads(company.logoPath);
    } catch {
      /* logo cleanup is best-effort after JSON delete */
    }
  }
  revalidate();
  return { error: null };
}

// --- Goals ---

export async function createGoal(
  data: Omit<Goal, "id">
): Promise<Goal> {
  const id = uuid();
  const goal = { id, ...data };
  await repo.createGoal(goal);
  revalidate();
  return goal;
}

export async function updateGoal(
  id: string,
  updates: Partial<Goal>
): Promise<Goal> {
  const result = await repo.updateGoal(id, updates);
  revalidate();
  return result;
}

export async function deleteGoal(id: string): Promise<void> {
  await repo.deleteGoal(id);
  revalidate();
}

// --- Projects ---

export async function createProject(
  data: Omit<Project, "id">
): Promise<Project> {
  const id = uuid();
  const project = { id, ...data };
  await repo.createProject(project);
  revalidate();
  return project;
}

export async function updateProject(
  id: string,
  updates: Partial<Project>
): Promise<Project> {
  const result = await repo.updateProject(id, updates);
  revalidate();
  return result;
}

export async function deleteProject(id: string): Promise<void> {
  await repo.deleteProject(id);
  revalidate();
}

// --- Milestones ---

export async function createMilestone(
  data: Omit<Milestone, "id">
): Promise<Milestone> {
  const id = uuid();
  const milestone = { id, ...data };
  await repo.createMilestone(milestone);
  revalidate();
  return milestone;
}

export async function updateMilestone(
  id: string,
  updates: Partial<Milestone>
): Promise<Milestone> {
  const result = await repo.updateMilestone(id, updates);
  revalidate();
  return result;
}

export async function deleteMilestone(id: string): Promise<void> {
  await repo.deleteMilestone(id);
  revalidate();
}

// --- People ---

export async function createPerson(
  data: Omit<Person, "id">
): Promise<Person> {
  const id = uuid();
  const person = { id, ...data };
  await repo.createPerson(person);
  revalidate();
  return person;
}

export async function updatePerson(
  id: string,
  updates: Partial<Person>
): Promise<Person> {
  const result = await repo.updatePerson(id, updates);
  revalidate();
  return result;
}

export async function deletePerson(
  id: string
): Promise<{ error: string | null }> {
  const person = await repo.getPerson(id);
  try {
    await repo.deletePerson(id);
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not delete person.",
    };
  }
  if (person?.profilePicturePath) {
    try {
      await deleteFileIfInUploads(person.profilePicturePath);
    } catch {
      /* file cleanup is best-effort after JSON delete */
    }
  }
  revalidate();
  return { error: null };
}

// --- Mark as Reviewed ---

export async function markGoalReviewed(id: string): Promise<Goal> {
  return updateGoal(id, {
    lastReviewed: new Date().toISOString(),
  });
}

export async function markProjectReviewed(id: string): Promise<Project> {
  return updateProject(id, {
    lastReviewed: new Date().toISOString(),
  });
}

// --- Fetch hierarchy ---

export async function getHierarchy() {
  return repo.getHierarchy();
}

export async function getCompanies() {
  return repo.getCompanies();
}

function emptyCompanyDirectoryStats(): CompanyDirectoryStats {
  return {
    goals: 0,
    projects: 0,
    owners: 0,
    activeGoals: 0,
    activeProjects: 0,
    goalsWithSpotlight: 0,
    goalsWithAtRisk: 0,
    projectsWithSpotlight: 0,
    projectsWithAtRisk: 0,
    milestonesDone: 0,
    milestonesTotal: 0,
    recentlyReviewed: 0,
    momentumScore: 0,
  };
}

/** Per-company tracker stats for the Companies directory. */
export async function getCompanyStatsByCompanyId(): Promise<
  Record<string, CompanyDirectoryStats>
> {
  const [companies, goals, projects, milestones] = await Promise.all([
    repo.getCompanies(),
    repo.getGoals(),
    repo.getProjects(),
    repo.getMilestones(),
  ]);
  const stats: Record<string, CompanyDirectoryStats> = {};
  for (const c of companies) {
    stats[c.id] = emptyCompanyDirectoryStats();
  }
  const ownerIdsByCompany = new Map<string, Set<string>>();

  function ensureCompanySet(companyId: string): Set<string> {
    let set = ownerIdsByCompany.get(companyId);
    if (!set) {
      set = new Set<string>();
      ownerIdsByCompany.set(companyId, set);
    }
    return set;
  }

  const goalById = new Map(goals.map((g) => [g.id, g]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  for (const g of goals) {
    const row = stats[g.companyId];
    if (!row) continue;
    row.goals += 1;
    if (isActiveStatus(g.status)) row.activeGoals += 1;
    if (g.spotlight) row.goalsWithSpotlight += 1;
    if (g.atRisk) row.goalsWithAtRisk += 1;
    if (isReviewedWithinDays(g.lastReviewed, MOMENTUM_RECENT_REVIEW_DAYS)) {
      row.recentlyReviewed += 1;
    }
    if (g.ownerId) ensureCompanySet(g.companyId).add(g.ownerId);
  }

  for (const p of projects) {
    const goal = goalById.get(p.goalId);
    if (!goal) continue;
    const row = stats[goal.companyId];
    if (!row) continue;
    row.projects += 1;
    if (isActiveStatus(p.status)) row.activeProjects += 1;
    if (p.spotlight) row.projectsWithSpotlight += 1;
    if (p.atRisk) row.projectsWithAtRisk += 1;
    if (isReviewedWithinDays(p.lastReviewed, MOMENTUM_RECENT_REVIEW_DAYS)) {
      row.recentlyReviewed += 1;
    }
    if (p.ownerId) ensureCompanySet(goal.companyId).add(p.ownerId);
  }

  for (const m of milestones) {
    const proj = projectById.get(m.projectId);
    if (!proj) continue;
    const goal = goalById.get(proj.goalId);
    if (!goal) continue;
    const row = stats[goal.companyId];
    if (!row) continue;
    row.milestonesTotal += 1;
    if (m.status === "Done") row.milestonesDone += 1;
  }

  for (const [companyId, set] of ownerIdsByCompany) {
    const row = stats[companyId];
    if (row) row.owners = set.size;
  }

  for (const c of companies) {
    const row = stats[c.id];
    if (!row) continue;
    row.momentumScore = computeMomentumScore(row);
  }

  return stats;
}

export async function getPeople() {
  return repo.getPeople();
}

export async function getPersonWorkloads() {
  return repo.getPersonWorkloads();
}
