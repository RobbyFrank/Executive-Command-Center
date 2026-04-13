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
import { isGoalDriEligiblePerson } from "@/lib/autonomyRoster";
import { validateSyncDueDateVsPrevious } from "@/lib/syncProjectDueDate";
import { calendarDateTodayLocal } from "@/lib/relativeCalendarDate";

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
  data: Omit<Goal, "id" | "lastReviewed" | "reviewLog" | "createdAt"> &
    Partial<Pick<Goal, "lastReviewed" | "reviewLog">>
): Promise<Goal> {
  const id = uuid();
  const trimmedReviewed = data.lastReviewed?.trim() ?? "";
  const lastReviewed =
    trimmedReviewed !== ""
      ? trimmedReviewed
      : new Date().toISOString();
  const createdAt = calendarDateTodayLocal();
  const goal = {
    id,
    ...data,
    lastReviewed,
    reviewLog: data.reviewLog ?? [],
    createdAt,
  };
  await repo.createGoal(goal);
  revalidate();
  return goal;
}

export async function updateGoal(
  id: string,
  updates: Partial<Goal>
): Promise<Goal> {
  if (updates.ownerId !== undefined) {
    const raw = updates.ownerId.trim();
    if (raw !== "") {
      const people = await repo.getPeople();
      const person = people.find((p) => p.id === raw);
      if (!person) {
        throw new Error("That person is not on the team roster.");
      }
      if (!isGoalDriEligiblePerson(person)) {
        throw new Error(
          "Goal DRI must be a founder or someone with autonomy 4 or 5."
        );
      }
    }
  }
  const { createdAt: _omitCreatedAt, ...goalUpdates } = updates;
  const result = await repo.updateGoal(id, goalUpdates);
  revalidate();
  return result;
}

export async function deleteGoal(
  id: string
): Promise<{ error: string | null }> {
  try {
    await repo.deleteGoal(id);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete goal.",
    };
  }
  revalidate();
  return { error: null };
}

// --- Projects ---

export async function createProject(
  data: Omit<Project, "id" | "lastReviewed" | "reviewLog" | "createdAt" | "slackUrl"> &
    Partial<Pick<Project, "lastReviewed" | "reviewLog" | "slackUrl">>
): Promise<Project> {
  const id = uuid();
  const trimmedReviewed = data.lastReviewed?.trim() ?? "";
  const lastReviewed =
    trimmedReviewed !== ""
      ? trimmedReviewed
      : new Date().toISOString();
  const createdAt = calendarDateTodayLocal();
  const project = {
    id,
    slackUrl: "",
    ...data,
    mirroredGoalIds: data.mirroredGoalIds ?? [],
    lastReviewed,
    reviewLog: data.reviewLog ?? [],
    createdAt,
  };
  await repo.createProject(project);
  revalidate();
  return project;
}

export async function updateProject(
  id: string,
  updates: Partial<Project>
): Promise<Project> {
  if (updates.targetDate !== undefined) {
    const existing = await repo.getProject(id);
    if (existing) {
      const goal = await repo.getGoal(existing.goalId);
      if (goal?.executionMode === "Sync") {
        const siblings = await repo.getProjectsByGoal(existing.goalId);
        const ix = siblings.findIndex((p) => p.id === id);
        if (ix > 0) {
          const prev = siblings[ix - 1];
          const err = validateSyncDueDateVsPrevious({
            executionMode: goal.executionMode,
            previousProjectTargetDate: prev.targetDate,
            newTargetDate: updates.targetDate,
          });
          if (err) throw new Error(err);
        }
      }
    }
  }
  const { createdAt: _omitCreatedAt, ...projectUpdates } = updates;
  const result = await repo.updateProject(id, projectUpdates);
  revalidate();
  return result;
}

export async function deleteProject(id: string): Promise<void> {
  await repo.deleteProject(id);
  revalidate();
}

/** Attach a project to an additional goal (mirror). Primary goal remains `goalId`. */
export async function mirrorProjectToGoal(
  projectId: string,
  mirrorGoalId: string
): Promise<Project> {
  const project = await repo.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  if (mirrorGoalId === project.goalId) {
    throw new Error("That goal is already this project's primary goal.");
  }
  const goal = await repo.getGoal(mirrorGoalId);
  if (!goal) {
    throw new Error("Goal not found.");
  }
  const existing = project.mirroredGoalIds ?? [];
  if (existing.includes(mirrorGoalId)) {
    throw new Error("This project is already mirrored to that goal.");
  }
  return updateProject(projectId, {
    mirroredGoalIds: [...existing, mirrorGoalId],
  });
}

/** Remove a mirror link (project stays under its primary goal). */
export async function unmirrorProjectFromGoal(
  projectId: string,
  mirrorGoalId: string
): Promise<Project> {
  const project = await repo.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  const next = (project.mirroredGoalIds ?? []).filter((g) => g !== mirrorGoalId);
  return updateProject(projectId, { mirroredGoalIds: next });
}

// --- Milestones ---

export async function createMilestone(
  data: Omit<Milestone, "id" | "slackUrl"> & Partial<Pick<Milestone, "slackUrl">>
): Promise<Milestone> {
  const id = uuid();
  const milestone: Milestone = { id, slackUrl: "", ...data };
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

/**
 * Records `lastReviewed` and optionally appends one dated note to `reviewLog`
 * (same timestamp as the review).
 */
export async function markGoalReviewed(
  id: string,
  note?: string
): Promise<Goal> {
  const existing = await repo.getGoal(id);
  if (!existing) {
    throw new Error(`Goal ${id} not found`);
  }
  const ts = new Date().toISOString();
  const trimmed = note?.trim();
  const updates: Partial<Goal> = { lastReviewed: ts };
  if (trimmed) {
    updates.reviewLog = [
      ...(existing.reviewLog ?? []),
      { id: uuid(), at: ts, text: trimmed },
    ];
  }
  return updateGoal(id, updates);
}

export async function markProjectReviewed(
  id: string,
  note?: string
): Promise<Project> {
  const existing = await repo.getProject(id);
  if (!existing) {
    throw new Error(`Project ${id} not found`);
  }
  const ts = new Date().toISOString();
  const trimmed = note?.trim();
  const updates: Partial<Project> = { lastReviewed: ts };
  if (trimmed) {
    updates.reviewLog = [
      ...(existing.reviewLog ?? []),
      { id: uuid(), at: ts, text: trimmed },
    ];
  }
  return updateProject(id, updates);
}

/** Append a note without updating `lastReviewed`. */
export async function appendGoalReviewNote(
  id: string,
  text: string
): Promise<Goal> {
  const existing = await repo.getGoal(id);
  if (!existing) {
    throw new Error(`Goal ${id} not found`);
  }
  const trimmed = text.trim();
  if (!trimmed) return existing;
  return updateGoal(id, {
    reviewLog: [
      ...(existing.reviewLog ?? []),
      { id: uuid(), at: new Date().toISOString(), text: trimmed },
    ],
  });
}

export async function appendProjectReviewNote(
  id: string,
  text: string
): Promise<Project> {
  const existing = await repo.getProject(id);
  if (!existing) {
    throw new Error(`Project ${id} not found`);
  }
  const trimmed = text.trim();
  if (!trimmed) return existing;
  return updateProject(id, {
    reviewLog: [
      ...(existing.reviewLog ?? []),
      { id: uuid(), at: new Date().toISOString(), text: trimmed },
    ],
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
