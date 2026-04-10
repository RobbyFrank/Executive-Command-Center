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

const repo = getRepository();

function revalidate() {
  revalidatePath("/");
  revalidatePath("/companies");
  revalidatePath("/team");
}

// --- ID generation ---

async function nextGoalId(companyId: string): Promise<string> {
  const companies = await repo.getCompanies();
  const company = companies.find((c) => c.id === companyId);
  if (!company) return uuid().slice(0, 8);

  const prefix = company.shortName
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();

  const goals = await repo.getGoalsByCompany(companyId);
  const nums = goals
    .map((g) => {
      const match = g.id.match(/-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${next}`;
}

// --- Companies ---

export async function createCompany(
  data: Omit<Company, "id">
): Promise<Company> {
  const id = data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
  const id = await nextGoalId(data.companyId);
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
  const goalProjects = await repo.getProjectsByGoal(data.goalId);
  const num = goalProjects.length + 1;
  const id = `${data.goalId}-P${num}`;
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
  const projectMilestones = await repo.getMilestonesByProject(data.projectId);
  const num = projectMilestones.length + 1;
  const id = `${data.projectId}-M${num}`;
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
  let id = data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const existing = await repo.getPeople();
  if (existing.some((p) => p.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
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

/** Per-company tracker stats for the Companies directory. */
export async function getCompanyStatsByCompanyId(): Promise<
  Record<string, CompanyDirectoryStats>
> {
  const [companies, goals, projects] = await Promise.all([
    repo.getCompanies(),
    repo.getGoals(),
    repo.getProjects(),
  ]);
  const stats: Record<string, CompanyDirectoryStats> = {};
  for (const c of companies) {
    stats[c.id] = { goals: 0, projects: 0, owners: 0 };
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

  for (const g of goals) {
    const row = stats[g.companyId];
    if (!row) continue;
    row.goals += 1;
    if (g.ownerId) ensureCompanySet(g.companyId).add(g.ownerId);
  }

  for (const p of projects) {
    const goal = goalById.get(p.goalId);
    if (!goal) continue;
    const row = stats[goal.companyId];
    if (!row) continue;
    row.projects += 1;
    if (p.ownerId) ensureCompanySet(goal.companyId).add(p.ownerId);
  }

  for (const [companyId, set] of ownerIdsByCompany) {
    const row = stats[companyId];
    if (row) row.owners = set.size;
  }

  return stats;
}

export async function getPeople() {
  return repo.getPeople();
}

export async function getPersonWorkloads() {
  return repo.getPersonWorkloads();
}
