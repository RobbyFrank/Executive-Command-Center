"use server";

import {
  fetchSlackThreadReplies,
  parseSlackThreadUrl,
  slackUserTokenForThreads,
} from "@/lib/slack";
import {
  collectSlackUserIdsFromMessageText,
  slackMessageTextForDisplay,
} from "@/lib/slackDisplay";
import {
  buildSlackUserDisplayMaps,
  claudePlainText,
  extractJsonObject,
  calendarDaysDiffUtc,
  rosterMapFromHints,
  slackTsToDate,
  sortMessagesByTs,
  parseMilestoneTargetDate,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";
import { clampAutonomy } from "@/lib/autonomyRoster";

export type MilestoneLikelihoodRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type MilestoneLikelihoodResult =
  | {
      ok: true;
      likelihood: number;
      riskLevel: MilestoneLikelihoodRiskLevel;
      reasoning: string;
      /** One-line description of what the thread is about (same Claude call as likelihood). */
      threadSummaryLine: string;
      progressEstimate: number;
      daysRemaining: number;
      daysElapsed: number;
    }
  | { ok: false; error: string };

export type DeadlineNudgeLikelihoodContext = {
  reasoning: string;
  riskLevel: MilestoneLikelihoodRiskLevel;
  progressEstimate: number;
};

/**
 * AI estimate of whether a milestone will hit its target date, using Slack thread
 * transcript pace, owner autonomy, and project complexity.
 */
export async function assessMilestoneOnTimeLikelihood(
  slackUrl: string,
  milestoneName: string,
  targetDate: string,
  ownerAutonomy: number | null,
  projectComplexity: number,
  rosterHints?: SlackMemberRosterHint[],
  /** Optional free text (project scope, sibling milestones) from the client. */
  roadmapContext?: string
): Promise<MilestoneLikelihoodResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid Slack thread URL." };
  }

  const due = parseMilestoneTargetDate(targetDate);
  if (!due) {
    return {
      ok: false,
      error:
        "Set a valid milestone target date (YYYY-MM-DD) to assess on-time likelihood.",
    };
  }

  const rep = await fetchSlackThreadReplies(parsed.channelId, parsed.threadTs);
  if (!rep.ok) return rep;

  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sorted = sortMessagesByTs(rep.messages);
  const cap = Math.min(sorted.length, 80);
  const slice = sorted.slice(-cap);
  const mentionIds: string[] = [];
  for (const m of slice) {
    mentionIds.push(...collectSlackUserIdsFromMessageText(m.text ?? ""));
  }
  const ids = [
    ...new Set([
      ...slice
        .map((m) => m.user)
        .filter((u): u is string => Boolean(u))
        .map((u) => u.toUpperCase()),
      ...mentionIds,
    ]),
  ];
  const { labelMap } = await buildSlackUserDisplayMaps(ids, token, rosterById);

  const lines: string[] = [];
  for (const m of slice) {
    const uid = m.user?.trim().toUpperCase();
    const who = uid
      ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
      : "app/bot";
    const tsIso = slackTsToDate(m.ts).toISOString();
    const body = slackMessageTextForDisplay(m.text ?? "", 1200, labelMap);
    lines.push(`[${tsIso}] [${who}]: ${body}`);
  }
  const transcript = lines.join("\n\n");

  const today = new Date();
  const todayCal = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const dueCal = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const daysRemaining = calendarDaysDiffUtc(dueCal, todayCal);

  const rootTs = rep.rootTs || sorted[0]?.ts || "";
  const threadStart = slackTsToDate(rootTs);
  const threadStartCal = new Date(
    threadStart.getFullYear(),
    threadStart.getMonth(),
    threadStart.getDate()
  );
  const daysElapsed = Math.max(0, calendarDaysDiffUtc(todayCal, threadStartCal));

  const autonomyLabel =
    ownerAutonomy == null
      ? "unknown (no project owner on Team or missing autonomy)"
      : String(clampAutonomy(ownerAutonomy));
  const complexity = Math.max(1, Math.min(5, Math.round(projectComplexity)));

  const contextExtra = (roadmapContext ?? "").trim();

  const userPayload = [
    `Milestone: "${milestoneName}"`,
    `Target date (calendar): ${dueCal.toISOString().slice(0, 10)}`,
    `Days remaining until target (local calendar days): ${daysRemaining}`,
    `Thread started (root message date, local): ${threadStartCal.toDateString()}`,
    `Days since thread started (local calendar days): ${daysElapsed}`,
    `Owner autonomy (0-5, higher = more execution independence; 0 = not assessed on Team): ${autonomyLabel}`,
    `Project complexity (1-5, higher = harder): ${complexity}`,
    contextExtra ? `Roadmap context:\n${contextExtra}` : "",
    "",
    "Thread transcript (oldest to newest in this slice):",
    transcript || "(no text in thread)",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You are an executive project analyst. Given a milestone's Slack thread transcript, its target date, owner autonomy score, and project complexity, estimate the likelihood this milestone will be completed on time.

HARD RULE: If "Days remaining" is negative the deadline has already passed. A missed deadline cannot be met retroactively. Set likelihood to 0 and riskLevel to "critical". The reasoning and progressEstimate should still reflect the thread's actual state.

Consider:
- How much progress is evident in the thread relative to time elapsed vs remaining
- The pace and recency of activity (stale or quiet threads = higher risk)
- Owner autonomy (0-5, higher = more capable of independent execution; 0 = not assessed)
- Project complexity (1-5, higher = harder to finish quickly)

Also include threadSummaryLine: a single plain sentence (max ~180 characters) summarizing what is actually happening in the thread — current work, decisions, blockers, or topic. Neutral tone. Do not repeat the deadline-risk "reasoning" sentence; focus on thread substance.

Respond with EXACTLY one JSON object and no other text (no markdown fences):
{"likelihood": <number 0-100>, "riskLevel": "low"|"medium"|"high"|"critical", "reasoning": "<ONE sentence, max 25 words, deadline/on-time focus, no fluff>", "threadSummaryLine": "<one sentence, thread activity summary, max ~180 chars>", "progressEstimate": <number 0-100>}`;

  try {
    const raw = await claudePlainText(system, userPayload);
    const obj = extractJsonObject(raw);
    if (!obj) {
      return {
        ok: false,
        error: "Could not parse likelihood response from the model.",
      };
    }
    const likelihood = Number(obj.likelihood);
    const progressEstimate = Number(obj.progressEstimate);
    const reasoning =
      typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";
    const threadSummaryLineRaw =
      typeof obj.threadSummaryLine === "string"
        ? obj.threadSummaryLine.trim()
        : "";
    const threadSummaryLine =
      threadSummaryLineRaw.length > 220
        ? `${threadSummaryLineRaw.slice(0, 217)}…`
        : threadSummaryLineRaw;
    const rl = obj.riskLevel;
    const riskLevel: MilestoneLikelihoodRiskLevel =
      rl === "low" ||
      rl === "medium" ||
      rl === "high" ||
      rl === "critical"
        ? rl
        : "medium";

    if (
      !Number.isFinite(likelihood) ||
      !Number.isFinite(progressEstimate) ||
      !reasoning
    ) {
      return {
        ok: false,
        error: "Likelihood response was incomplete. Try again.",
      };
    }

    const overdue = daysRemaining < 0;

    return {
      ok: true,
      likelihood: overdue ? 0 : Math.max(0, Math.min(100, Math.round(likelihood))),
      riskLevel: overdue ? "critical" : riskLevel,
      reasoning,
      threadSummaryLine,
      progressEstimate: Math.max(0, Math.min(100, Math.round(progressEstimate))),
      daysRemaining,
      daysElapsed,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
