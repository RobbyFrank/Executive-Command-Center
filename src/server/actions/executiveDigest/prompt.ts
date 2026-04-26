import type {
  CompanyWithGoals,
  GoalWithProjects,
  ProjectWithMilestones,
} from "@/lib/types/tracker";
import type { SlackChannelHistoryMessage } from "@/lib/slack";
import { buildRoadmapHref } from "@/lib/roadmap-query";
import type { ExecutiveDigestState } from "./state";

const DEFAULT_BASE_URL = "https://admin.mlabs.vc";

/** Resolve the public base URL used in Slack hyperlinks (no trailing slash). */
export function getPublicBaseUrl(): string {
  const raw = process.env.ECC_PUBLIC_BASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** Absolute Roadmap deep link used inside Slack `<url|label>` tokens. */
export function buildAbsoluteRoadmapUrl(
  focus: { goalId: string; projectId: string } | undefined,
  filters?: Parameters<typeof buildRoadmapHref>[0]
): string {
  const href = buildRoadmapHref({
    ...(filters ?? {}),
    ...(focus ? { focus } : {}),
  });
  return `${getPublicBaseUrl()}${href}`;
}

interface CompactTrackerLine {
  /** Single line (no newlines) summarizing the entity for the prompt. */
  line: string;
}

function formatPriorityTag(priority: string): string {
  return priority ? `[${priority}]` : "";
}

function formatFlagTag(
  atRisk: boolean,
  spotlight: boolean
): string {
  if (atRisk) return "[AT RISK]";
  if (spotlight) return "[SPOTLIGHT]";
  return "";
}

function formatDate(raw: string): string {
  const t = raw.trim();
  return t ? t : "no-date";
}

function formatReviewLog(
  entries: { at: string; text: string }[] | undefined,
  maxEntries = 2
): string {
  if (!entries || entries.length === 0) return "";
  const sorted = [...entries].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0
  );
  const tail = sorted.slice(0, maxEntries).map((e) => {
    const day = e.at.slice(0, 10);
    const text = e.text.replace(/\s+/g, " ").trim().slice(0, 160);
    return `${day}: ${text}`;
  });
  return tail.join(" | ");
}

function compactProjectLine(
  company: CompanyWithGoals,
  goal: GoalWithProjects,
  project: ProjectWithMilestones
): CompactTrackerLine {
  const parts: string[] = [];
  parts.push(
    `project="${project.name}"`,
    `company="${company.shortName || company.name}"`,
    `goal="${goal.description.slice(0, 100)}"`,
    `status=${project.status}`
  );
  const pri = formatPriorityTag(project.priority);
  if (pri) parts.push(`priority=${pri}`);
  const flag = formatFlagTag(project.atRisk, project.spotlight);
  if (flag) parts.push(`flag=${flag}`);
  if (project.targetDate)
    parts.push(`targetDate=${formatDate(project.targetDate)}`);
  if (project.isBlocked && project.blockedByProjectName)
    parts.push(`blockedBy="${project.blockedByProjectName}"`);
  const nextOpen = project.milestones.find((m) => m.status !== "Done");
  if (nextOpen)
    parts.push(
      `nextMilestone="${nextOpen.name}" due=${formatDate(nextOpen.targetDate)}`
    );
  const log = formatReviewLog(project.reviewLog);
  if (log) parts.push(`recentNotes="${log}"`);
  const link = buildAbsoluteRoadmapUrl({
    goalId: goal.id,
    projectId: project.id,
  });
  parts.push(`ids=goal:${goal.id},project:${project.id}`);
  parts.push(`link=${link}`);
  return { line: parts.join(" ") };
}

function compactGoalLine(
  company: CompanyWithGoals,
  goal: GoalWithProjects
): CompactTrackerLine {
  const parts: string[] = [];
  parts.push(
    `goal="${goal.description.slice(0, 140)}"`,
    `company="${company.shortName || company.name}"`,
    `status=${goal.status}`
  );
  const pri = formatPriorityTag(goal.priority);
  if (pri) parts.push(`priority=${pri}`);
  const flag = formatFlagTag(goal.atRisk, goal.spotlight);
  if (flag) parts.push(`flag=${flag}`);
  if (goal.measurableTarget)
    parts.push(`target="${goal.measurableTarget.slice(0, 80)}"`);
  if (goal.currentValue)
    parts.push(`current="${goal.currentValue.slice(0, 60)}"`);
  const log = formatReviewLog(goal.reviewLog);
  if (log) parts.push(`recentNotes="${log}"`);
  // Goal-only link filters the roadmap by that goal via owners/priorities not
  // applicable; use the plain base (focus requires a project). Give just the base URL.
  parts.push(`ids=goal:${goal.id}`);
  parts.push(`link=${getPublicBaseUrl()}/`);
  return { line: parts.join(" ") };
}

/**
 * Reduce the full tracker hierarchy to a compact list of the highest-signal
 * items for the digest prompt. Always includes at-risk / spotlight / P0–P1
 * work, plus any item with a recent review-log note.
 */
export function buildTrackerSignalLines(
  hierarchy: CompanyWithGoals[],
  maxLines = 120
): string[] {
  const lines: string[] = [];
  for (const company of hierarchy) {
    for (const goal of company.goals) {
      const goalInteresting =
        goal.atRisk ||
        goal.spotlight ||
        goal.priority === "P0" ||
        goal.priority === "P1" ||
        (goal.reviewLog ?? []).length > 0;
      if (goalInteresting) {
        lines.push(compactGoalLine(company, goal).line);
      }
      for (const project of goal.projects) {
        if (project.isMirror) continue;
        const projectInteresting =
          project.atRisk ||
          project.spotlight ||
          project.priority === "P0" ||
          project.priority === "P1" ||
          project.status === "Stuck" ||
          project.status === "Blocked" ||
          (project.reviewLog ?? []).length > 0;
        if (projectInteresting) {
          lines.push(compactProjectLine(company, goal, project).line);
        }
      }
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

function truncate(raw: string, max: number): string {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Compact one Slack message to a single line for the prompt. */
function formatChannelMessage(
  m: SlackChannelHistoryMessage,
  labelMap: Map<string, string>
): string {
  const uid = m.user?.trim().toUpperCase() ?? "";
  const who = uid ? (labelMap.get(uid) ?? uid) : "app/bot";
  const sec = parseFloat(m.ts);
  const date = Number.isFinite(sec)
    ? new Date(Math.floor(sec * 1000)).toISOString()
    : "unknown";
  const text = truncate(m.text ?? "", 400);
  return `[${date}] ${who} (ts=${m.ts}): ${text}`;
}

export const EXECUTIVE_DIGEST_SYSTEM_PROMPT = `You are the executive chief-of-staff AI for MLabs. You produce a tight, scannable daily digest that goes into the #executive-priorities Slack channel at 8am ET for the founders.

Your job is to surface ONLY what is genuinely new, interesting, or problematic for MLabs leadership since yesterday's digest. Skip routine status. Skip anything the previous digest already said. Skip anything that does not need a human decision, a nudge, or executive awareness.

Output rules:
- Write in Slack mrkdwn (single asterisks for bold, *not* double).
- Section headers, in this order, each on its own line, each exactly as shown: *New risks*, *Decisions needed*, *Notable progress*, *Owner asks*.
- Under each header, 0–3 bullets max. Each bullet starts with "• " on a single line.
- Every bullet must be ≤ 22 words. Front-load the punchline. No filler ("this is", "going forward", "directly into", "as a result"). No restating the project name twice.
- Do NOT include any URLs or <URL|label> links in bullets. The channel message has a single "Portfolio OS" link in the header (added by the system).
- Never fabricate data. If the channel history + tracker do not support a bullet, drop it.
- Never use an em dash (U+2014); use commas, colons, parentheses, or ASCII hyphens.
- If a section has nothing new, omit the section entirely (do NOT print "None" or the empty header).
- If the whole digest has nothing new worth paging the founders on, respond with the single word: NOTHING.
- Never repeat a bullet whose meaning matches any of the "previousBulletHashes" hints provided; those were already posted yesterday.
- Mention people by first name only. Do not @-mention; the system tags the founders.
- Keep the whole message under 1200 characters.

Style examples (target this density):
• VoiceDrop AB testing blocked on Bubble→NextJS migration; medium-tier launch due Apr 22 (P0 churn).
• 1Lookup Prisma Accelerate setup 3d overdue; P2037 errors still in prod.
• AI SDR pilot deadline (Apr 20) passed with no launch signal — confirm or reset.`;

interface BuildUserPromptInput {
  channelName: string;
  /** Formatted Slack messages (channel history, last 7 days, parents only). */
  channelMessageLines: string[];
  /** Compact tracker signal lines (at-risk, spotlight, P0/P1, review-log items). */
  trackerSignalLines: string[];
  /** State from the previous successful digest (or null on first run). */
  previousState: ExecutiveDigestState | null;
  /** ISO timestamp used by the prompt as "now". */
  nowIso: string;
}

export function buildExecutiveDigestUserPrompt(
  input: BuildUserPromptInput
): string {
  const {
    channelName,
    channelMessageLines,
    trackerSignalLines,
    previousState,
    nowIso,
  } = input;

  const lines: string[] = [];
  lines.push(`Now (UTC): ${nowIso}`);
  lines.push(`Digest channel: #${channelName}`);
  lines.push("");

  if (previousState) {
    lines.push(`Previous digest posted at: ${previousState.postedAt}`);
    if (previousState.bulletHashes.length > 0) {
      lines.push(
        `Previous bullet fingerprints (do NOT repeat these topics):\n${previousState.bulletHashes
          .map((h) => `- ${h}`)
          .join("\n")}`
      );
    } else {
      lines.push("Previous digest had no bullets.");
    }
  } else {
    lines.push("This is the first-ever run of the executive digest.");
  }
  lines.push("");

  lines.push(
    `Last 7 days of #${channelName} (top-level messages; thread replies excluded):`
  );
  if (channelMessageLines.length === 0) {
    lines.push("(no messages in window)");
  } else {
    for (const l of channelMessageLines) lines.push(l);
  }
  lines.push("");

  lines.push("Current high-signal tracker state (one line per item):");
  if (trackerSignalLines.length === 0) {
    lines.push("(no at-risk, spotlight, P0, or P1 items right now)");
  } else {
    for (const l of trackerSignalLines) lines.push(l);
  }
  lines.push("");

  lines.push(
    "Write the digest now following the system rules. Do not include any preamble, explanation, or closing sign-off — just the sections."
  );

  return lines.join("\n");
}

/** Build a stable roster-id → display-name map from the tracker people list. */
export function buildPersonLabelMap(
  people: { slackHandle: string; name: string }[]
): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of people) {
    const uid = p.slackHandle?.trim().toUpperCase();
    if (!uid) continue;
    m.set(uid, p.name);
  }
  return m;
}

export function compactChannelMessages(
  messages: SlackChannelHistoryMessage[],
  labelMap: Map<string, string>,
  maxMessages = 300
): string[] {
  const sorted = [...messages].sort((a, b) => {
    const an = parseFloat(a.ts);
    const bn = parseFloat(b.ts);
    return an - bn;
  });
  const tail = sorted.slice(-maxMessages);
  return tail.map((m) => formatChannelMessage(m, labelMap));
}
