"use server";

import type { MilestoneLikelihoodRiskLevel } from "@/server/actions/slack";
import {
  claudePlainText,
  extractJsonObject,
} from "@/server/actions/slack/thread-ai-shared";

export type GoalOneLinerProjectSummary = {
  projectName: string;
  milestoneName: string;
  summaryLine: string;
  likelihood: number;
  riskLevel: MilestoneLikelihoodRiskLevel;
  progressEstimate: number;
};

export type AssessGoalOneLinerInput = {
  goalDescription: string;
  projectSummaries: GoalOneLinerProjectSummary[];
  rollupLikelihood: number;
  rollupRiskLevel: MilestoneLikelihoodRiskLevel;
  rollupAiConfidence: number;
};

export type AssessGoalOneLinerResult =
  | { ok: true; summaryLine: string }
  | { ok: false; error: string };

/**
 * One plain sentence summarizing goal-level delivery outlook from child milestone thread summaries.
 */
export async function assessGoalOneLiner(
  input: AssessGoalOneLinerInput
): Promise<AssessGoalOneLinerResult> {
  const goalDescription = input.goalDescription.trim();
  const lines = input.projectSummaries.map((s) => {
    const sum = (s.summaryLine || "").trim() || "(no thread summary)";
    return `- ${s.projectName} / ${s.milestoneName}: on-time ${s.likelihood}% (${s.riskLevel}), est. done ${s.progressEstimate}% — ${sum}`;
  });

  const userPayload = [
    `Goal: "${goalDescription || "(untitled)"}"`,
    `Rollup on-time likelihood: ${input.rollupLikelihood}% (${input.rollupRiskLevel})`,
    `Rollup AI confidence (progress × on-time): ${input.rollupAiConfidence}%`,
    "",
    "Per-project next milestone signals:",
    lines.join("\n"),
  ].join("\n");

  const system = `You are an executive roadmap analyst. Write ONE short sentence (max ~180 characters) summarizing whether this goal is on track to land on time, based on the per-milestone Slack thread summaries and rollup scores. Neutral, concrete tone — no markdown, no quotes around the sentence, no fluff.

Respond with EXACTLY one JSON object and no other text (no markdown fences):
{"summaryLine": "<one sentence>"}`;

  try {
    const raw = await claudePlainText(system, userPayload);
    const obj = extractJsonObject(raw);
    if (!obj) {
      return {
        ok: false,
        error: "Could not parse goal summary response from the model.",
      };
    }
    const summaryLineRaw =
      typeof obj.summaryLine === "string" ? obj.summaryLine.trim() : "";
    const summaryLine =
      summaryLineRaw.length > 220
        ? `${summaryLineRaw.slice(0, 217)}…`
        : summaryLineRaw;
    if (!summaryLine) {
      return {
        ok: false,
        error: "Goal summary response was incomplete. Try again.",
      };
    }
    return { ok: true, summaryLine };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
