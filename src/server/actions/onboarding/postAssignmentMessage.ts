"use server";

import {
  getSlackMessagePermalink,
  openSlackMpim,
  postSlackChannelMessage,
} from "@/lib/slack";
import { updateMilestone } from "@/server/actions/tracker";
import { getRepository } from "@/server/repository";
import { isFounderPerson } from "@/lib/autonomyRoster";

/**
 * Posts a top-level message to the given channel (typically onboarding MPIM) and links
 * the first open milestone on the project to that message's permalink.
 */
export async function postOnboardingAssignmentMessage(input: {
  projectId: string;
  channelId: string;
  text: string;
}): Promise<{ ok: true; milestoneId: string; permalink: string } | { ok: false; error: string }> {
  const projectId = input.projectId.trim();
  const channelId = input.channelId.trim();
  const text = input.text.trim();
  if (!projectId || !channelId || !text) {
    return { ok: false, error: "projectId, channelId, and text are required." };
  }

  const repo = getRepository();
  const project = await repo.getProject(projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const milestones = await repo.getMilestonesByProject(projectId);
  const next = milestones.find((m) => m.status !== "Done");
  if (!next) {
    return { ok: false, error: "No open milestone to attach the Slack thread to." };
  }

  const posted = await postSlackChannelMessage(channelId, text);
  if (!posted.ok) {
    return { ok: false, error: posted.error };
  }

  const perm = await getSlackMessagePermalink(posted.channel, posted.ts);
  if (!perm.ok) {
    return { ok: false, error: perm.error };
  }

  await updateMilestone(next.id, { slackUrl: perm.permalink });

  return { ok: true, milestoneId: next.id, permalink: perm.permalink };
}

function trimUid(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

/**
 * Resolves Nadav's Slack user id for buddy MPIMs. Prefers the roster (`Person.id === "nadav"`),
 * then any founder named "Nadav", then `NADAV_SLACK_USER_ID` env override.
 */
async function resolveNadavSlackUserId(): Promise<string> {
  const repo = getRepository();
  const people = await repo.getPeople();
  const direct = people.find((p) => p.id === "nadav");
  const directHandle = trimUid(direct?.slackHandle);
  if (directHandle) return directHandle;

  const founderNadav = people.find(
    (p) =>
      isFounderPerson(p) && p.name.trim().toLowerCase().startsWith("nadav")
  );
  const founderHandle = trimUid(founderNadav?.slackHandle);
  if (founderHandle) return founderHandle;

  return trimUid(process.env.NADAV_SLACK_USER_ID);
}

/**
 * Opens (or reuses) a group DM with Robby + the new hire + Nadav + the chosen buddies,
 * posts the assignment message there, and attaches the permalink to the project's first
 * open milestone. Robby is implicit (he is the OAuth user posting the message).
 */
export async function openBuddyMpimAndPostAssignment(input: {
  projectId: string;
  newHireSlackUserId: string;
  buddySlackUserIds: string[];
  text: string;
  /** When true and Nadav's Slack id is resolvable, include him for visibility/oversight. */
  includeNadav?: boolean;
}): Promise<
  | {
      ok: true;
      milestoneId: string;
      channelId: string;
      permalink: string;
      alreadyOpen: boolean;
    }
  | { ok: false; error: string }
> {
  const projectId = input.projectId.trim();
  const text = input.text.trim();
  const hireId = trimUid(input.newHireSlackUserId);
  const buddyIds = (input.buddySlackUserIds ?? [])
    .map(trimUid)
    .filter((u) => u.length > 0);

  if (!projectId || !text) {
    return { ok: false, error: "projectId and text are required." };
  }
  if (!hireId) {
    return { ok: false, error: "New hire is missing a Slack user id." };
  }
  if (buddyIds.length === 0) {
    return {
      ok: false,
      error: "Select at least one onboarding partner with a Slack user id.",
    };
  }

  const repo = getRepository();
  const project = await repo.getProject(projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const milestones = await repo.getMilestonesByProject(projectId);
  const next = milestones.find((m) => m.status !== "Done");
  if (!next) {
    return { ok: false, error: "No open milestone to attach the Slack thread to." };
  }

  const userIds = [hireId, ...buddyIds];
  if (input.includeNadav !== false) {
    const nadavId = await resolveNadavSlackUserId();
    if (nadavId && nadavId !== hireId && !buddyIds.includes(nadavId)) {
      userIds.push(nadavId);
    }
  }

  /** Slack `conversations.open` accepts 1-8 user ids in `users` (caller is auto-added). */
  if (userIds.length > 8) {
    return {
      ok: false,
      error: `Too many participants for a Slack group DM (got ${userIds.length}, max 8). Reduce the onboarding partner list.`,
    };
  }

  const opened = await openSlackMpim(userIds);
  if (!opened.ok) {
    return { ok: false, error: opened.error };
  }

  const posted = await postSlackChannelMessage(opened.channelId, text);
  if (!posted.ok) {
    return { ok: false, error: posted.error };
  }

  const perm = await getSlackMessagePermalink(posted.channel, posted.ts);
  if (!perm.ok) {
    return { ok: false, error: perm.error };
  }

  await updateMilestone(next.id, { slackUrl: perm.permalink });

  return {
    ok: true,
    milestoneId: next.id,
    channelId: opened.channelId,
    permalink: perm.permalink,
    alreadyOpen: opened.alreadyOpen,
  };
}
