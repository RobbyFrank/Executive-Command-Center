import { OnboardingRecommendationSchema } from "@/lib/schemas/onboarding";
import type {
  OnboardingRecommendation,
  SuggestedChannel,
} from "@/lib/schemas/onboarding";
import { redactTrackerForAi } from "@/lib/tracker-redact";
import { getRepository } from "@/server/repository";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import { fetchIntroContextForNewHire } from "@/server/actions/onboarding/fetchIntroContext";
import { fetchSlackChannels, type SlackChannel } from "@/lib/slack";
import { fetchUserChannelMemberships } from "@/lib/slack/memberships";
import { clampAutonomy, isFounderPerson } from "@/lib/autonomyRoster";
import type {
  Person,
  Project,
  Goal,
  Company,
  Priority,
} from "@/lib/types/tracker";
import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";

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
    const pr = p.priority as Priority;
    const priorityLabel = PRIORITY_MENU_LABEL[pr] ?? p.priority;
    lines.push(
      [
        `projectId=${p.id}`,
        `name=${JSON.stringify(p.name)}`,
        `company=${companyLabel}`,
        `goal=${JSON.stringify(g.description.slice(0, 120))}`,
        `priority=${p.priority} (Roadmap label: ${priorityLabel})`,
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

export const RECOMMENDER_SYSTEM = `You are helping MLabs leadership assign a first pilot project to a new hire (autonomy 0, unknown skill level) AND recommend Slack channels they should be invited to for additional context.

Output ONLY a fenced JSON block in this exact shape (no other text):
\`\`\`json
{ ... }
\`\`\`

JSON schema:
{
  "existingProjectCandidates": [
    {
      "projectId": "uuid or empty string if no good match",
      "suggestedRole": "owner",
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
  "suggestedChannels": [
    {
      "channelId": "real Slack channel id from the CHANNEL CATALOG (C.../G...)",
      "channelName": "channel name without leading #",
      "rationale": "max 300 chars — why this channel helps this new hire",
      "fitScore": 1-5,
      "isPrivate": true|false (copy from the catalog)
    }
  ],
  "overallConfidence": 1-5,
  "dmContextSummary": "one line"
}

Rules:
- If FOUNDER DIRECTION is provided, treat it as the single strongest signal. It represents what the person running onboarding actually wants. When it conflicts with the DM transcript or the new hire's stated role, **follow the founder**. Call out in your rationale how each card honors that direction.
- Onboarding pilots always make the new hire the **project owner**. Only recommend existing projects where CAN_ASSIGN_OWNER=true (ownerId empty). suggestedRole must always be "owner".
- Prefer existing projects with complexity 1-2 and Roadmap priority **High** or **Normal** (stored as P1/P2; avoid **Urgent** and **Low** for a pilot). In rationale text, name priorities only as **Urgent / High / Normal / Low** — never write P0, P1, P2, or P3.
- Always return exactly two existingProjectCandidates. Use fitScore 0 and empty projectId when no strong match, with rationale explaining why.
- newProjectProposal must use a real company id from the tracker (prefer portfolio companies; avoid id "general" when another company fits the role).
- Never use an em dash (U+2014); use commas or ASCII hyphens.
- introContextQuotes: at most 2 short strings from the DM transcript.

CHANNEL RULES (suggestedChannels):
- Return **0 to 5** channels. Empty array is acceptable when no good signals exist.
- Every channelId MUST be a real id from the CHANNEL CATALOG provided in the user block. Do not invent ids, do not output names without ids.
- Prefer in this order:
  1. Channels whose name/topic/purpose matches the new hire's **role** or **department** (e.g. #sales, #sdr-team, #marketing-ops).
  2. Channels whose name/topic/purpose matches the **pilot project's company / goal** (a Sales hire on a VoiceDrop pilot ⇒ VoiceDrop channels).
  3. Channels where the **recommended onboarding partners** or **same-department teammates** are members (see TEAM CHANNEL MEMBERSHIPS). Bias toward channels the team actually uses.
  4. Boost when FOUNDER DIRECTION is provided — if the founder says "focus on outbound", prefer #outbound / #sdr / #prospecting channels over generic ones.
- **Never** suggest: #general, announcements/all-hands, #random, or any channel whose name/topic suggests broadcast/admin-only. These are either joined automatically or should not get new-hire invitations.
- Do not suggest archived channels or DM/MPIM channels (the catalog already excludes them).
- Keep each rationale concrete — name the role, company, or teammate that justifies the pick.`;

export type PilotRecommendationContext = {
  person: Person;
  companies: Company[];
  goals: Goal[];
  projects: Project[];
  /** Subset of the full Slack channel catalog (non-archived, non-DM) as of the run. */
  channelCatalog: SlackChannel[];
  userBlock: string;
};

/**
 * Words we never want to offer as onboarding invites. These channels are broadcast or
 * admin-only, and the AI is told in the system prompt to avoid them regardless. The
 * list is also used as a post-filter safety net.
 */
const CHANNEL_SUGGESTION_DENY_WORDS = [
  "general",
  "announce",
  "all-hands",
  "allhands",
  "random",
  "broadcast",
  "admin-only",
];

function channelIsDenylisted(ch: { name: string; topic?: string; purpose?: string }): boolean {
  const hay = [ch.name, ch.topic ?? "", ch.purpose ?? ""].join(" ").toLowerCase();
  return CHANNEL_SUGGESTION_DENY_WORDS.some((w) => hay.includes(w));
}

/**
 * Compact catalog line for the prompt. Keep under ~100 chars per line — the catalog can
 * be a few hundred entries, so we strip topic/purpose when empty and clamp length.
 */
function formatChannelCatalogLine(ch: SlackChannel): string {
  const topic = (ch.topic ?? "").trim();
  const purpose = (ch.purpose ?? "").trim();
  const context = [topic, purpose].filter(Boolean).join(" / ");
  const contextClamped =
    context.length > 120 ? `${context.slice(0, 119)}…` : context;
  return [
    `channelId=${ch.id}`,
    `name=#${ch.name}`,
    ch.isPrivate ? "private=true" : "private=false",
    contextClamped ? `context=${JSON.stringify(contextClamped)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Returns the Slack user ids we'll probe `users.conversations` for, with a small cap so
 * we don't fan out API calls. Prefers: new hire's department teammates (autonomy ≥ 3,
 * non-founders) — they're the pool the onboarding-partner prompt picks from, so the
 * channels they're in are the ones the buddy-to-be is also in.
 */
function pickTeammatesForChannelSignals(
  newHire: Person,
  people: Person[],
  options?: { cap?: number }
): Person[] {
  const cap = Math.max(1, Math.min(6, options?.cap ?? 4));
  const dept = (newHire.department ?? "").trim().toLowerCase();
  const candidates = people.filter((p) => {
    if (p.id === newHire.id) return false;
    if (isFounderPerson(p)) return false;
    if ((p.department ?? "").trim().toLowerCase() === "founders") return false;
    if (clampAutonomy(p.autonomyScore) < 3) return false;
    const handle = (p.slackHandle ?? "").trim();
    if (!handle) return false;
    return true;
  });

  const sameDept = candidates.filter(
    (p) =>
      dept.length > 0 &&
      (p.department ?? "").trim().toLowerCase() === dept
  );
  const others = candidates.filter(
    (p) => (p.department ?? "").trim().toLowerCase() !== dept
  );

  const sorted = [...sameDept, ...others].sort((a, b) => {
    const autA = clampAutonomy(a.autonomyScore);
    const autB = clampAutonomy(b.autonomyScore);
    if (autA !== autB) return autB - autA;
    return a.name.localeCompare(b.name);
  });

  return sorted.slice(0, cap);
}

type TeammateChannelSignal = {
  teammate: Person;
  channelIds: string[];
};

async function loadTeammateChannelSignals(
  teammates: Person[]
): Promise<TeammateChannelSignal[]> {
  const out: TeammateChannelSignal[] = [];
  for (const t of teammates) {
    const handle = (t.slackHandle ?? "").trim();
    if (!handle) continue;
    const r = await fetchUserChannelMemberships(handle, { cap: 120 });
    if (!r.ok) {
      /** Soft-fail per teammate — the prompt still gets the other signals. */
      continue;
    }
    out.push({
      teammate: t,
      channelIds: r.memberships.map((m: { channelId: string }) => m.channelId),
    });
  }
  return out;
}

function formatTeammateMembershipsForPrompt(
  signals: TeammateChannelSignal[],
  catalog: SlackChannel[]
): string {
  if (signals.length === 0) return "TEAM CHANNEL MEMBERSHIPS: (unavailable — Slack token scope or no teammates).";
  const catalogIds = new Set(catalog.map((c) => c.id));
  const lines = signals.map(({ teammate, channelIds }) => {
    const inCatalog = channelIds.filter((id) => catalogIds.has(id));
    const names = inCatalog.slice(0, 25);
    return `- ${teammate.name} (${teammate.department || "no dept"}, autonomy ${clampAutonomy(teammate.autonomyScore)}): ${
      names.length > 0 ? names.join(",") : "(no channels listed)"
    }`;
  });
  return ["TEAM CHANNEL MEMBERSHIPS (channel ids — match against CHANNEL CATALOG):", ...lines].join("\n");
}

export async function loadPilotRecommendationContext(
  personId: string,
  options?: {
    onProgress?: (message: string) => void;
    /** Optional free-text direction from the founder to steer the AI (role, industry, etc.). */
    founderContext?: string;
  }
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
      welcomeSlackChannelId: person.welcomeSlackChannelId,
      welcomeSlackUrl: person.welcomeSlackUrl,
    }
  );

  onProgress?.(
    intro.hadDmContext
      ? "Assembling prompt with DM transcript and project list…"
      : "Assembling prompt (no DM transcript) and project list…"
  );

  const projectList = compactProjectsForPrompt(companies, goals, projects);

  onProgress?.("Loading Slack channel catalog and teammate memberships…");
  const channelList = await fetchSlackChannels();
  const rawCatalog: SlackChannel[] = channelList.ok ? channelList.channels : [];
  /** Drop archived/denylisted entries up-front so the AI never picks them. */
  const channelCatalog = rawCatalog.filter((ch) => !channelIsDenylisted(ch));
  const catalogNotice = channelList.ok
    ? channelList.notice ?? ""
    : `(Slack channel list unavailable: ${channelList.error})`;

  const teammatesForSignals = pickTeammatesForChannelSignals(person, people, {
    cap: 4,
  });
  const teammateSignals = await loadTeammateChannelSignals(teammatesForSignals);

  const founderContextRaw = (options?.founderContext ?? "").trim();
  /**
   * Cap founder context at 2k chars to keep token usage bounded even if someone pastes a wall
   * of text. It is the single strongest signal in this prompt, so it goes BEFORE DM transcript.
   */
  const founderContext =
    founderContextRaw.length > 2000
      ? founderContextRaw.slice(0, 2000)
      : founderContextRaw;

  const channelCatalogBlock =
    channelCatalog.length === 0
      ? "CHANNEL CATALOG: (empty — no channels available for suggestion this run)"
      : [
          `CHANNEL CATALOG (${channelCatalog.length} channels; use channelId exactly as shown):`,
          ...channelCatalog.map(formatChannelCatalogLine),
          catalogNotice ? `Notice: ${catalogNotice}` : "",
        ]
          .filter(Boolean)
          .join("\n");

  const userBlock = [
    `Today (UTC): ${new Date().toISOString().slice(0, 10)}`,
    `New hire: ${person.name}`,
    `Role: ${person.role || "(not set)"}`,
    `Department: ${person.department || "(not set)"}`,
    `Person id: ${person.id}`,
    `Slack user id: ${person.slackHandle}`,
    "",
    founderContext
      ? `FOUNDER DIRECTION (highest priority signal — the person running this onboarding wrote this and it should take precedence over the DM transcript when they conflict):\n${founderContext}`
      : "FOUNDER DIRECTION: (none provided — rely on the DM transcript and role).",
    "",
    "DM / MPIM transcript (last 50 messages, redacted):",
    intro.hadDmContext ? intro.transcript : "(no DM context — Slack ID missing or no DMs with this user)",
    "",
    "Project list (one per line):",
    projectList || "(no projects)",
    "",
    channelCatalogBlock,
    "",
    formatTeammateMembershipsForPrompt(teammateSignals, channelCatalog),
    "",
    "Full tracker JSON (for style and extra context):",
    JSON.stringify(redacted),
  ].join("\n");

  return {
    ok: true,
    ctx: { person, companies, goals, projects, channelCatalog, userBlock },
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
    if (!pid) return { ...c, suggestedRole: "owner" as const };
    const proj = projectById.get(pid);
    if (!proj) {
      return {
        ...c,
        projectId: "",
        suggestedRole: "owner" as const,
        fitScore: 0,
        rationale: "Project id not found.",
      };
    }
    const ownerEmpty = !(proj.ownerId ?? "").trim();
    if (!ownerEmpty) {
      return {
        ...c,
        projectId: "",
        suggestedRole: "owner" as const,
        fitScore: 0,
        rationale:
          "Project already has an owner; onboarding pilot must use an empty owner slot.",
      };
    }
    return { ...c, suggestedRole: "owner" as const };
  });

  /**
   * Drop channel suggestions the AI invented (channelId not in catalog) or that match
   * the deny-list even after the prompt rule. Normalize `channelName` + `isPrivate`
   * from the catalog so the UI has correct metadata for display and invite calls.
   */
  const catalogById = new Map(ctx.channelCatalog.map((c) => [c.id, c]));
  const seenChannelIds = new Set<string>();
  const sanitizedChannels: SuggestedChannel[] = [];
  for (const raw of parsed.suggestedChannels ?? []) {
    const id = raw.channelId.trim();
    if (!id) continue;
    if (seenChannelIds.has(id)) continue;
    const match = catalogById.get(id);
    if (!match) continue;
    if (channelIsDenylisted(match)) continue;
    seenChannelIds.add(id);
    sanitizedChannels.push({
      channelId: match.id,
      channelName: match.name,
      rationale: raw.rationale.trim(),
      fitScore: raw.fitScore,
      isPrivate: match.isPrivate,
    });
  }

  return {
    ok: true,
    recommendation: {
      ...parsed,
      existingProjectCandidates: candidates,
      suggestedChannels: sanitizedChannels,
    },
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
  personId: string,
  options?: { founderContext?: string }
): Promise<
  | { ok: true; recommendation: OnboardingRecommendation }
  | { ok: false; error: string }
> {
  const loaded = await loadPilotRecommendationContext(personId, {
    founderContext: options?.founderContext,
  });
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
