"use server";

import {
  fetchSlackThreadReplies,
  parseSlackThreadUrl,
  postSlackThreadReply,
  slackUserTokenForThreads,
} from "@/lib/slack";
import type { DeadlineNudgeLikelihoodContext } from "./milestone-likelihood";
import {
  buildRecentThreadPingTranscript,
  buildThreadReplyAuthorshipBackground,
  calendarDaysDiffUtc,
  claudePlainText,
  parseMilestoneTargetDate,
  resolveThreadReplySenderIdentity,
  rosterMapFromHints,
  THREAD_PING_REVISE_SYSTEM_PROMPT,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";

export type GenerateThreadPingMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function generateThreadPingMessage(
  slackUrl: string,
  milestoneName: string,
  rosterHints?: SlackMemberRosterHint[],
  assigneeName?: string
): Promise<GenerateThreadPingMessageResult> {
  const tr = await buildRecentThreadPingTranscript(slackUrl, rosterHints);
  if (!tr.ok) return tr;
  const transcript = tr.transcript;

  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sender = await resolveThreadReplySenderIdentity(token, rosterById);
  const authorship = buildThreadReplyAuthorshipBackground(
    sender,
    assigneeName,
    rosterHints
  );

  const system = `Generate a brief, friendly follow-up message for this Slack thread about the milestone "${milestoneName}". Ask for a status update based on the recent conversation. Keep it to at most two short sentences. Sound natural and professional. Never use an em dash (Unicode U+2014); use commas, colons, ASCII hyphens, or parentheses instead. Follow the Authorship rules in the background strictly: write in first person, never @-mention or name yourself, and address the assigned person by their <@USER_ID> when asking for an update. Output only the message text to post — no quotes or preamble.`;

  const userPayload = [
    authorship,
    "",
    "Recent thread messages:",
    "",
    transcript || "(no text in thread)",
  ].join("\n");

  try {
    const message = await claudePlainText(system, userPayload);
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Revise a draft ping or deadline-nudge reply using the same thread context as generation.
 */
export async function reviseSlackThreadPingMessage(
  slackUrl: string,
  milestoneName: string,
  rosterHints: SlackMemberRosterHint[] | undefined,
  mode: "ping" | "nudge" | "reply",
  currentDraft: string,
  feedback: string,
  targetDate: string | undefined,
  likelihoodContext: DeadlineNudgeLikelihoodContext | null | undefined,
  assigneeName?: string
): Promise<GenerateThreadPingMessageResult> {
  const fb = feedback.trim();
  if (!fb) {
    return { ok: false, error: "Feedback is empty." };
  }
  const prev = currentDraft.trim();
  // In "reply" mode an empty draft is allowed — revise doubles as first-draft generation
  // when the user has not written anything yet.
  if (!prev && mode !== "reply") {
    return { ok: false, error: "Current draft is empty." };
  }

  if (mode === "nudge") {
    const td = targetDate?.trim() ?? "";
    if (!td || !likelihoodContext) {
      return {
        ok: false,
        error:
          "Deadline nudge needs a target date and a completed deadline assessment.",
      };
    }
  }

  const tr = await buildRecentThreadPingTranscript(slackUrl, rosterHints);
  if (!tr.ok) return tr;
  const transcript = tr.transcript;

  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sender = await resolveThreadReplySenderIdentity(token, rosterById);
  const authorship = buildThreadReplyAuthorshipBackground(
    sender,
    assigneeName,
    rosterHints
  );

  let modeInstructions: string;
  if (mode === "ping") {
    modeInstructions = `The reply asks for a status update on milestone "${milestoneName}". Keep it brief and grounded in the thread context.`;
  } else if (mode === "reply") {
    modeInstructions = `The reply is a general thread reply on milestone "${milestoneName}". The user's feedback below is the instruction for what to say (it is NOT revising an earlier draft — treat it as the intent for this reply). Sound natural, conversational, and grounded in the recent thread context. Keep it brief: 1-3 short sentences unless the intent clearly calls for more. If the current draft is empty, generate the reply from scratch; otherwise refine the current draft toward the intent.`;
  } else {
    const td = targetDate!.trim();
    const due = parseMilestoneTargetDate(td);
    if (!due) {
      return { ok: false, error: "Invalid or missing target date." };
    }
    const ctx = likelihoodContext!;
    const today = new Date();
    const todayCal = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const dueCal = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const daysRemaining = calendarDaysDiffUtc(dueCal, todayCal);
    const dueLabel = dueCal.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const daysPhrase =
      daysRemaining === 0
        ? "today"
        : daysRemaining === 1
          ? "1 day from now"
          : daysRemaining > 1
            ? `in ${daysRemaining} days`
            : daysRemaining === -1
              ? "yesterday (overdue)"
              : `${Math.abs(daysRemaining)} days ago (overdue)`;
    modeInstructions = `The reply is a manager/executive deadline nudge for milestone "${milestoneName}" due on ${dueLabel} (${daysPhrase}). Progress appears roughly ${ctx.progressEstimate}% complete; deadline risk is ${ctx.riskLevel}. Context: ${ctx.reasoning}. Keep first-person executive voice. Do not mention AI or "assessment". Tone scales with risk.`;
  }

  const draftBlock = prev ? `Current draft:\n${prev}` : "Current draft:\n(empty — generate from scratch)";
  const feedbackLabel = mode === "reply" ? "User intent" : "User feedback";
  const userPayload = `${authorship}\n\n---\n\nMode and goal:\n${modeInstructions}\n\nRecent thread messages:\n\n${transcript || "(no text in thread)"}\n\n---\n\n${draftBlock}\n\n---\n\n${feedbackLabel}:\n${fb}`;

  try {
    const message = await claudePlainText(
      THREAD_PING_REVISE_SYSTEM_PROMPT,
      userPayload
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type PingSlackThreadResult = { ok: true } | { ok: false; error: string };

export async function pingSlackThread(
  slackUrl: string,
  message: string
): Promise<PingSlackThreadResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid Slack thread URL." };
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "Message is empty." };
  }

  const rep = await fetchSlackThreadReplies(parsed.channelId, parsed.threadTs);
  if (!rep.ok) return rep;

  return postSlackThreadReply(parsed.channelId, rep.rootTs, trimmed);
}

export type GenerateDeadlineNudgeMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Draft a manager-voice Slack reply that stresses the milestone deadline.
 */
export async function generateDeadlineNudgeMessage(
  slackUrl: string,
  milestoneName: string,
  targetDate: string,
  rosterHints: SlackMemberRosterHint[] | undefined,
  likelihoodContext: DeadlineNudgeLikelihoodContext,
  assigneeName?: string
): Promise<GenerateDeadlineNudgeMessageResult> {
  const due = parseMilestoneTargetDate(targetDate);
  if (!due) {
    return { ok: false, error: "Invalid or missing target date." };
  }

  const tr = await buildRecentThreadPingTranscript(slackUrl, rosterHints);
  if (!tr.ok) return tr;
  const transcript = tr.transcript;

  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sender = await resolveThreadReplySenderIdentity(token, rosterById);
  const authorship = buildThreadReplyAuthorshipBackground(
    sender,
    assigneeName,
    rosterHints
  );

  const today = new Date();
  const todayCal = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const dueCal = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const daysRemaining = calendarDaysDiffUtc(dueCal, todayCal);
  const dueLabel = dueCal.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const daysPhrase =
    daysRemaining === 0
      ? "today"
      : daysRemaining === 1
        ? "1 day from now"
        : daysRemaining > 1
          ? `in ${daysRemaining} days`
          : daysRemaining === -1
            ? "yesterday (overdue)"
            : `${Math.abs(daysRemaining)} days ago (overdue)`;

  try {
    const message = await claudePlainText(
      `Generate a message to post in this Slack thread from the executive/manager's first-person perspective (use "I" / "I want"). The milestone "${milestoneName}" is due on ${dueLabel} (${daysPhrase}). Based on our assessment, progress appears to be roughly ${likelihoodContext.progressEstimate}% complete, and deadline risk is ${likelihoodContext.riskLevel}. Context: ${likelihoodContext.reasoning}

The message must:
- Clearly state the deadline and urgency
- Acknowledge progress if appropriate
- Ask the assigned person (see Authorship in background) to prioritize finishing on time, using their <@USER_ID> token — tone scales with risk (${likelihoodContext.riskLevel})
- Be direct but professional, 2-4 sentences
- NOT mention AI, automation, or "assessment"
- Follow the Authorship rules strictly: first-person voice, never @-mention or name yourself, address the assignee
- Never use an em dash (Unicode U+2014); use commas, colons, ASCII hyphens, or parentheses instead
- Output only the message text to post — no quotes or preamble.`,
      `${authorship}\n\nRecent thread messages:\n\n${transcript || "(no text in thread)"}`
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
