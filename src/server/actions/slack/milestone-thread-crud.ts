"use server";

import {
  getSlackMessagePermalink,
  postSlackChannelMessage,
} from "@/lib/slack";
import {
  buildMilestoneThreadContextBlock,
  buildMilestoneThreadReviseUserPayload,
  MILESTONE_THREAD_DRAFT_SYSTEM_PROMPT,
  MILESTONE_THREAD_REVISE_SYSTEM_PROMPT,
} from "@/server/slackMilestoneThreadDraftContext";
import { getRepository } from "@/server/repository";
import { updateMilestone } from "@/server/actions/tracker";
import { claudePlainText } from "./thread-ai-shared";

export type DraftMilestoneThreadMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function draftMilestoneThreadMessage(
  milestoneId: string
): Promise<DraftMilestoneThreadMessageResult> {
  const ctx = await buildMilestoneThreadContextBlock(milestoneId);
  if (!ctx.ok) return ctx;

  try {
    const message = await claudePlainText(
      MILESTONE_THREAD_DRAFT_SYSTEM_PROMPT,
      ctx.userBlock
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type ReviseMilestoneThreadDraftResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function reviseMilestoneThreadDraft(
  milestoneId: string,
  currentDraft: string,
  feedback: string
): Promise<ReviseMilestoneThreadDraftResult> {
  const ctx = await buildMilestoneThreadContextBlock(milestoneId);
  if (!ctx.ok) return ctx;

  const fb = feedback.trim();
  if (!fb) {
    return { ok: false, error: "Feedback is empty." };
  }

  try {
    const message = await claudePlainText(
      MILESTONE_THREAD_REVISE_SYSTEM_PROMPT,
      buildMilestoneThreadReviseUserPayload(ctx.userBlock, currentDraft, fb)
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type CreateMilestoneSlackThreadResult =
  | { ok: true; slackUrl: string }
  | { ok: false; error: string };

export async function createMilestoneSlackThread(
  milestoneId: string,
  channelId: string,
  message: string
): Promise<CreateMilestoneSlackThreadResult> {
  const ch = channelId.trim();
  const text = message.trim();
  if (!ch) {
    return { ok: false, error: "Slack channel is not set." };
  }
  if (!text) {
    return { ok: false, error: "Message is empty." };
  }

  const repo = getRepository();
  const data = await repo.load();
  const milestone = data.milestones.find((m) => m.id === milestoneId);
  if (!milestone) {
    return { ok: false, error: "Milestone not found." };
  }
  const project = data.projects.find((p) => p.id === milestone.projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }
  const goal = data.goals.find((g) => g.id === project.goalId);
  if (!goal) {
    return { ok: false, error: "Goal not found." };
  }
  const goalCh = (goal.slackChannelId ?? "").trim();
  if (!goalCh || goalCh !== ch) {
    return {
      ok: false,
      error:
        "Channel does not match this goal’s Slack channel. Refresh the Roadmap and try again.",
    };
  }

  const posted = await postSlackChannelMessage(ch, text);
  if (!posted.ok) return posted;

  const link = await getSlackMessagePermalink(posted.channel, posted.ts);
  if (!link.ok) return link;

  await updateMilestone(milestoneId, { slackUrl: link.permalink });
  return { ok: true, slackUrl: link.permalink };
}
