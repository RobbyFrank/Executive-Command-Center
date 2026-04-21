"use server";

import {
  claudePlainText,
  resolveThreadReplySenderIdentity,
  buildThreadReplyAuthorshipBackground,
  rosterMapFromHints,
  type SlackMemberRosterHint,
} from "@/server/actions/slack/thread-ai-shared";
import { slackUserTokenForThreads } from "@/lib/slack";
import type { Person } from "@/lib/types/tracker";
import { SLACK_GUIDELINES_LOOM_URL } from "@/lib/onboarding-welcome-signals";

const ASSIGNMENT_SYSTEM = `You draft a short top-level Slack message in a group DM to welcome a new hire to their first pilot project.

Rules:
- First person as the sender (Robby). Never use an em dash (U+2014); use commas or ASCII hyphens.
- Address the new hire using their Slack user mention token exactly as given (e.g. <@U…>) once near the start.
- Do not repeat boilerplate that already appeared in Nadav's welcome message (the background may include a snippet; skip overlapping instructions like the Slack guidelines video, typically ${SLACK_GUIDELINES_LOOM_URL}).
- Mention the project name, the goal context in one short phrase, and what "done" means at a high level.
- If onboarding-partner mentions are provided in the background, add ONE short line near the end naming them with their <@U…> mentions, framing them as go-to teammates for accountability and support. Example phrasing (do not copy verbatim): "Looping in <@U…> and <@U…> as your onboarding partners while you ramp up. Feel free to ping them with anything." Do not use the word "buddy" or "buddies" in the output. Skip the line entirely if none are provided.
- Keep it to 3-7 short lines. Optional: include a scheduling link line only if a Calendly URL is provided in the background.
- Output only the message text to post (no quotes, no preamble).`;

export async function draftAssignmentMessage(input: {
  newHire: Person;
  pilotProjectName: string;
  definitionOfDone: string;
  goalDescription: string;
  companyName: string;
  assignmentKind: "owner" | "assignee" | "new_project";
  dmContextSummary: string;
  welcomeSnippet?: string;
  rosterHints: SlackMemberRosterHint[];
  /** Optional teammates to call out as onboarding partners (mentions + names). */
  buddies?: { slackUserId: string; name: string; rationale?: string }[];
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(input.rosterHints);
  const sender = await resolveThreadReplySenderIdentity(token, rosterById);
  const authorship = buildThreadReplyAuthorshipBackground(
    sender,
    input.newHire.name,
    input.rosterHints
  );

  const cal = process.env.ROBBY_CALENDLY_URL?.trim() ?? "";

  const uid = input.newHire.slackHandle.trim().toUpperCase();
  const mention = uid ? `<@${uid}>` : input.newHire.name;

  const buddies = (input.buddies ?? []).filter((b) =>
    (b.slackUserId ?? "").trim().length > 0
  );
  const buddyLine =
    buddies.length > 0
      ? `Onboarding-partner mentions to include in the closing line (use these EXACT tokens, in order): ${buddies
          .map(
            (b) =>
              `<@${b.slackUserId.trim().toUpperCase()}> (${b.name}${
                b.rationale ? ` — ${b.rationale.slice(0, 120)}` : ""
              })`
          )
          .join(", ")}`
      : "No onboarding partners provided — skip the onboarding-partner line.";

  const userPayload = [
    authorship,
    "",
    `New hire mention token: ${mention}`,
    `Assignment: ${input.assignmentKind}`,
    `Company: ${input.companyName}`,
    `Goal: ${input.goalDescription.slice(0, 400)}`,
    `Pilot project: ${input.pilotProjectName}`,
    `Definition of done: ${input.definitionOfDone.slice(0, 600)}`,
    `DM summary: ${input.dmContextSummary || "(none)"}`,
    buddyLine,
    input.welcomeSnippet
      ? `Nadav welcome snippet (do not repeat): ${input.welcomeSnippet.slice(0, 800)}`
      : "",
    cal ? `Optional Calendly URL to include on its own line if helpful: ${cal}` : "No Calendly URL configured.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const text = await claudePlainText(ASSIGNMENT_SYSTEM, userPayload);
    return { ok: true, text: text.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const REVISE_ASSIGNMENT_SYSTEM = `You revise a Slack DM assignment message. Apply the user's feedback. Keep first person as the sender. Preserve the new hire's <@U…> mention if present. Never use an em dash (U+2014). Output only the revised message text (no preamble).`;

export async function reviseAssignmentMessage(input: {
  currentDraft: string;
  feedback: string;
  newHire: Person;
  rosterHints: SlackMemberRosterHint[];
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const fb = input.feedback.trim();
  if (!fb) {
    return { ok: false, error: "Feedback is empty." };
  }
  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(input.rosterHints);
  const sender = await resolveThreadReplySenderIdentity(token, rosterById);
  const authorship = buildThreadReplyAuthorshipBackground(
    sender,
    input.newHire.name,
    input.rosterHints
  );

  const userPayload = [
    authorship,
    "",
    "Current draft:",
    input.currentDraft.trim(),
    "",
    "User feedback:",
    fb,
  ].join("\n");

  try {
    const text = await claudePlainText(REVISE_ASSIGNMENT_SYSTEM, userPayload);
    return { ok: true, text: text.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
