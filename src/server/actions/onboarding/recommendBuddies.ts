import { BuddyRecommendationSchema } from "@/lib/schemas/onboarding";
import type { BuddyRecommendation } from "@/lib/schemas/onboarding";
import { getRepository } from "@/server/repository";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import { fetchIntroContextForNewHire } from "@/server/actions/onboarding/fetchIntroContext";
import { isFounderPerson } from "@/lib/autonomyRoster";
import {
  daysSinceJoined,
  isNewHire,
} from "@/lib/onboarding";
import { calendarDateTodayLocal } from "@/lib/relativeCalendarDate";
import type { Goal, Person, Project } from "@/lib/types/tracker";

function extractJsonObject(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return raw.trim();
}

/** Compact, redacted teammate row for the buddy prompt (no salary / phone / email). */
function compactPersonForPrompt(
  p: Person,
  todayYmd: string,
  projects: Project[]
): string {
  const owned = projects.filter((pr) => pr.ownerId === p.id).length;
  const assigned = projects.filter((pr) =>
    (pr.assigneeIds ?? []).includes(p.id)
  ).length;
  const joinDays = daysSinceJoined(p, todayYmd);
  const tenure =
    joinDays === null
      ? "unknown"
      : joinDays >= 365
        ? `${Math.floor(joinDays / 365)}y`
        : `${joinDays}d`;
  return [
    `personId=${p.id}`,
    `name=${JSON.stringify(p.name)}`,
    `role=${JSON.stringify((p.role ?? "").slice(0, 80))}`,
    `department=${JSON.stringify((p.department ?? "").slice(0, 60))}`,
    `autonomy=${p.autonomyScore}`,
    `tenure=${tenure}`,
    `ownsProjects=${owned}`,
    `assignedProjects=${assigned}`,
    `slackUserId=${p.slackHandle.trim() || "(none)"}`,
  ].join(" | ");
}

function compactProjectsForBuddyPrompt(
  projects: Project[],
  goals: Goal[],
  /** Caller already validated these ids are real / on-tracker; we still safely look up names. */
  pilotProjectId: string | null
): string {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  if (pilotProjectId) {
    const pilot = projects.find((p) => p.id === pilotProjectId);
    if (pilot) {
      const g = goalById.get(pilot.goalId);
      return [
        "PILOT PROJECT (the new hire's first assignment):",
        `projectId=${pilot.id} | name=${JSON.stringify(pilot.name)} | priority=${pilot.priority} | complexity=${pilot.complexityScore} | goal=${JSON.stringify(g?.description.slice(0, 120) ?? "")}`,
      ].join("\n");
    }
  }
  return "PILOT PROJECT: not selected yet (recommend based on department / goal overlap only).";
}

const BUDDY_SYSTEM = `You are helping MLabs leadership pair a brand-new hire (autonomy 0) with **1 or 2 experienced teammates** who can mentor them, monitor their pilot project, and provide accountability.

Output ONLY a fenced JSON block (no other text):
\`\`\`json
{
  "candidates": [
    { "personId": "...", "rationale": "max 400 chars", "fitScore": 1-5, "sameDepartment": true|false, "sharesPilotContext": true|false }
    // up to 2 entries total
  ],
  "summary": "max 280 chars one-liner explaining the pairing rationale"
}
\`\`\`

Rules:
- Pick **1 or 2** people total. Default to 2 unless only one is clearly suitable.
- Prefer people in the **same department** as the new hire AND who have **non-trivial tenure** (older join date / autonomy >= 3) so they can actually mentor.
- Boost candidates who **own or are assigned to** projects under the same goal/company as the pilot project.
- Exclude founders (id "robby" or "nadav" or department "Founders"); they are already in the loop.
- Exclude anyone who is themselves still a new hire (tenure < 30d).
- Exclude the new hire themselves.
- Only return personIds that appear in the "Roster" list below; never invent ids.
- "sameDepartment" must reflect actual roster department equality (case-insensitive trim).
- "sharesPilotContext" is true when the candidate owns/assignees a project under the same goal or company as the pilot.
- Never use an em dash (U+2014); use commas or ASCII hyphens.`;

export async function recommendOnboardingBuddies(input: {
  personId: string;
  /** Optional: when set, prioritize candidates linked to this project's goal/company. */
  pilotProjectId?: string;
}): Promise<
  | { ok: true; recommendation: BuddyRecommendation }
  | { ok: false; error: string }
> {
  const repo = getRepository();
  const person = await repo.getPerson(input.personId);
  if (!person) {
    return { ok: false, error: "Person not found." };
  }

  const data = await repo.load();
  const todayYmd = calendarDateTodayLocal();

  const eligible = data.people.filter((p) => {
    if (p.id === person.id) return false;
    if (isFounderPerson(p)) return false;
    if ((p.department ?? "").trim().toLowerCase() === "founders") return false;
    if (isNewHire(p, todayYmd)) return false;
    return true;
  });

  if (eligible.length === 0) {
    return { ok: false, error: "No eligible teammates to suggest as buddies." };
  }

  const intro = await fetchIntroContextForNewHire(
    person.slackHandle,
    data.people,
    { maxMessages: 50 }
  );

  const rosterBlock = eligible
    .map((p) => compactPersonForPrompt(p, todayYmd, data.projects))
    .join("\n");

  const pilotBlock = compactProjectsForBuddyPrompt(
    data.projects,
    data.goals,
    input.pilotProjectId?.trim() || null
  );

  const userBlock = [
    `Today (UTC): ${new Date().toISOString().slice(0, 10)}`,
    `New hire: ${person.name} (id=${person.id})`,
    `Role: ${(person.role ?? "").trim() || "(not set)"}`,
    `Department: ${(person.department ?? "").trim() || "(not set)"}`,
    "",
    pilotBlock,
    "",
    "DM / MPIM transcript with new hire (last 50 msgs, redacted):",
    intro.hadDmContext ? intro.transcript : "(no DM context)",
    "",
    "Roster (one per line; only pick personIds from this list):",
    rosterBlock,
  ].join("\n");

  let raw: string;
  try {
    raw = await claudePlainText(BUDDY_SYSTEM, userBlock);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let parsed: BuddyRecommendation;
  try {
    parsed = BuddyRecommendationSchema.parse(JSON.parse(extractJsonObject(raw)));
  } catch (e) {
    return {
      ok: false,
      error: `Could not parse buddy recommendation: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const eligibleById = new Map(eligible.map((p) => [p.id, p]));
  const filtered = parsed.candidates.filter((c) =>
    eligibleById.has(c.personId.trim())
  );

  if (filtered.length === 0) {
    return {
      ok: false,
      error:
        "AI returned no valid buddy candidates from the eligible roster. Try Refresh.",
    };
  }

  return {
    ok: true,
    recommendation: { ...parsed, candidates: filtered.slice(0, 2) },
  };
}
