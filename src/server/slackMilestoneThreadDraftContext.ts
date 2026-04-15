import { compareMilestonesByTargetDate } from "@/lib/milestoneSort";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { getRepository } from "@/server/repository";

export type MilestoneThreadContextBlock =
  | { ok: true; userBlock: string; milestoneName: string }
  | { ok: false; error: string };

/** Shared with `draftMilestoneThreadMessage` and `/api/slack-draft-thread-message`. */
export const MILESTONE_THREAD_DRAFT_SYSTEM_PROMPT =
  'You are drafting a Slack message to kick off discussion about a milestone. Be direct and professional. Include what needs to happen, any relevant context from the goal/project, and what you expect from the team. Format for Slack plain text (use *bold* sparingly if useful, short bullets if needed). Never use an em dash (Unicode U+2014); use commas, colons, ASCII hyphens, or parentheses instead. Keep it focused (about 3 to 6 short paragraphs or equivalent). Follow all REQUIRED lines and the roster in the background: whenever you refer to someone listed there by name, use their Slack <@USER_ID> at that occurrence (throughout the message, not only once). Output only the message text to post, with no preamble or quotes.';

/** Shared with `reviseMilestoneThreadDraft` and `/api/slack-revise-thread-message`. */
export const MILESTONE_THREAD_REVISE_SYSTEM_PROMPT =
  'The user wants you to revise this Slack thread opening message. Apply their feedback while keeping the message professional and focused. Never use an em dash (Unicode U+2014); use commas, colons, ASCII hyphens, or parentheses instead. If the current draft begins with a Slack user mention, keep that exact mention as the first characters of the revised message. Whenever the background lists roster members with Slack ids, use <@USER_ID> for every reference to those people by name anywhere in the message (not only the first mention). Output only the revised message text, with no preamble or quotes.';

export function buildMilestoneThreadReviseUserPayload(
  backgroundUserBlock: string,
  currentDraft: string,
  feedback: string
): string {
  return `Background:\n${backgroundUserBlock}\n\n---\n\nCurrent draft:\n${currentDraft.trim()}\n\n---\n\nUser feedback:\n${feedback.trim()}`;
}

export async function buildMilestoneThreadContextBlock(
  milestoneId: string
): Promise<MilestoneThreadContextBlock> {
  const { fetchSlackThreadStatus } = await import("@/server/actions/slack");
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
  const company = data.companies.find((c) => c.id === goal.companyId);

  const projectMilestones = data.milestones
    .filter((m) => m.projectId === project.id)
    .sort(compareMilestonesByTargetDate);

  const lines: string[] = [];
  lines.push(`Company: ${company?.name ?? "?"} (${company?.shortName ?? "?"})`);
  lines.push(`Goal: ${goal.description}`);
  if (goal.measurableTarget.trim()) {
    lines.push(`Goal description (detail): ${goal.measurableTarget}`);
  }
  if (goal.whyItMatters.trim()) {
    lines.push(`Why it matters: ${goal.whyItMatters}`);
  }
  if (goal.currentValue.trim()) {
    lines.push(`Current: ${goal.currentValue}`);
  }
  lines.push(`Project: ${project.name}`);
  if (project.description.trim()) {
    lines.push(`Project scope: ${project.description}`);
  }
  if (project.definitionOfDone.trim()) {
    lines.push(`Done when: ${project.definitionOfDone}`);
  }
  lines.push(`Project status: ${project.status} | Priority: ${project.priority}`);

  const ownerId = project.ownerId.trim();
  const ownerPerson = ownerId
    ? data.people.find((p) => p.id === ownerId)
    : undefined;
  const ownerSlack = ownerPerson?.slackHandle?.trim() ?? "";
  if (ownerPerson) {
    lines.push(
      `Project owner: ${ownerPerson.name}${ownerPerson.role ? ` (${ownerPerson.role})` : ""}`
    );
    if (ownerSlack) {
      lines.push("");
      lines.push(
        `REQUIRED: The very first characters of the opening message must be the Slack user mention <@${ownerSlack}> then a single space, then the rest of the message. Do not add a greeting or punctuation before that mention.`
      );
    } else {
      lines.push("");
      lines.push(
        `No Slack user id for this owner: start by addressing ${ownerPerson.name} by name (plain text), then continue. Do not use a Slack user mention token.`
      );
    }
  } else {
    lines.push("");
    lines.push(
      "No project owner is assigned: open by addressing the team or the most relevant role implied by the goal and project."
    );
  }

  const mentionablePeople = data.people.filter(
    (p) => (p.slackHandle ?? "").trim() !== ""
  );
  if (mentionablePeople.length > 0) {
    lines.push("");
    lines.push(
      "Team roster with Slack mention tokens (for anyone you name in the message):"
    );
    for (const p of mentionablePeople) {
      const sid = p.slackHandle!.trim().toUpperCase();
      lines.push(`- ${p.name}: <@${sid}>`);
    }
    lines.push("");
    lines.push(
      "MENTION EVERY REFERENCE: Whenever you refer to someone from this roster by name (in the opening, mid-sentence, in bullets, or in a closing line), use their <@USER_ID> token at that spot instead of plain text alone. Apply this every time that person is referenced, not only the first mention and not only at the start of the message. If you thank, ask, or address them again later, use the token again."
    );
  }

  lines.push("");
  lines.push("Milestones (this project), in date order:");
  for (const m of projectMilestones) {
    const mark =
      m.id === milestone.id ? " ← THIS MILESTONE" : "";
    lines.push(
      `- ${m.name} [${m.status}]${m.targetDate ? ` target ${m.targetDate}` : ""}${mark}`
    );
  }

  const siblingSnips: string[] = [];
  for (const m of projectMilestones) {
    if (m.id === milestone.id) continue;
    const url = m.slackUrl?.trim() ?? "";
    if (!isValidHttpUrl(url)) continue;
    if (siblingSnips.length >= 4) break;
    const st = await fetchSlackThreadStatus(url);
    if (st.ok) {
      siblingSnips.push(
        `• ${m.name}: ${st.snippet || "thread linked"}`
      );
    } else {
      siblingSnips.push(
        `• ${m.name}: (Slack thread linked; could not load preview)`
      );
    }
  }
  if (siblingSnips.length > 0) {
    lines.push("");
    lines.push("Other milestones with Slack threads (context):");
    lines.push(siblingSnips.join("\n"));
  }

  lines.push("");
  lines.push(
    `Write an opening Slack message for the milestone: "${milestone.name}"`
  );
  if (milestone.targetDate.trim()) {
    lines.push(`Target date: ${milestone.targetDate}`);
  }

  return {
    ok: true,
    userBlock: lines.join("\n"),
    milestoneName: milestone.name,
  };
}
