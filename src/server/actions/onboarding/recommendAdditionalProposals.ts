import {
  AdditionalPilotProposalsSchema,
  type AdditionalPilotProposals,
  type NewPilotProjectProposal,
  type OnboardingRecommendation,
} from "@/lib/schemas/onboarding";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import { loadPilotRecommendationContext } from "@/server/actions/onboarding/recommendPilotProject";

function extractJsonObject(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return raw.trim();
}

/**
 * When the first recommender run yields no strong-fit existing projects, we need more than one
 * new-project card. This prompt reuses the same tracker context but asks for a *variety* of pilot
 * project ideas, explicitly avoiding whatever was already proposed. Same "Urgent/High/Normal/Low"
 * terminology rule as the main recommender.
 */
const ADDITIONAL_PROPOSALS_SYSTEM = `You are helping MLabs leadership design pilot projects for a brand-new hire (autonomy 0).

Output ONLY a fenced JSON block (no other text):
\`\`\`json
{
  "proposals": [
    {
      "suggestedCompanyId": "real company id from the tracker (prefer portfolio companies; avoid 'general' when another company fits the role)",
      "suggestedGoalId": "optional goal id under that company, or empty string",
      "suggestedName": "short project name",
      "suggestedDefinitionOfDone": "concrete completion criteria",
      "rationale": "max 500 chars"
    }
  ]
}
\`\`\`

Rules:
- If FOUNDER DIRECTION is provided, treat it as the strongest signal and make every proposal advance that direction. Do not drift away from it.
- Return exactly the number of proposals requested in the user block (usually 2).
- Each proposal must be **meaningfully different** from the others and from any ALREADY-PROPOSED list: different company, goal, or job-to-be-done.
- Onboarding pilots always make the new hire the **project owner** — ideas must be completable by one person, not a multi-owner initiative.
- Prefer complexity 1-2 work that maps to Roadmap priority **High** or **Normal** (not **Urgent**, not **Low**) for the new hire's role. In rationale text, use only **Urgent / High / Normal / Low** — never P0, P1, P2, or P3.
- suggestedCompanyId must be a real id from the tracker.
- Never use an em dash (U+2014); use commas or ASCII hyphens.`;

export async function recommendAdditionalPilotProposals(input: {
  personId: string;
  /** How many extra proposals to produce. Defaults to 2 (fills an empty cards grid to 3 total). */
  count?: number;
  /** Existing proposals already shown to the user, so the model diversifies. */
  alreadyProposed?: NewPilotProjectProposal[];
  /** Optional free-text direction from the founder; passed to `loadPilotRecommendationContext`. */
  founderContext?: string;
}): Promise<
  | { ok: true; proposals: NewPilotProjectProposal[] }
  | { ok: false; error: string }
> {
  const count = Math.max(1, Math.min(4, input.count ?? 2));

  const loaded = await loadPilotRecommendationContext(input.personId, {
    founderContext: input.founderContext,
  });
  if (!loaded.ok) return loaded;

  const { companies, userBlock } = loaded.ctx;
  const companyIds = new Set(companies.map((c) => c.id));

  const alreadyLines =
    (input.alreadyProposed ?? []).length > 0
      ? [
          "ALREADY-PROPOSED (do NOT repeat company + idea combinations):",
          ...(input.alreadyProposed ?? []).map(
            (p, i) =>
              `${i + 1}. company=${p.suggestedCompanyId} | name=${JSON.stringify(p.suggestedName)} | rationale=${JSON.stringify(p.rationale.slice(0, 200))}`
          ),
        ].join("\n")
      : "ALREADY-PROPOSED: (none)";

  const promptBody = [
    `Return exactly ${count} diverse proposals.`,
    "",
    alreadyLines,
    "",
    userBlock,
  ].join("\n");

  let rawText: string;
  try {
    rawText = await claudePlainText(ADDITIONAL_PROPOSALS_SYSTEM, promptBody);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let parsed: AdditionalPilotProposals;
  try {
    parsed = AdditionalPilotProposalsSchema.parse(
      JSON.parse(extractJsonObject(rawText))
    );
  } catch (e) {
    return {
      ok: false,
      error: `Could not parse additional proposals: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const generalId =
    companies.find((c) => c.id === "general")?.id ??
    companies.find((c) => c.name.toLowerCase() === "general")?.id;

  const normalized = parsed.proposals
    .map((p) => {
      if (!companyIds.has(p.suggestedCompanyId)) {
        const alt = companies.find((c) => c.id !== generalId) ?? companies[0];
        if (!alt) return null;
        return { ...p, suggestedCompanyId: alt.id };
      }
      if (generalId && p.suggestedCompanyId === generalId) {
        const alt = companies.find((c) => c.id !== generalId);
        if (alt) return { ...p, suggestedCompanyId: alt.id };
      }
      return p;
    })
    .filter((x): x is NewPilotProjectProposal => x !== null)
    .slice(0, count);

  if (normalized.length === 0) {
    return {
      ok: false,
      error: "Model returned no usable additional proposals.",
    };
  }

  return { ok: true, proposals: normalized };
}

/** Pull the single `newProjectProposal` out of the main recommendation, as `NewPilotProjectProposal`. */
export function newProjectProposalFromRecommendation(
  rec: OnboardingRecommendation
): NewPilotProjectProposal {
  return {
    suggestedCompanyId: rec.newProjectProposal.suggestedCompanyId,
    suggestedGoalId: rec.newProjectProposal.suggestedGoalId,
    suggestedName: rec.newProjectProposal.suggestedName,
    suggestedDefinitionOfDone: rec.newProjectProposal.suggestedDefinitionOfDone,
    rationale: rec.newProjectProposal.rationale,
  };
}
