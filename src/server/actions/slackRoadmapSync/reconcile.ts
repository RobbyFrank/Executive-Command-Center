import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  SlackScrapeSuggestionSchema,
  type SlackScrapeSuggestion,
  type SlackSuggestionRecord,
} from "@/lib/schemas/tracker";
import { computeSlackSuggestionDedupeKey } from "@/lib/slackSuggestionDedupe";
import { buildExistingRoadmapBlock, buildPeopleRosterBlock } from "@/lib/slackScrapePrompt";
import type { TrackerData } from "@/lib/types/tracker";
import { readSlackSuggestions } from "@/server/repository/slack-suggestions-storage";
import { z } from "zod";

const ReconciliationLineSchema = z.object({
  originalId: z.string().optional(),
  suggestion: z.unknown(),
  rationale: z.string().default(""),
});

function nowIso() {
  return new Date().toISOString();
}

function buildReconcileSystemPrompt(companyName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are reconciling a roadmap suggestion queue for company "${companyName}".

Today is ${today}.

You will receive a JSON user message with:
- existingRoadmap: current goals, projects, and milestones
- peopleRoster: people with Slack ids
- existingPending: pending suggestions (each has id, firstSeenAt, lastSeenAt, payload, dedupeKey, rationale)
- freshFromSlack: new suggestions from today's Slack + Claude scan (raw JSON)
- rejectedDedupeKeys: list of string keys the operator has rejected; NEVER output a suggestion whose payload would have one of these keys (you must compute a stable key: newGoal: sha256 of normalized new goal title + companyId, newProject: existingGoalId+normalized project name, editGoal/editProject/editMile: kind+entityId, addMile: projectId+normalized milestone name)

TASK:
Output a NEW authoritative pending list for this company. Return ONLY a JSON array (no markdown) of objects:
{ "originalId"?: string, "suggestion": <full suggestion object with kind and all fields per schema>, "rationale": string }

Rules:
- If an existing pending item is still valid and not superseded by fresh evidence, set originalId to that item's id and keep or refine the suggestion and evidence.
- If fresh from Slack updates or contradicts an old pending (e.g. status For Review then Done), keep the single best merged suggestion, use originalId from the most relevant existing row, and merge evidence quotes.
- If a pending no longer has support in the roadmap and Slack, drop it (omit it).
- If a fresh item is new and not redundant, add it (omit originalId). Give it a new suggestion object.
- Every suggestion must include a non-empty evidence array and rationale as required by the suggestion kind.
- newGoalWithProjects, newProjectOnExistingGoal, edit*, addMilestone, editMilestone must match the product schema (kind, fields).
- Deduplicate aggressively. Prefer one row per "intent".
- In user-facing text use priority labels Urgent/High/Normal/Low in rationale only; store priority as P0–P3 in JSON when present.

Output ONLY the JSON array.`;
}

export async function reconcileSlackSuggestionsForCompany(
  data: TrackerData,
  companyId: string,
  companyName: string,
  freshSuggestions: SlackScrapeSuggestion[]
): Promise<SlackSuggestionRecord[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const store = await readSlackSuggestions();
  const allPending = store.items.filter(
    (i) => i.companyId === companyId && i.status === "pending"
  );
  const byLast = [...allPending].sort(
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
  );
  const existingPending = byLast.slice(0, 50);
  const rejected = store.rejectedKeysByCompany[companyId] ?? [];
  const rejectedSet = new Set(rejected);

  const existingBlock = buildExistingRoadmapBlock(data, companyId);
  const peopleBlock = buildPeopleRosterBlock(data.people);

  const userPayload = {
    existingRoadmap: existingBlock,
    peopleRoster: peopleBlock,
    existingPending: existingPending.map((p) => ({
      id: p.id,
      firstSeenAt: p.firstSeenAt,
      lastSeenAt: p.lastSeenAt,
      dedupeKey: p.dedupeKey,
      rationale: p.rationale,
      payload: p.payload,
    })),
    freshFromSlack: freshSuggestions,
    rejectedDedupeKeys: rejected,
  };

  const anthropic = new Anthropic({ apiKey });
  const res = await anthropic.messages.create({
    model: getAnthropicModel(),
    max_tokens: 8192,
    system: buildReconcileSystemPrompt(companyName),
    messages: [
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  });

  const block0 = res.content[0];
  const text = block0?.type === "text" ? block0.text : "";
  const fence = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fence ? fence[1]!.trim() : text.trim();
  const parsed: unknown = JSON.parse(jsonStr);

  if (!Array.isArray(parsed)) {
    throw new Error("Reconciliation must return a JSON array");
  }

  const t = nowIso();
  const out: SlackSuggestionRecord[] = [];
  const seenKeys = new Set<string>();

  for (const line of parsed) {
    const r = ReconciliationLineSchema.safeParse(line);
    if (!r.success) continue;
    const sg = SlackScrapeSuggestionSchema.safeParse(r.data.suggestion);
    if (!sg.success) continue;
    const payload = sg.data;
    const key = computeSlackSuggestionDedupeKey(companyId, payload);
    if (rejectedSet.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const innerR = ("rationale" in payload ? String(payload.rationale ?? "") : "").trim();
    const rationale = r.data.rationale.trim() || innerR;

    let id: string;
    let firstSeenAt: string;
    const originalId = r.data.originalId?.trim();
    if (originalId) {
      const prev = existingPending.find((x) => x.id === originalId);
      if (prev) {
        id = originalId;
        firstSeenAt = prev.firstSeenAt;
      } else {
        id = uuid();
        firstSeenAt = t;
      }
    } else {
      id = uuid();
      firstSeenAt = t;
    }

    out.push({
      id,
      companyId,
      firstSeenAt,
      lastSeenAt: t,
      status: "pending",
      dedupeKey: key,
      rationale,
      payload,
    });
  }

  return out;
}
