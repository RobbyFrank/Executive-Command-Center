"use server";

import { updateTag } from "next/cache";
import { getRepository } from "@/server/repository";
import { ECC_TRACKER_DATA_TAG } from "@/lib/cache-tags";
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
import { isGoalDriEligiblePerson } from "@/lib/autonomyRoster";
import { calendarDateTodayLocal } from "@/lib/relativeCalendarDate";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { isBlockingProjectIncomplete } from "@/lib/blocked-status";
import {
  createScrapedItemsPayloadSchema,
  type CreateScrapedItemsPayload,
} from "@/lib/schemas/tracker";

const repo = getRepository();

/** True when this project has a blocking dependency whose milestones are not all done. */
async function projectIsDependencyBlocked(projectId: string): Promise<boolean> {
  const project = await repo.getProject(projectId);
  if (!project) return false;
  const blockerId = (project.blockedByProjectId ?? "").trim();
  if (!blockerId) return false;
  const blockerMilestones = await repo.getMilestonesByProject(blockerId);
  return isBlockingProjectIncomplete(blockerMilestones);
}

/** When a milestone gets a real Slack thread URL, treat the project as started. */
async function maybePromoteProjectToInProgressWhenMilestoneGetsSlackUrl(
  projectId: string,
  previousSlackUrl: string | undefined,
  nextSlackUrl: string
): Promise<void> {
  const next = nextSlackUrl.trim();
  if (!isValidHttpUrl(next)) return;
  if (isValidHttpUrl((previousSlackUrl ?? "").trim())) return;
  const project = await repo.getProject(projectId);
  if (!project) return;
  if (project.status !== "Idea" && project.status !== "Pending") return;
  await repo.updateProject(projectId, { status: "In Progress" });
}

function revalidateTrackerPages() {
  updateTag(ECC_TRACKER_DATA_TAG);
}

// --- Companies ---

export async function createCompany(
  data: Omit<Company, "id">
): Promise<Company> {
  const id = uuid();
  const company = { id, ...data };
  await repo.createCompany(company);
  revalidateTrackerPages();
  return company;
}

export async function updateCompany(
  id: string,
  updates: Partial<Company>
): Promise<Company> {
  const result = await repo.updateCompany(id, updates);
  revalidateTrackerPages();
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
  revalidateTrackerPages();
  return { error: null };
}

// --- Goals ---

export async function createGoal(
  data: Omit<Goal, "id" | "reviewLog" | "createdAt"> &
    Partial<Pick<Goal, "reviewLog">>
): Promise<Goal> {
  const id = uuid();
  const createdAt = calendarDateTodayLocal();
  const goal = {
    id,
    ...data,
    reviewLog: data.reviewLog ?? [],
    createdAt,
  };
  await repo.createGoal(goal);
  revalidateTrackerPages();
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
  revalidateTrackerPages();
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
  revalidateTrackerPages();
  return { error: null };
}

// --- Projects ---

export async function createProject(
  data: Omit<
    Project,
    | "id"
    | "reviewLog"
    | "createdAt"
    | "slackUrl"
    | "blockedByProjectId"
  > &
    Partial<Pick<Project, "reviewLog" | "slackUrl">>
): Promise<Project> {
  const id = uuid();
  const createdAt = calendarDateTodayLocal();
  const project = {
    id,
    slackUrl: "",
    blockedByProjectId: "",
    ...data,
    mirroredGoalIds: data.mirroredGoalIds ?? [],
    reviewLog: data.reviewLog ?? [],
    createdAt,
  };
  await repo.createProject(project);
  revalidateTrackerPages();
  return project;
}

export async function updateProject(
  id: string,
  updates: Partial<Project>
): Promise<Project> {
  if (updates.blockedByProjectId !== undefined) {
    const raw = updates.blockedByProjectId.trim();
    if (raw !== "" && raw === id) {
      throw new Error("A project cannot be blocked by itself.");
    }
  }
  const { createdAt: _omitCreatedAt, ...projectUpdates } = updates;

  let next: Partial<Project> = { ...projectUpdates };
  // `Blocked` is shown when a dependency blocks; it is not stored or set from the client.
  if (next.status === "Blocked") {
    const { status: _dropBlocked, ...rest } = next;
    next = rest;
  }
  if (next.status !== undefined && (await projectIsDependencyBlocked(id))) {
    const { status: _dropWhileBlocked, ...rest } = next;
    next = rest;
  }

  const result = await repo.updateProject(id, next);
  revalidateTrackerPages();
  return result;
}

export async function deleteProject(id: string): Promise<void> {
  await repo.deleteProject(id);
  revalidateTrackerPages();
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

/** Change the project's primary goal. Only allowed between goals that share the same company. */
export async function moveProjectToGoal(
  projectId: string,
  newGoalId: string
): Promise<Project> {
  const project = await repo.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  if (newGoalId === project.goalId) {
    throw new Error("That is already this project's primary goal.");
  }
  const currentGoal = await repo.getGoal(project.goalId);
  const nextGoal = await repo.getGoal(newGoalId);
  if (!currentGoal || !nextGoal) {
    throw new Error("Goal not found.");
  }
  if (currentGoal.companyId !== nextGoal.companyId) {
    throw new Error(
      "Projects can only be moved between goals of the same company."
    );
  }
  const mirrored = project.mirroredGoalIds ?? [];
  const nextMirrored = mirrored.filter((id) => id !== newGoalId);
  return updateProject(projectId, {
    goalId: newGoalId,
    mirroredGoalIds: nextMirrored,
  });
}

// --- Milestones ---

export async function createMilestone(
  data: Omit<Milestone, "id" | "slackUrl"> & Partial<Pick<Milestone, "slackUrl">>
): Promise<Milestone> {
  const id = uuid();
  const milestone: Milestone = { id, slackUrl: "", ...data };
  await repo.createMilestone(milestone);
  await maybePromoteProjectToInProgressWhenMilestoneGetsSlackUrl(
    milestone.projectId,
    "",
    milestone.slackUrl
  );
  revalidateTrackerPages();
  return milestone;
}

export async function updateMilestone(
  id: string,
  updates: Partial<Milestone>
): Promise<Milestone> {
  const previous =
    updates.slackUrl !== undefined ? await repo.getMilestone(id) : undefined;

  const result = await repo.updateMilestone(id, updates);

  if (updates.slackUrl !== undefined) {
    await maybePromoteProjectToInProgressWhenMilestoneGetsSlackUrl(
      result.projectId,
      previous?.slackUrl,
      result.slackUrl
    );
  }

  revalidateTrackerPages();
  return result;
}

export async function deleteMilestone(id: string): Promise<void> {
  await repo.deleteMilestone(id);
  revalidateTrackerPages();
}

/**
 * Batch-creates goals, projects, and milestones from Slack scrape review (single KV write).
 */
export async function createScrapedItems(
  payload: CreateScrapedItemsPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = createScrapedItemsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Invalid payload" };
  }

  const { companyId, bundles, projectsOnExistingGoals } = parsed.data;
  const company = await repo.getCompany(companyId);
  if (!company) {
    return { ok: false, error: "Company not found" };
  }

  const trackerData = await repo.load();
  const validPersonIds = new Set(trackerData.people.map((p) => p.id));

  const goalIdsForCompany = new Set(
    (await repo.getGoalsByCompany(companyId)).map((g) => g.id)
  );

  const goals: Goal[] = [];
  const projects: Project[] = [];
  const milestones: Milestone[] = [];
  const today = calendarDateTodayLocal();

  for (const bundle of bundles) {
    const goalId = uuid();
    const ownerPid = bundle.goal.ownerPersonId.trim();
    goals.push({
      id: goalId,
      companyId,
      createdAt: today,
      reviewLog: [],
      description: bundle.goal.description,
      measurableTarget: bundle.goal.measurableTarget,
      whyItMatters: bundle.goal.whyItMatters,
      currentValue: bundle.goal.currentValue,
      impactScore: bundle.goal.impactScore,
      confidenceScore: 0,
      costOfDelay: 3,
      ownerId: validPersonIds.has(ownerPid) ? ownerPid : "",
      priority: bundle.goal.priority,
      slackChannel: bundle.goal.slackChannel.trim(),
      slackChannelId: bundle.goal.slackChannelId.trim(),
      status: bundle.goal.status,
      atRisk: false,
      spotlight: false,
    });

    for (const pd of bundle.projects) {
      const projectId = uuid();
      const assigneePid = pd.assigneePersonId.trim();
      projects.push({
        id: projectId,
        goalId,
        createdAt: today,
        reviewLog: [],
        name: pd.name,
        description: pd.description,
        definitionOfDone: pd.definitionOfDone,
        priority: pd.priority,
        complexityScore: pd.complexityScore,
        type: pd.type,
        status: "Pending",
        ownerId: "",
        assigneeIds: validPersonIds.has(assigneePid) ? [assigneePid] : [],
        mirroredGoalIds: [],
        slackUrl: "",
        blockedByProjectId: "",
        atRisk: false,
        spotlight: false,
        startDate: "",
        targetDate: "",
      });
      for (const md of pd.milestones) {
        milestones.push({
          id: uuid(),
          projectId,
          name: md.name,
          status: "Not Done",
          targetDate: md.targetDate,
          slackUrl: "",
        });
      }
    }
  }

  for (const row of projectsOnExistingGoals) {
    if (!goalIdsForCompany.has(row.goalId)) {
      return { ok: false, error: "Invalid goal id for this company" };
    }
    const projectId = uuid();
    const assigneeExisting = row.project.assigneePersonId.trim();
    projects.push({
      id: projectId,
      goalId: row.goalId,
      createdAt: today,
      reviewLog: [],
      name: row.project.name,
      description: row.project.description,
      definitionOfDone: row.project.definitionOfDone,
      priority: row.project.priority,
      complexityScore: row.project.complexityScore,
      type: row.project.type,
      status: "Pending",
      ownerId: "",
      assigneeIds: validPersonIds.has(assigneeExisting)
        ? [assigneeExisting]
        : [],
      mirroredGoalIds: [],
      slackUrl: "",
      blockedByProjectId: "",
      atRisk: false,
      spotlight: false,
      startDate: "",
      targetDate: "",
    });
    for (const md of row.project.milestones) {
      milestones.push({
        id: uuid(),
        projectId,
        name: md.name,
        status: "Not Done",
        targetDate: md.targetDate,
        slackUrl: "",
      });
    }
  }

  if (goals.length === 0 && projects.length === 0) {
    return { ok: false, error: "Nothing to create" };
  }

  try {
    await repo.createScrapedItemsBatch({ goals, projects, milestones });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save scraped items",
    };
  }
  revalidateTrackerPages();
  return { ok: true };
}

// --- People ---

export async function createPerson(
  data: Omit<Person, "id" | "passwordHash">
): Promise<Person> {
  const id = uuid();
  const person: Person = { id, ...data, passwordHash: "" };
  const created = await repo.createPerson(person);
  revalidateTrackerPages();
  return created;
}

export async function updatePerson(
  id: string,
  updates: Partial<Omit<Person, "passwordHash">>
): Promise<Person> {
  const result = await repo.updatePerson(id, updates);
  revalidateTrackerPages();
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
  revalidateTrackerPages();
  return { error: null };
}

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

/** Per-company tracker stats for the Companies directory (uncached; use `getCachedCompanyStatsByCompanyId` on pages). */
export async function getCompanyStatsByCompanyId(): Promise<
  Record<string, CompanyDirectoryStats>
> {
  return repo.getCompanyStatsByCompanyId();
}

export async function getPeople() {
  return repo.getPeople();
}

export async function getPersonWorkloads() {
  return repo.getPersonWorkloads();
}
