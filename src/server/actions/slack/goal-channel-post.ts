"use server";

import { postSlackChannelMessage } from "@/lib/slack";
import { getRepository } from "@/server/repository";
import { claudePlainText } from "./thread-ai-shared";

export type PostGoalChannelMessageResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Post a fresh top-level message to the goal's Slack channel (not in any thread).
 * Validates the goal exists and has a `slackChannelId`, then sends via `postSlackChannelMessage`.
 */
export async function postGoalChannelMessage(
  goalId: string,
  message: string
): Promise<PostGoalChannelMessageResult> {
  const text = message.trim();
  if (!text) return { ok: false, error: "Message is empty." };

  const repo = getRepository();
  const data = await repo.load();
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) return { ok: false, error: "Goal not found." };
  const ch = (goal.slackChannelId ?? "").trim();
  if (!ch) {
    return {
      ok: false,
      error: "Goal has no Slack channel set.",
    };
  }

  const posted = await postSlackChannelMessage(ch, text);
  if (!posted.ok) return posted;
  return { ok: true };
}

export type DraftGoalChannelMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function buildGoalDraftContext(goalDescription: string, intent: string): string {
  const parts = [
    `Goal: "${goalDescription.trim() || "(untitled)"}"`,
    "",
    `Executive intent for this message: ${intent.trim()}`,
    "",
    "The message will be posted as a top-level message (not a thread reply) in the goal's Slack channel. Keep it concise (1–3 short paragraphs), neutral-professional tone, no markdown headers. Plain Slack text is fine (bold with *asterisks* is allowed). Do not invent details not implied by the intent.",
  ];
  return parts.join("\n");
}

const GOAL_DRAFT_SYSTEM_PROMPT =
  "You draft short, pragmatic Slack messages on behalf of an executive who oversees a goal. You will receive the goal description and the executive's intent. Respond with the message BODY only — no preamble, no quotes, no markdown fences.";

/** One-shot AI draft based on the executive's intent (no streaming). */
export async function draftGoalChannelMessage(
  goalDescription: string,
  intent: string
): Promise<DraftGoalChannelMessageResult> {
  const desc = goalDescription.trim();
  const int = intent.trim();
  if (!int) return { ok: false, error: "Describe what you want to say." };
  try {
    const message = await claudePlainText(
      GOAL_DRAFT_SYSTEM_PROMPT,
      buildGoalDraftContext(desc, int)
    );
    return { ok: true, message: message.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type ReviseGoalChannelMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const GOAL_REVISE_SYSTEM_PROMPT =
  "You revise Slack messages drafted by an executive for a goal's Slack channel. Apply the feedback tightly and return only the revised message BODY — no preamble, no quotes, no markdown fences.";

/** Revise an existing draft with a short feedback hint. */
export async function reviseGoalChannelMessage(
  goalDescription: string,
  currentDraft: string,
  feedback: string
): Promise<ReviseGoalChannelMessageResult> {
  const desc = goalDescription.trim();
  const draft = currentDraft.trim();
  const fb = feedback.trim();
  if (!draft) return { ok: false, error: "Draft is empty." };
  if (!fb) return { ok: false, error: "Feedback is empty." };
  try {
    const userPayload = [
      `Goal: "${desc || "(untitled)"}"`,
      "",
      "Current draft:",
      draft,
      "",
      `Revision feedback: ${fb}`,
    ].join("\n");
    const message = await claudePlainText(
      GOAL_REVISE_SYSTEM_PROMPT,
      userPayload
    );
    return { ok: true, message: message.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
