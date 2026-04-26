import { createHash } from "node:crypto";
import {
  fetchSlackChannelHistory,
  postSlackChannelMessageAsBot,
  type SlackChannelHistoryMessage,
} from "@/lib/slack";
import { getRepository } from "@/server/repository";
import { isFounderPerson } from "@/lib/autonomyRoster";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import {
  EXECUTIVE_DIGEST_SYSTEM_PROMPT,
  buildExecutiveDigestUserPrompt,
  buildPersonLabelMap,
  buildTrackerSignalLines,
  compactChannelMessages,
  getPublicBaseUrl,
} from "./prompt";
import { buildOnboardingSignalLines } from "@/lib/onboarding";
import {
  readExecutiveDigestState,
  writeExecutiveDigestState,
  type ExecutiveDigestState,
} from "./state";
import type { Person } from "@/lib/types/tracker";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SENTINEL_NOTHING = "NOTHING";

/** Result returned by the cron route (success or typed failure). */
export type BuildDigestResult =
  | {
      ok: true;
      posted: boolean;
      slackText: string;
      bulletCount: number;
      windowStartTs: string;
      windowMessageCount: number;
      droppedDuplicateBulletCount: number;
      dryRun: boolean;
      slackTs: string | null;
      channelId: string;
    }
  | {
      ok: false;
      stage:
        | "config"
        | "slack_history"
        | "anthropic"
        | "slack_post"
        | "internal";
      error: string;
    };

export interface BuildDigestOptions {
  /** When true, skip posting to Slack and writing state. */
  dryRun?: boolean;
  /** Overrides `new Date()`; useful for tests. */
  now?: Date;
  /** Overrides the 7-day window (ms). */
  windowMs?: number;
}

function requireChannelId(): string | null {
  const id = process.env.SLACK_EXECUTIVE_PRIORITIES_CHANNEL_ID?.trim();
  return id && id.length > 0 ? id : null;
}

function slackTsFromMs(ms: number): string {
  return (ms / 1000).toFixed(6);
}

/** Strip mrkdwn/link decoration so bullets that differ only in URL still match. */
function normalizeBulletForHash(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\*+/g, "")
    .replace(/[\s]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim()
    .toLowerCase();
}

function hashBullet(raw: string): string {
  const normalized = normalizeBulletForHash(raw);
  return createHash("sha1").update(normalized).digest("hex");
}

interface FilteredOutput {
  text: string;
  bulletLines: string[];
  droppedDuplicateBulletCount: number;
}

/**
 * Drop any bullet whose normalized hash is already in `priorHashes`, preserving
 * section headers. A section whose bullets are all removed is also removed.
 */
function filterRepeatedBullets(
  text: string,
  priorHashes: ReadonlySet<string>
): FilteredOutput {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  const keptBullets: string[] = [];
  let dropped = 0;

  // We need to drop a trailing empty header. Build groups.
  type Group = { header: string | null; bullets: string[] };
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();
    if (trimmed.startsWith("*") && trimmed.endsWith("*") && !trimmed.startsWith("• ")) {
      current = { header: trimmed, bullets: [] };
      groups.push(current);
      continue;
    }
    if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
      if (!current) {
        current = { header: null, bullets: [] };
        groups.push(current);
      }
      current.bullets.push(trimmed.replace(/^- /, "• "));
      continue;
    }
    // other non-empty lines (rare) -- attach as a pseudo-bullet if inside group
    if (trimmed.length > 0 && current) {
      current.bullets.push(trimmed);
    }
  }

  for (const g of groups) {
    const keptForGroup: string[] = [];
    for (const b of g.bullets) {
      const h = hashBullet(b);
      if (priorHashes.has(h)) {
        dropped += 1;
        continue;
      }
      keptForGroup.push(b);
      keptBullets.push(b);
    }
    if (keptForGroup.length === 0) continue;
    if (g.header) kept.push(g.header);
    for (const b of keptForGroup) kept.push(b);
    kept.push("");
  }

  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();

  return {
    text: kept.join("\n").trim(),
    bulletLines: keptBullets,
    droppedDuplicateBulletCount: dropped,
  };
}

/**
 * Build the `<@USERID> <@USERID>` mention prefix for every founder with a
 * Slack user ID configured in the Team roster. Returns "" when no founders
 * have a `slackHandle`, so the digest never starts with a stray space.
 */
function buildFounderMentionPrefix(people: Person[]): string {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    if (!isFounderPerson(p)) continue;
    const id = p.slackHandle?.trim();
    if (!id) continue;
    const key = id.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(key);
  }
  return ids.map((id) => `<@${id}>`).join(" ");
}

/** Single Portfolio OS hyperlink reused in the header (no per-bullet links). */
function buildPortfolioOsLink(): string {
  return `<${getPublicBaseUrl()}/|Portfolio OS>`;
}

function buildDigestHeader(nowIso: string, mentionPrefix: string): string {
  const day = nowIso.slice(0, 10);
  const ping = mentionPrefix ? `${mentionPrefix} ` : "";
  return `${ping}*Daily executive digest · ${day}* · ${buildPortfolioOsLink()}`;
}

function buildCalmDayMessage(nowIso: string, mentionPrefix: string): string {
  return `${buildDigestHeader(nowIso, mentionPrefix)}\nNothing new worth paging on since yesterday.`;
}

/**
 * Strip any `<URL|label>` link decoration left in a bullet by Claude. We now
 * link once in the header (Portfolio OS), so per-line links are noise. We keep
 * this safety net so an in-flight prompt change can't double-link the channel.
 */
function stripBulletLinks(line: string): string {
  return line
    .replace(/\s*<https?:\/\/[^|>]+\|[^>]+>\s*$/i, "")
    .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, "$1")
    .replace(/[ \t]+$/g, "")
    .trim();
}

/**
 * Orchestrates the full daily digest:
 *  1. Load previous state, tracker hierarchy, and 7d channel history.
 *  2. Call Claude with a compact prompt and a "do not repeat" hint list.
 *  3. Hash-dedupe bullets against yesterday's fingerprints.
 *  4. Post to Slack (unless `dryRun`) and persist new state.
 */
export async function buildAndSendExecutiveDigest(
  options: BuildDigestOptions = {}
): Promise<BuildDigestResult> {
  const { dryRun = false, now = new Date(), windowMs = SEVEN_DAYS_MS } = options;

  const channelId = requireChannelId();
  if (!channelId) {
    return {
      ok: false,
      stage: "config",
      error:
        "SLACK_EXECUTIVE_PRIORITIES_CHANNEL_ID is not set. Copy the Slack channel ID (starts with C or G) into the env var and redeploy.",
    };
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      ok: false,
      stage: "config",
      error: "ANTHROPIC_API_KEY is not set.",
    };
  }

  const windowStartMs = now.getTime() - windowMs;
  const windowStartTs = slackTsFromMs(windowStartMs);
  const nowIso = now.toISOString();

  const previousState = await readExecutiveDigestState();
  const repo = getRepository();

  const [history, hierarchy, people, projects] = await Promise.all([
    fetchSlackChannelHistory(channelId, {
      oldestTs: windowStartTs,
      maxMessages: 500,
    }),
    repo.getHierarchy(),
    repo.getPeople(),
    repo.getProjects(),
  ]);

  if (!history.ok) {
    return {
      ok: false,
      stage: "slack_history",
      error: history.error,
    };
  }

  const messages: SlackChannelHistoryMessage[] = history.messages.filter(
    (m) => {
      if (m.subtype === "channel_join" || m.subtype === "channel_leave") {
        return false;
      }
      return (m.text ?? "").trim().length > 0;
    }
  );

  const labelMap = buildPersonLabelMap(people);
  const channelMessageLines = compactChannelMessages(messages, labelMap, 300);
  const todayYmd = now.toISOString().slice(0, 10);
  const trackerSignalLines = [
    ...buildTrackerSignalLines(hierarchy, 120),
    ...buildOnboardingSignalLines(people, projects, todayYmd),
  ];

  const userPrompt = buildExecutiveDigestUserPrompt({
    channelName: "executive-priorities",
    channelMessageLines,
    trackerSignalLines,
    previousState,
    nowIso,
  });

  let rawAiText: string;
  try {
    rawAiText = await claudePlainText(
      EXECUTIVE_DIGEST_SYSTEM_PROMPT,
      userPrompt
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, stage: "anthropic", error: message };
  }

  const trimmed = rawAiText.trim();

  const priorHashes = new Set(previousState?.bulletHashes ?? []);
  const mentionPrefix = buildFounderMentionPrefix(people);

  let finalText: string;
  let finalBullets: string[];
  let dropped = 0;

  if (
    trimmed.length === 0 ||
    trimmed.toUpperCase() === SENTINEL_NOTHING
  ) {
    finalText = buildCalmDayMessage(nowIso, mentionPrefix);
    finalBullets = [];
  } else {
    const filtered = filterRepeatedBullets(trimmed, priorHashes);
    dropped = filtered.droppedDuplicateBulletCount;
    if (filtered.bulletLines.length === 0) {
      finalText = buildCalmDayMessage(nowIso, mentionPrefix);
      finalBullets = [];
    } else {
      const cleanedBody = filtered.text
        .split(/\r?\n/)
        .map((l) =>
          l.startsWith("• ") ? `• ${stripBulletLinks(l.slice(2))}` : l
        )
        .join("\n");
      finalText = `${buildDigestHeader(nowIso, mentionPrefix)}\n${cleanedBody}`;
      finalBullets = filtered.bulletLines.map((b) => stripBulletLinks(b));
    }
  }

  if (dryRun) {
    return {
      ok: true,
      posted: false,
      slackText: finalText,
      bulletCount: finalBullets.length,
      windowStartTs,
      windowMessageCount: messages.length,
      droppedDuplicateBulletCount: dropped,
      dryRun: true,
      slackTs: null,
      channelId,
    };
  }

  const posted = await postSlackChannelMessageAsBot(channelId, finalText);
  if (!posted.ok) {
    return {
      ok: false,
      stage: "slack_post",
      error: posted.error,
    };
  }

  const nextState: ExecutiveDigestState = {
    postedAt: nowIso,
    slackTs: posted.ts,
    lastAnalyzedSlackTs:
      messages.length > 0
        ? messages[messages.length - 1]!.ts
        : (previousState?.lastAnalyzedSlackTs ?? null),
    bulletHashes: finalBullets.map((b) => hashBullet(b)),
  };
  await writeExecutiveDigestState(nextState);

  return {
    ok: true,
    posted: true,
    slackText: finalText,
    bulletCount: finalBullets.length,
    windowStartTs,
    windowMessageCount: messages.length,
    droppedDuplicateBulletCount: dropped,
    dryRun: false,
    slackTs: posted.ts,
    channelId,
  };
}

/**
 * Best-effort failure notification: posts a short "Digest failed" line to the
 * digest channel only when `DIGEST_POST_FAILURES=1` is set. Never throws.
 */
export async function maybePostDigestFailureNotice(
  reason: string
): Promise<void> {
  if (process.env.DIGEST_POST_FAILURES?.trim() !== "1") return;
  const channelId = requireChannelId();
  if (!channelId) return;
  try {
    const truncated = reason.replace(/\s+/g, " ").slice(0, 400);
    await postSlackChannelMessageAsBot(
      channelId,
      `_Daily executive digest failed:_ ${truncated}`
    );
  } catch {
    // swallow; failure notice is best-effort
  }
}
