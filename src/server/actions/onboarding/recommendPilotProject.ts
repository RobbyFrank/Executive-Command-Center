import { OnboardingRecommendationSchema } from "@/lib/schemas/onboarding";
import type { OnboardingRecommendation } from "@/lib/schemas/onboarding";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import { getRepository } from "@/server/repository";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import { fetchIntroContextForNewHire } from "@/server/actions/onboarding/fetchIntroContext";
import type { Person, Project, Goal, Company } from "@/lib/types/tracker";

function extractJsonObject(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return raw.trim();
}

function compactProjectsForPrompt(
  companies: Company[],
  goals: Goal[],
  projects: Project[]
): string {
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const lines: string[] = [];
  for (const p of projects) {
    const g = goalById.get(p.goalId);
    if (!g) continue;
    const c = companyById.get(g.companyId);
    const companyLabel = c
      ? `${c.name} (${c.shortName})`
      : g.companyId;
    const ownerEmpty = !(p.ownerId ?? "").trim();
    lines.push(
      [
        `projectId=${p.id}`,
        `name=${JSON.stringify(p.name)}`,
        `company=${companyLabel}`,
        `goal=${JSON.stringify(g.description.slice(0, 120))}`,
        `priority=${p.priority}`,
        `status=${p.status}`,
        `complexity=${p.complexityScore}`,
        `ownerId=${p.ownerId || "(empty)"}`,
        `assigneeIds=${(p.assigneeIds ?? []).join(",") || "(none)"}`,
        `definitionOfDone=${JSON.stringify((p.definitionOfDone ?? "").slice(0, 200))}`,
        ownerEmpty ? "CAN_ASSIGN_OWNER=true" : "CAN_ASSIGN_OWNER=false",
      ].join(" | ")
    );
  }
  return lines.join("\n");
}

export const RECOMMENDER_SYSTEM = `You are helping MLabs leadership assign a first pilot project to a new hire (autonomy 0, unknown skill level).

Output ONLY a fenced JSON block in this exact shape (no other text):
\`\`\`json
{ ... }
\`\`\`

JSON schema:
{
  "existingProjectCandidates": [
    {
      "projectId": "uuid or empty string if no good match",
      "suggestedRole": "owner" | "assignee",
      "rationale": "max 500 chars",
      "fitScore": 0-5 (0 means placeholder / no match),
      "introContextQuotes": ["short quote from DM if any"]
    },
    { same shape }
  ],
  "newProjectProposal": {
    "suggestedCompanyId": "company id from the list (NOT general unless nothing else fits)",
    "suggestedGoalId": "optional goal id under that company, or empty string",
    "suggestedName": "short project name",
    "suggestedDefinitionOfDone": "concrete completion criteria",
    "rationale": "max 500 chars"
  },
  "overallConfidence": 1-5,
  "dmContextSummary": "one line"
}

Rules:
- Prefer existing projects with complexity 1-2, priority P1 or P2 (avoid P0 and P3 for a pilot).
- Suggest "owner" only for projects whose owner is currently empty (ownerId empty). Otherwise use "assignee".
- Always return exactly two existingProjectCandidates. Use fitScore 0 and empty projectId when no strong match, with rationale explaining why.
- newProjectProposal must use a real company id from the tracker (prefer portfolio companies; avoid id "general" when another company fits the role).
- Never use an em dash (U+2014); use commas or ASCII hyphens.
- introContextQuotes: at most 2 short strings from the DM transcript.`;

export type PilotRecommendationContext = {
  person: Person;
  companies: Company[];
  goals: Goal[];
  projects: Project[];
  userBlock: string;
};

export async function loadPilotRecommendationContext(
  personId: string,
  options?: { onProgress?: (message: string) => void }
): Promise<
  | { ok: false; error: string }
  | { ok: true; ctx: PilotRecommendationContext }
> {
  const onProgress = options?.onProgress;
  onProgress?.("Loading tracker data from Redis…");

  const repo = getRepository();
  const person = await repo.getPerson(personId);
  if (!person) {
    return { ok: false, error: "Person not found." };
  }

  const [data, people] = await Promise.all([
    repo.load(),
    repo.getPeople(),
  ]);

  const redacted = redactTrackerForAi(data);
  const projects = data.projects;
  const goals = data.goals;
  const companies = data.companies;

  onProgress?.(
    `Tracker loaded: ${people.length} people, ${projects.length} projects, ${goals.length} goals, ${companies.length} companies.`
  );

  const intro = await fetchIntroContextForNewHire(
    person.slackHandle,
    people,
    {
      maxMessages: 50,
      onProgress,
      newHireName: person.name,
    }
  );

  onProgress?.(
    intro.hadDmContext
      ? "Assembling prompt with DM transcript and project list…"
      : "Assembling prompt (no DM transcript) and project list…"
  );

  const projectList = compactProjectsForPrompt(companies, goals, projects);

  const userBlock = [
    `Today (UTC): ${new Date().toISOString().slice(0, 10)}`,
    `New hire: ${person.name}`,
    `Role: ${person.role || "(not set)"}`,
    `Person id: ${person.id}`,
    `Slack user id: ${person.slackHandle}`,
    "",
    "DM / MPIM transcript (last 50 messages, redacted):",
    intro.hadDmContext ? intro.transcript : "(no DM context — Slack ID missing or no DMs with this user)",
    "",
    "Project list (one per line):",
    projectList || "(no projects)",
    "",
    "Full tracker JSON (for style and extra context):",
    JSON.stringify(redacted),
  ].join("\n");

  return {
    ok: true,
    ctx: { person, companies, goals, projects, userBlock },
  };
}

export function finalizePilotRecommendationFromRawText(
  ctx: PilotRecommendationContext,
  rawText: string
):
  | { ok: true; recommendation: OnboardingRecommendation }
  | { ok: false; error: string } {
  let parsed: OnboardingRecommendation;
  try {
    const jsonRaw = extractJsonObject(rawText);
    parsed = OnboardingRecommendationSchema.parse(JSON.parse(jsonRaw));
  } catch (e) {
    return {
      ok: false,
      error: `Could not parse recommendation: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const { companies, projects } = ctx;

  const generalId =
    companies.find((c) => c.id === "general")?.id ??
    companies.find((c) => c.name.toLowerCase() === "general")?.id;

  if (
    generalId &&
    parsed.newProjectProposal.suggestedCompanyId === generalId
  ) {
    const alt = companies.find((c) => c.id !== generalId);
    if (alt) {
      parsed = {
        ...parsed,
        newProjectProposal: {
          ...parsed.newProjectProposal,
          suggestedCompanyId: alt.id,
        },
      };
    }
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const candidates = parsed.existingProjectCandidates.map((c) => {
    const pid = c.projectId.trim();
    if (!pid) return c;
    const proj = projectById.get(pid);
    if (!proj) {
      return { ...c, projectId: "", fitScore: 0, rationale: "Project id not found." };
    }
    const ownerEmpty = !(proj.ownerId ?? "").trim();
    if (c.suggestedRole === "owner" && !ownerEmpty) {
      return { ...c, suggestedRole: "assignee" as const };
    }
    return c;
  });

  return {
    ok: true,
    recommendation: { ...parsed, existingProjectCandidates: candidates },
  };
}

/** First non-empty existing-project id, for buddy prompt context. */
export function firstPilotProjectIdForBuddies(
  rec: OnboardingRecommendation
): string | null {
  for (const c of rec.existingProjectCandidates) {
    const pid = c.projectId.trim();
    if (pid) return pid;
  }
  return null;
}

export async function recommendPilotProject(
  personId: string
): Promise<
  | { ok: true; recommendation: OnboardingRecommendation }
  | { ok: false; error: string }
> {
  const loaded = await loadPilotRecommendationContext(personId);
  if (!loaded.ok) {
    return loaded;
  }

  let rawText: string;
  try {
    rawText = await claudePlainText(RECOMMENDER_SYSTEM, loaded.ctx.userBlock);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return finalizePilotRecommendationFromRawText(loaded.ctx, rawText);
}
