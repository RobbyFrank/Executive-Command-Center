"use server";

import { updateTag } from "next/cache";
import { fetchSlackChannels } from "@/lib/slack";
import {
  ECC_SLACK_SUGGESTIONS_TAG,
  ECC_TRACKER_DATA_TAG,
} from "@/lib/cache-tags";
import type { CreateScrapedItemsPayload } from "@/lib/schemas/tracker";
import {
  SlackScrapeSuggestionSchema,
  type SlackScrapeSuggestion,
  type SlackSuggestionRecord,
} from "@/lib/schemas/tracker";
import type { Goal, Milestone, Project } from "@/lib/types/tracker";
import { getRepository } from "@/server/repository";
import { mutateSlackSuggestions, readSlackSuggestions } from "@/server/repository/slack-suggestions-storage";
import {
  createMilestone,
  createScrapedItems,
  updateGoal,
  updateMilestone,
  updateProject,
} from "@/server/actions/tracker";
import { computeSlackSuggestionDedupeKey } from "@/lib/slackSuggestionDedupe";
import { isScrapeSuggestionValidForCompany } from "@/server/actions/slackRoadmapSync/validate";

export type PendingWithCompanyName = SlackSuggestionRecord & {
  companyName: string;
};

export async function listPendingForReviewDashboard(): Promise<
  PendingWithCompanyName[]
> {
  const [doc, data] = await Promise.all([
    readSlackSuggestions(),
    getRepository().load(),
  ]);
  const nameBy = new Map(data.companies.map((c) => [c.id, c.name] as const));
  return doc.items
    .filter((i) => i.status === "pending")
    .map((i) => ({
      ...i,
      companyName: nameBy.get(i.companyId) ?? i.companyId,
    }));
}

function revalidateSlackSuggestions() {
  updateTag(ECC_SLACK_SUGGESTIONS_TAG);
}
function revalidateTracker() {
  updateTag(ECC_TRACKER_DATA_TAG);
}

export async function listPendingSlackSuggestions(): Promise<SlackSuggestionRecord[]> {
  const doc = await readSlackSuggestions();
  return doc.items.filter((i) => i.status === "pending");
}

export async function getPendingForCompany(
  companyId: string
): Promise<SlackSuggestionRecord[]> {
  const doc = await readSlackSuggestions();
  return doc.items.filter(
    (i) => i.companyId === companyId && i.status === "pending"
  );
}

export async function getSlackPendingForRoadmap(
  _people: unknown,
  companies: { id: string; name: string }[]
) {
  const doc = await readSlackSuggestions();
  const byId = new Map(companies.map((c) => [c.id, c.name] as const));
  const pending = doc.items.filter((i) => i.status === "pending");
  return pending.map((p) => ({
    ...p,
    companyName: byId.get(p.companyId) ?? p.companyId,
  }));
}

export async function approveSlackSuggestion(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const doc = await readSlackSuggestions();
  const rec = doc.items.find((i) => i.id === id);
  if (!rec) {
    return { ok: false, error: "Suggestion not found" };
  }
  if (rec.status !== "pending") {
    return { ok: false, error: "Not pending" };
  }

  const p = rec.payload;
  const companyId = rec.companyId;

  try {
    if (p.kind === "newGoalWithProjects") {
      const body: CreateScrapedItemsPayload = {
        companyId,
        bundles: [{ goal: p.goal, projects: p.projects }],
        projectsOnExistingGoals: [],
      };
      const r = await createScrapedItems(body);
      if (!r.ok) {
        return r;
      }
    } else if (p.kind === "newProjectOnExistingGoal") {
      const body: CreateScrapedItemsPayload = {
        companyId,
        bundles: [],
        projectsOnExistingGoals: [
          { goalId: p.existingGoalId, project: p.project },
        ],
      };
      const r = await createScrapedItems(body);
      if (!r.ok) {
        return r;
      }
    } else if (p.kind === "editGoal") {
      const g = p.patch;
      const upd: Partial<Goal> = {};
      if (g.description !== undefined) upd.description = g.description;
      if (g.measurableTarget !== undefined) upd.measurableTarget = g.measurableTarget;
      if (g.whyItMatters !== undefined) upd.whyItMatters = g.whyItMatters;
      if (g.currentValue !== undefined) upd.currentValue = g.currentValue;
      if (g.ownerPersonId !== undefined) upd.ownerId = g.ownerPersonId;
      if (g.slackChannelId !== undefined) {
        upd.slackChannelId = g.slackChannelId;
        const list = await fetchSlackChannels();
        const ch = list.ok
          ? list.channels.find((c) => c.id === g.slackChannelId)
          : undefined;
        upd.slackChannel = ch?.name ?? "";
      }
      await updateGoal(p.existingGoalId, upd);
    } else if (p.kind === "editProject") {
      const pr = p.patch;
      const upd: Partial<Project> = {};
      if (pr.name !== undefined) upd.name = pr.name;
      if (pr.description !== undefined) upd.description = pr.description;
      if (pr.status !== undefined) upd.status = pr.status;
      if (pr.priority !== undefined) upd.priority = pr.priority;
      if (pr.assigneePersonId !== undefined) {
        const a = pr.assigneePersonId.trim();
        upd.assigneeIds = a ? [a] : [];
      }
      await updateProject(p.existingProjectId, upd);
    } else if (p.kind === "addMilestoneToExistingProject") {
      await createMilestone({
        projectId: p.existingProjectId,
        name: p.milestone.name,
        status: "Not Done",
        targetDate: p.milestone.targetDate,
        slackUrl: "",
      });
    } else if (p.kind === "editMilestone") {
      const u: Partial<Milestone> = {};
      if (p.patch.name !== undefined) u.name = p.patch.name;
      if (p.patch.targetDate !== undefined) u.targetDate = p.patch.targetDate;
      await updateMilestone(p.existingMilestoneId, u);
    } else {
      const _ex: never = p;
      return { ok: false, error: "Unknown kind" + String(_ex) };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  await mutateSlackSuggestions((d) => {
    const idx = d.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    d.items[idx] = { ...d.items[idx]!, status: "approved" };
  });
  revalidateSlackSuggestions();
  revalidateTracker();
  return { ok: true };
}

export async function updateSlackSuggestionPayload(
  id: string,
  payload: SlackScrapeSuggestion
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = SlackScrapeSuggestionSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Invalid suggestion payload" };
  }
  const nextPayload = parsed.data;

  const data = await getRepository().load();
  const doc = await readSlackSuggestions();
  const rec = doc.items.find((i) => i.id === id);
  if (!rec) {
    return { ok: false, error: "Suggestion not found" };
  }
  if (rec.status !== "pending") {
    return { ok: false, error: "Not pending" };
  }
  if (rec.payload.kind !== nextPayload.kind) {
    return { ok: false, error: "Cannot change suggestion kind" };
  }
  if (!isScrapeSuggestionValidForCompany(data, rec.companyId, nextPayload)) {
    return {
      ok: false,
      error: "Payload no longer matches tracker (orphaned ids)",
    };
  }

  const newKey = computeSlackSuggestionDedupeKey(rec.companyId, nextPayload);
  const dup = doc.items.some(
    (i) =>
      i.id !== id &&
      i.companyId === rec.companyId &&
      i.status === "pending" &&
      i.dedupeKey === newKey
  );
  if (dup) {
    return {
      ok: false,
      error: "Another pending suggestion already matches this revision",
    };
  }

  const now = new Date().toISOString();
  await mutateSlackSuggestions((d) => {
    const idx = d.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const cur = d.items[idx]!;
    if (cur.status !== "pending") return;
    d.items[idx] = {
      ...cur,
      payload: nextPayload,
      dedupeKey: newKey,
      lastSeenAt: now,
    };
  });
  revalidateSlackSuggestions();
  return { ok: true };
}

export async function rejectSlackSuggestion(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const doc = await readSlackSuggestions();
  const rec = doc.items.find((i) => i.id === id);
  if (!rec) {
    return { ok: false, error: "Suggestion not found" };
  }
  if (rec.status !== "pending") {
    return { ok: false, error: "Not pending" };
  }
  const companyId = rec.companyId;
  const key = rec.dedupeKey;

  await mutateSlackSuggestions((d) => {
    const idx = d.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    d.items[idx] = { ...d.items[idx]!, status: "rejected" };
    const set = new Set(d.rejectedKeysByCompany[companyId] ?? []);
    set.add(key);
    d.rejectedKeysByCompany[companyId] = [...set];
  });
  revalidateSlackSuggestions();
  return { ok: true };
}

export async function bulkApproveForCompany(companyId: string): Promise<{
  count: number;
  errors: string[];
}> {
  const doc = await readSlackSuggestions();
  const pending = doc.items.filter(
    (i) => i.companyId === companyId && i.status === "pending"
  );
  const errors: string[] = [];
  let count = 0;
  for (const p of pending) {
    const r = await approveSlackSuggestion(p.id);
    if (r.ok) {
      count += 1;
    } else {
      errors.push(`${p.id}: ${r.error}`);
    }
  }
  return { count, errors };
}

/** Approve only the given ids (e.g. current filter view). Order preserved; skips missing/non-pending. */
export async function bulkApproveSlackSuggestionIds(ids: string[]): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let count = 0;
  for (const id of ids) {
    const r = await approveSlackSuggestion(id);
    if (r.ok) {
      count += 1;
    } else {
      errors.push(`${id}: ${r.error}`);
    }
  }
  return { count, errors };
}
