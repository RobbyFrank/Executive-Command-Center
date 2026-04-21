"use server";

import { slackUserTokenForThreads } from "@/lib/slack";
import {
  claudePlainText,
  resolveThreadReplySenderIdentity,
  rosterMapFromHints,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";
import type { MilestoneLikelihoodRiskLevel } from "./milestone-likelihood";

/**
 * Per-project signal the executive sees in the goal popover — passed to AI so drafts call out
 * specific projects by name (with likelihood / risk / summary / blocker note when relevant).
 */
export type GoalChannelAiProjectSignal = {
  projectName: string;
  /** Empty when the project has no pending milestone. */
  milestoneName: string;
  scored: boolean;
  likelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  progressEstimate: number;
  summaryLine: string;
  /** Short "Blocked by X" or "Blocked" note; empty when not blocked. */
  blockerNote: string;
  /** Reason label when unscored (e.g. "No target date"); empty when scored. */
  reasonLabel: string;
  /** Owner display name for the project (empty when unassigned). */
  ownerName: string;
};

export type GoalChannelAiRollup = {
  ready: boolean;
  onTimeLikelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  aiConfidence: number;
  coverageCached: number;
  coverageTotal: number;
};

export type GoalChannelAiContext = {
  goalDescription: string;
  /** Short one-liner AI summary rendered in the popover; optional. */
  oneLinerSummary: string;
  rollup: GoalChannelAiRollup;
  projects: GoalChannelAiProjectSignal[];
  /** Owner roster for `<@UID>` resolution when addressing the team. */
  rosterHints: SlackMemberRosterHint[];
};

export type GenerateGoalChannelMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function formatProjectBullet(p: GoalChannelAiProjectSignal): string {
  const bits: string[] = [];
  bits.push(p.projectName);
  if (p.ownerName.trim()) bits.push(`owner: ${p.ownerName.trim()}`);
  if (p.scored) {
    bits.push(
      `on-time ${p.likelihood}% (${p.riskLevel}), est. done ${Math.round(p.progressEstimate)}%`
    );
    if (p.milestoneName.trim()) bits.push(`next: ${p.milestoneName.trim()}`);
    if (p.summaryLine.trim()) bits.push(`note: ${p.summaryLine.trim()}`);
  } else {
    const label = p.reasonLabel.trim() || "not yet assessed";
    bits.push(label);
    if (p.milestoneName.trim()) bits.push(`next: ${p.milestoneName.trim()}`);
  }
  if (p.blockerNote.trim()) bits.push(p.blockerNote.trim());
  /** Use " | " as a bullet field joiner so the context block does not itself contain em-dashes the prompt forbids. */
  return `- ${bits.join(" | ")}`;
}

function buildGoalAuthorshipBackground(
  senderDisplayName: string | null,
  senderSlackUserId: string | null,
  rosterHints: SlackMemberRosterHint[]
): string {
  const lines: string[] = [];
  lines.push("Authorship:");
  if (senderDisplayName && senderSlackUserId) {
    lines.push(
      `- You are writing this channel message AS ${senderDisplayName} (Slack <@${senderSlackUserId}>). Speak in first person ("I", "my", "our"). Do NOT @-mention yourself and do NOT write out your own name anywhere in the message.`
    );
  } else if (senderDisplayName) {
    lines.push(
      `- You are writing this channel message AS ${senderDisplayName}. Speak in first person ("I", "my", "our"). Do NOT write out your own name anywhere in the message.`
    );
  } else {
    lines.push(
      '- You are writing this channel message as the person posting from this account. Speak in first person ("I", "my", "our"). Do not invent a sender name or @-mention anyone as the sender.'
    );
  }

  const senderUid = senderSlackUserId?.trim().toUpperCase() ?? "";
  const mentionable = rosterHints
    .map((h) => ({ uid: h.slackUserId.trim().toUpperCase(), name: h.name.trim() }))
    .filter((r) => r.uid && r.name && r.uid !== senderUid);

  if (mentionable.length > 0) {
    const list = mentionable
      .map((r) => `${r.name} (<@${r.uid}>)`)
      .join(", ");
    lines.push(
      `- The project owners on this goal are: ${list}. When asking for a status update or pushing on the deadline, address each relevant owner by their <@UID> token so they get a Slack notification. Never @-mention yourself. Only @-mention owners whose project is actually the one you are calling out.`
    );
  } else {
    lines.push(
      "- No other roster owners were provided; address the channel generically (no @-mentions) unless there is clear reason otherwise."
    );
  }

  lines.push(
    "- This is a NEW top-level channel post (not a thread reply). Keep it concise: a single short paragraph, at most 3 sentences. Never use an em-dash (Unicode U+2014); use commas, colons, ASCII hyphens, or parentheses instead."
  );
  return lines.join("\n");
}

function buildGoalContextBlock(ctx: GoalChannelAiContext): string {
  const parts: string[] = [];
  parts.push(`Goal: "${ctx.goalDescription.trim() || "(untitled)"}"`);
  if (ctx.rollup.ready) {
    parts.push(
      `Rollup on-time likelihood: ${ctx.rollup.onTimeLikelihood}% (${ctx.rollup.riskLevel})`
    );
    parts.push(
      `Rollup AI confidence (progress × on-time): ${ctx.rollup.aiConfidence}%`
    );
    parts.push(
      `Coverage: ${ctx.rollup.coverageCached}/${ctx.rollup.coverageTotal} projects scored`
    );
  } else {
    parts.push("Rollup not ready yet (AI is still assessing milestones).");
  }
  if (ctx.oneLinerSummary.trim()) {
    parts.push(`One-line summary: ${ctx.oneLinerSummary.trim()}`);
  }
  parts.push("");
  parts.push("Per-project signals:");
  if (ctx.projects.length === 0) {
    parts.push("- (no projects)");
  } else {
    for (const p of ctx.projects) parts.push(formatProjectBullet(p));
  }
  return parts.join("\n");
}

async function resolveSender(
  rosterHints: SlackMemberRosterHint[]
): Promise<{ displayName: string | null; slackUserId: string | null }> {
  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sender = await resolveThreadReplySenderIdentity(token, rosterById);
  return { displayName: sender.displayName, slackUserId: sender.slackUserId };
}

/**
 * Draft a channel-level "ask for a goal update" message — friendly, concrete, names the
 * projects that are scoring worst and @-mentions their owners.
 */
export async function generateGoalChannelPingMessage(
  ctx: GoalChannelAiContext
): Promise<GenerateGoalChannelMessageResult> {
  const sender = await resolveSender(ctx.rosterHints);
  const authorship = buildGoalAuthorshipBackground(
    sender.displayName,
    sender.slackUserId,
    ctx.rosterHints
  );
  const contextBlock = buildGoalContextBlock(ctx);

  const system = [
    "You draft short, executive-voice Slack messages posted as a new top-level message in a goal's Slack channel (not a thread reply).",
    "Task: write a friendly, pragmatic message asking the goal's project owners for a status update.",
    "Priorities: (1) call out by name the project(s) that look most at risk or unscheduled, (2) mention each relevant owner via their <@UID> token so they are notified, (3) keep it concise: 1 to 3 short sentences, single paragraph.",
    "Follow the Authorship rules in the background strictly: write in first person, never @-mention or name yourself, only @-mention owners you are actually calling on.",
    "Output only the message BODY: no preamble, no quotes, no markdown fences. Never use an em-dash (U+2014); use commas, colons, ASCII hyphens, or parentheses.",
  ].join(" ");

  try {
    const message = await claudePlainText(
      system,
      [authorship, "", contextBlock].join("\n")
    );
    return { ok: true, message: message.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Draft a channel-level "push on timeline" message: stresses that the goal is slipping
 * (uses rollup on-time %) and names the specific worst projects.
 */
export async function generateGoalChannelNudgeMessage(
  ctx: GoalChannelAiContext
): Promise<GenerateGoalChannelMessageResult> {
  if (!ctx.rollup.ready) {
    return {
      ok: false,
      error: "Deadline nudge needs a completed goal assessment. Wait a moment and try again.",
    };
  }

  const sender = await resolveSender(ctx.rosterHints);
  const authorship = buildGoalAuthorshipBackground(
    sender.displayName,
    sender.slackUserId,
    ctx.rosterHints
  );
  const contextBlock = buildGoalContextBlock(ctx);

  const system = [
    "You draft short, executive-voice Slack messages posted as a new top-level message in a goal's Slack channel (not a thread reply).",
    "Task: write a direct, respectful message that pushes on the goal's timeline. Be concrete: cite the rollup on-time % and call out 1 or 2 projects dragging it down.",
    "Tone: firm but constructive (not alarmist). Ask for a specific action: a status and a realistic date.",
    "Length: 1 to 3 short sentences, single paragraph.",
    "Follow the Authorship rules strictly: first person, no self @-mentions. @-mention the owners of the worst project(s) by their <@UID> token.",
    "Output only the message BODY: no preamble, no quotes, no markdown fences. Never use an em-dash (U+2014); use commas, colons, ASCII hyphens, or parentheses.",
  ].join(" ");

  try {
    const message = await claudePlainText(
      system,
      [authorship, "", contextBlock].join("\n")
    );
    return { ok: true, message: message.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Revise an existing goal-channel draft using the same goal context + authorship rules as
 * the drafting actions.
 */
export async function reviseGoalChannelAiMessage(
  ctx: GoalChannelAiContext,
  currentDraft: string,
  feedback: string
): Promise<GenerateGoalChannelMessageResult> {
  const draft = currentDraft.trim();
  const fb = feedback.trim();
  if (!draft) return { ok: false, error: "Draft is empty." };
  if (!fb) return { ok: false, error: "Feedback is empty." };

  const sender = await resolveSender(ctx.rosterHints);
  const authorship = buildGoalAuthorshipBackground(
    sender.displayName,
    sender.slackUserId,
    ctx.rosterHints
  );
  const contextBlock = buildGoalContextBlock(ctx);

  const system = [
    "The user wants you to revise a Slack channel message about a goal (not a thread reply).",
    "Apply their feedback while keeping the tone executive-appropriate and the length short (1 to 3 sentences, one paragraph).",
    "Never use an em-dash (U+2014); use commas, colons, ASCII hyphens, or parentheses.",
    "Follow the Authorship rules strictly: first person, do NOT @-mention yourself or write out your own name.",
    "Output only the revised message BODY: no preamble, no quotes, no markdown fences.",
  ].join(" ");

  const userPayload = [
    authorship,
    "",
    contextBlock,
    "",
    "Current draft:",
    draft,
    "",
    `Revision feedback: ${fb}`,
  ].join("\n");

  try {
    const message = await claudePlainText(system, userPayload);
    return { ok: true, message: message.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
