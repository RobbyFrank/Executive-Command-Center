"use server";

import Anthropic from "@anthropic-ai/sdk";
import type { Person } from "@/lib/types/tracker";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  fetchSlackWorkspaceMembers,
  fetchSlackChannels as fetchSlackChannelsLib,
  fetchSlackUserById,
  fetchSlackJoinDateFromProfileGet,
  logSlackJoinDate,
  parseSlackThreadUrl,
  fetchSlackThreadReplies,
  postSlackThreadReply,
  fetchSlackUserLabelForToken,
  slackUserTokenForThreads,
  postSlackChannelMessage,
  getSlackMessagePermalink,
} from "@/lib/slack";
import {
  slackMessageTextForDisplay,
  collectSlackUserIdsFromMessageText,
} from "@/lib/slackDisplay";
import { getRepository } from "@/server/repository";
import { compareMilestonesByTargetDate } from "@/lib/milestoneSort";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { updateMilestone } from "@/server/actions/tracker";
import {
  savePersonProfileFromRemoteUrl,
  deleteFileIfInUploads,
} from "@/server/imageFiles";
import { createPerson, getPeople, updatePerson } from "@/server/actions/tracker";
import { SLACK_REFRESH_NO_NEW_DATA_MESSAGE } from "@/lib/slack-refresh-messages";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";
import {
  buildMilestoneThreadContextBlock,
  buildMilestoneThreadReviseUserPayload,
  MILESTONE_THREAD_DRAFT_SYSTEM_PROMPT,
  MILESTONE_THREAD_REVISE_SYSTEM_PROMPT,
} from "@/server/slackMilestoneThreadDraftContext";

export async function fetchSlackMembers() {
  return fetchSlackWorkspaceMembers();
}

export async function fetchSlackChannelsList() {
  return fetchSlackChannelsLib();
}

export type { FetchSlackChannelsResult } from "@/lib/slack";

export type SlackImportMemberPayload = {
  id: string;
  realName: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  /** YYYY-MM-DD from Slack `profile.start_date` when present. */
  joinDate: string;
};

export type ImportSlackMembersResult =
  | {
      ok: true;
      imported: Person[];
      avatarWarnings: string[];
    }
  | { ok: false; error: string };

/**
 * Creates roster rows for selected Slack members and uploads avatars to Vercel Blob when URLs exist.
 */
export async function importSlackMembers(
  members: SlackImportMemberPayload[]
): Promise<ImportSlackMembersResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return {
      ok: false,
      error:
        "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN to import profile photos from Slack.",
    };
  }

  const roster = await getPeople();
  const takenSlack = new Set(
    roster
      .map((p) => p.slackHandle?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s))
  );

  const imported: Person[] = [];
  const avatarWarnings: string[] = [];

  for (const m of members) {
    const slackId = m.id.trim().toUpperCase();
    if (!slackId) continue;
    if (takenSlack.has(slackId)) continue;
    takenSlack.add(slackId);

    const label =
      m.realName.trim() ||
      m.displayName.trim() ||
      `Team member (${slackId})`;

    let joinDate = (m.joinDate ?? "").trim();
    if (!joinDate) {
      joinDate = (await fetchSlackJoinDateFromProfileGet(m.id)).trim();
    }

    const person = await createPerson({
      name: label,
      role: "",
      department: "",
      autonomyScore: 3,
      slackHandle: slackId,
      profilePicturePath: "",
      joinDate,
      email: (m.email ?? "").trim(),
      phone: "",
      estimatedMonthlySalary: 0,
      employment: "inhouse_salaried",
    });

    const url = (m.avatarUrl ?? "").trim();
    if (url) {
      const saved = await savePersonProfileFromRemoteUrl({
        personId: person.id,
        imageUrl: url,
      });
      if (saved.ok) {
        const updated = await updatePerson(person.id, {
          profilePicturePath: saved.webPath,
        });
        imported.push(updated);
      } else {
        avatarWarnings.push(`${label}: ${saved.error}`);
        imported.push(person);
      }
    } else {
      imported.push(person);
    }
  }

  return { ok: true, imported, avatarWarnings };
}

// ---------------------------------------------------------------------------
// Refresh a single person from Slack (name, email, avatar)
// ---------------------------------------------------------------------------

export type RefreshPersonResult =
  | { ok: true; person: Person; avatarWarning?: string }
  | { ok: false; error: string };

/**
 * Fetches the latest profile from Slack for a person that already has a `slackHandle`.
 * Updates name, email, join date, and profile picture (Blob). Join date is resolved from
 * **`users.profile.get`** first (Atlas `start_date` and ISO dates in custom fields), then falls
 * back to `users.info` data from `fetchSlackUserById` — matching Import-from-Slack enrichment.
 * Does **not** touch other roster fields.
 */
export async function refreshPersonFromSlack(
  personId: string,
  slackHandle: string
): Promise<RefreshPersonResult> {
  const slackId = slackHandle.trim().toUpperCase();
  if (!slackId) {
    return { ok: false, error: "No Slack user ID on this team member." };
  }

  const lookup = await fetchSlackUserById(slackId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }

  const m = lookup.member;
  const name = m.realName || m.displayName || undefined;
  const email = (m.email ?? "").trim() || undefined;
  /** Always prefer `users.profile:read` / `users.profile.get` for hire/org date (often absent on `users.info`). */
  const fromProfileGet = (await fetchSlackJoinDateFromProfileGet(m.id)).trim();
  const fromMember = (m.joinDate ?? "").trim();
  const joinDate = fromProfileGet || fromMember;

  logSlackJoinDate("refreshPersonFromSlack merge", {
    personId,
    slackUserId: m.id,
    fromProfileGet: fromProfileGet || "(empty)",
    fromMemberFallback: fromMember || "(empty)",
    finalJoinDate: joinDate || "(empty)",
    willSetJoinDate: Boolean(joinDate),
  });

  const updates: Partial<Person> = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (joinDate) updates.joinDate = joinDate;

  let avatarWarning: string | undefined;
  const avatarUrl = (m.avatarUrl ?? "").trim();
  if (avatarUrl && process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    const saved = await savePersonProfileFromRemoteUrl({
      personId,
      imageUrl: avatarUrl,
    });
    if (saved.ok) {
      const people = await getPeople();
      const existing = people.find((p) => p.id === personId);
      const prev = existing?.profilePicturePath;
      updates.profilePicturePath = saved.webPath;
      if (prev && prev !== saved.webPath) {
        try {
          await deleteFileIfInUploads(prev);
        } catch {
          /* best-effort cleanup */
        }
      }
    } else {
      avatarWarning = saved.error;
    }
  } else if (avatarUrl && !process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    avatarWarning =
      "Profile photo not updated — BLOB_READ_WRITE_TOKEN is not set.";
  }

  if (Object.keys(updates).length === 0 && !avatarWarning) {
    return { ok: false, error: SLACK_REFRESH_NO_NEW_DATA_MESSAGE };
  }

  const person =
    Object.keys(updates).length > 0
      ? await updatePerson(personId, updates)
      : (await getPeople()).find((p) => p.id === personId)!;

  return { ok: true, person, avatarWarning };
}

export type RefreshAllFromSlackResult =
  | {
      ok: true;
      /** People with a non-empty Slack user ID. */
      withSlack: number;
      updated: number;
      unchanged: number;
      failed: number;
      failures: { name: string; error: string }[];
      avatarWarnings: string[];
    }
  | { ok: false; error: string };

/**
 * Sequentially runs the same refresh as **Refresh from Slack** for every roster row with a
 * `slackHandle`. Intended for bulk sync; may take a while on large teams.
 */
export async function refreshAllFromSlack(): Promise<RefreshAllFromSlackResult> {
  const people = await getPeople();
  const targets = people.filter((p) => (p.slackHandle ?? "").trim() !== "");
  if (targets.length === 0) {
    return {
      ok: true,
      withSlack: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      failures: [],
      avatarWarnings: [],
    };
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const failures: { name: string; error: string }[] = [];
  const avatarWarnings: string[] = [];

  for (const p of targets) {
    const handle = p.slackHandle!.trim();
    const r = await refreshPersonFromSlack(p.id, handle);
    if (r.ok) {
      updated += 1;
      if (r.avatarWarning) {
        avatarWarnings.push(`${p.name}: ${r.avatarWarning}`);
      }
    } else if (r.error === SLACK_REFRESH_NO_NEW_DATA_MESSAGE) {
      unchanged += 1;
    } else {
      failed += 1;
      failures.push({ name: p.name, error: r.error });
    }
  }

  return {
    ok: true,
    withSlack: targets.length,
    updated,
    unchanged,
    failed,
    failures,
    avatarWarnings,
  };
}

// ---------------------------------------------------------------------------
// Milestone Slack thread: status, summarize, ping (user token)
// ---------------------------------------------------------------------------

const THREAD_STALE_MS = 24 * 60 * 60 * 1000;

/** Team roster hints (Slack user id + display name + optional avatar) for thread previews. */
export type SlackMemberRosterHint = {
  slackUserId: string;
  name: string;
  /** Site path under public/, e.g. /uploads/people/robby.png */
  profilePicturePath?: string;
};

function rosterMapFromHints(
  hints: SlackMemberRosterHint[] | undefined
): Map<string, { name: string; profilePicturePath?: string }> {
  const rosterById = new Map<
    string,
    { name: string; profilePicturePath?: string }
  >();
  for (const h of hints ?? []) {
    const id = h.slackUserId.trim().toUpperCase();
    if (!id) continue;
    rosterById.set(id, {
      name: h.name.trim() || id,
      profilePicturePath: h.profilePicturePath?.trim() || undefined,
    });
  }
  return rosterById;
}

async function buildSlackUserDisplayMaps(
  userIds: string[],
  token: string | undefined,
  rosterById: Map<string, { name: string; profilePicturePath?: string }>
): Promise<{
  labelMap: Map<string, string>;
  avatarById: Map<string, string | null>;
}> {
  const normalized = [
    ...new Set(userIds.map((id) => id.trim().toUpperCase())),
  ].filter(Boolean);
  const labelMap = new Map<string, string>();
  const avatarById = new Map<string, string | null>();

  await Promise.all(
    normalized.map(async (uid) => {
      const roster = rosterById.get(uid);
      let label: string;
      if (token) {
        const apiLabel = await fetchSlackUserLabelForToken(token, uid);
        if (apiLabel && apiLabel !== uid && apiLabel !== "Unknown") {
          label = apiLabel;
        } else {
          label = roster?.name ?? apiLabel;
        }
      } else {
        label = roster?.name ?? uid;
      }
      labelMap.set(uid, label);
      const path = roster?.profilePicturePath?.trim();
      avatarById.set(uid, path ? path : null);
    })
  );

  return { labelMap, avatarById };
}

function formatShortRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 21) return `${day}d ago`;
  return d.toLocaleDateString();
}

function sortMessagesByTs<T extends { ts: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
  );
}

async function claudePlainText(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  const anthropic = new Anthropic({ apiKey });
  const res = await anthropic.messages.create({
    model: getAnthropicModel(),
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = res.content[0];
  if (block?.type !== "text") {
    throw new Error("Unexpected response from the AI model.");
  }
  return block.text.trim();
}

export type SlackThreadStatusResult =
  | {
      ok: true;
      lastReplyAt: string;
      lastReplyRelative: string;
      replyCount: number;
      isStale: boolean;
      snippet: string;
      recentMessages: {
        userLabel: string;
        text: string;
        /** When present, per-message time (older cached payloads may omit). */
        postedRelative?: string;
        slackUserId?: string;
        avatarSrc?: string | null;
      }[];
    }
  | { ok: false; error: string };

/**
 * Loads thread metadata for the milestone Slack URL (last activity, preview lines).
 * Pass optional Team roster hints so names/avatars resolve when Slack API labels are missing.
 */
export async function fetchSlackThreadStatus(
  slackUrl: string,
  rosterHints?: SlackMemberRosterHint[]
): Promise<SlackThreadStatusResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return {
      ok: false,
      error:
        "Not a recognized Slack thread URL. Paste an archives link (…/archives/C…/p…) or an app.slack.com thread link.",
    };
  }

  const rep = await fetchSlackThreadReplies(parsed.channelId, parsed.threadTs);
  if (!rep.ok) return rep;

  const sorted = sortMessagesByTs(rep.messages);
  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);

  const forLabels = sorted.slice(-12);
  const lastThree = sorted.slice(-3);
  const mentionIds = new Set<string>();
  for (const m of lastThree) {
    for (const id of collectSlackUserIdsFromMessageText(m.text ?? "")) {
      mentionIds.add(id);
    }
  }
  const uniqueUsers = [
    ...new Set([
      ...forLabels
        .map((m) => m.user)
        .filter((u): u is string => Boolean(u))
        .map((u) => u.toUpperCase()),
      ...mentionIds,
    ]),
  ];

  const { labelMap, avatarById } = await buildSlackUserDisplayMaps(
    uniqueUsers,
    token,
    rosterById
  );

  const recentMessages = lastThree.map((m) => {
    const uid = m.user?.trim().toUpperCase();
    const label =
      uid != null
        ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
        : "App";
    const avatar =
      uid != null ? (avatarById.get(uid) ?? null) : null;
    const postedAt = new Date(parseFloat(m.ts) * 1000);
    return {
      userLabel: label,
      slackUserId: uid,
      avatarSrc: avatar,
      postedRelative: formatShortRelative(postedAt),
      text: slackMessageTextForDisplay(m.text ?? "", 500, labelMap),
    };
  });

  const last1 = sorted[sorted.length - 1];
  const last2 = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
  const snippetParts: string[] = [];
  if (last2) {
    const uid = last2.user?.trim().toUpperCase();
    const lab = uid
      ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
      : "App";
    snippetParts.push(
      `${lab}: ${slackMessageTextForDisplay(last2.text ?? "", 140, labelMap)}`
    );
  }
  if (last1) {
    const uid = last1.user?.trim().toUpperCase();
    const lab = uid
      ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
      : "App";
    snippetParts.push(
      `${lab}: ${slackMessageTextForDisplay(last1.text ?? "", 140, labelMap)}`
    );
  }
  const snippet = snippetParts.join(" · ");

  const iso = rep.latestDate.toISOString();
  const isStale = Date.now() - rep.latestDate.getTime() > THREAD_STALE_MS;

  return {
    ok: true,
    lastReplyAt: iso,
    lastReplyRelative: formatShortRelative(rep.latestDate),
    replyCount: rep.messages.length,
    isStale,
    snippet,
    recentMessages,
  };
}

export type SummarizeSlackThreadResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

export async function summarizeSlackThread(
  slackUrl: string,
  rosterHints?: SlackMemberRosterHint[]
): Promise<SummarizeSlackThreadResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid Slack thread URL." };
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
      ...slice.map((m) => m.user).filter((u): u is string => Boolean(u)).map((u) => u.toUpperCase()),
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
    const body = slackMessageTextForDisplay(m.text ?? "", 1200, labelMap);
    lines.push(`[${who}]: ${body}`);
  }

  const transcript = lines.join("\n\n");
  try {
    const summary = await claudePlainText(
      "Summarize this Slack thread as a concise progress update. Focus on: what was decided, what is in progress, what is blocked, and next steps. Use short bullets or a tight paragraph. Do not invent facts beyond the thread.",
      `Thread transcript:\n\n${transcript}`
    );
    return { ok: true, summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type GenerateThreadPingMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function generateThreadPingMessage(
  slackUrl: string,
  milestoneName: string,
  rosterHints?: SlackMemberRosterHint[]
): Promise<GenerateThreadPingMessageResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid Slack thread URL." };
  }

  const rep = await fetchSlackThreadReplies(parsed.channelId, parsed.threadTs);
  if (!rep.ok) return rep;

  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sorted = sortMessagesByTs(rep.messages);
  const tail = sorted.slice(-8);
  const mentionIds: string[] = [];
  for (const m of tail) {
    mentionIds.push(...collectSlackUserIdsFromMessageText(m.text ?? ""));
  }
  const ids = [
    ...new Set([
      ...tail.map((m) => m.user).filter((u): u is string => Boolean(u)).map((u) => u.toUpperCase()),
      ...mentionIds,
    ]),
  ];
  const { labelMap } = await buildSlackUserDisplayMaps(ids, token, rosterById);
  const lines: string[] = [];
  for (const m of tail) {
    const uid = m.user?.trim().toUpperCase();
    const who = uid
      ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
      : "app/bot";
    lines.push(`[${who}]: ${slackMessageTextForDisplay(m.text ?? "", 800, labelMap)}`);
  }

  const transcript = lines.join("\n\n");
  try {
    const message = await claudePlainText(
      `Generate a brief, friendly follow-up message for this Slack thread about the milestone "${milestoneName}". Ask for a status update based on the recent conversation. Keep it to at most two short sentences. Sound natural and professional. Output only the message text to post — no quotes or preamble.`,
      `Recent thread messages:\n\n${transcript || "(no text in thread)"}`
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type PingSlackThreadResult = { ok: true } | { ok: false; error: string };

export async function pingSlackThread(
  slackUrl: string,
  message: string
): Promise<PingSlackThreadResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid Slack thread URL." };
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "Message is empty." };
  }

  const rep = await fetchSlackThreadReplies(parsed.channelId, parsed.threadTs);
  if (!rep.ok) return rep;

  return postSlackThreadReply(parsed.channelId, rep.rootTs, trimmed);
}

function calendarDaysDiffUtc(a: Date, b: Date): number {
  const t = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const u = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((t - u) / 86400000);
}

function slackTsToDate(ts: string): Date {
  const n = parseFloat(ts);
  return new Date(Number.isFinite(n) ? n * 1000 : 0);
}

function parseMilestoneTargetDate(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;
  const ymd = parseCalendarDateString(t);
  if (ymd) return ymd;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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
      : String(Math.max(1, Math.min(5, Math.round(ownerAutonomy))));
  const complexity = Math.max(1, Math.min(5, Math.round(projectComplexity)));

  const contextExtra = (roadmapContext ?? "").trim();

  const userPayload = [
    `Milestone: "${milestoneName}"`,
    `Target date (calendar): ${dueCal.toISOString().slice(0, 10)}`,
    `Days remaining until target (local calendar days): ${daysRemaining}`,
    `Thread started (root message date, local): ${threadStartCal.toDateString()}`,
    `Days since thread started (local calendar days): ${daysElapsed}`,
    `Owner autonomy (1-5, higher = more execution independence): ${autonomyLabel}`,
    `Project complexity (1-5, higher = harder): ${complexity}`,
    contextExtra ? `Roadmap context:\n${contextExtra}` : "",
    "",
    "Thread transcript (oldest to newest in this slice):",
    transcript || "(no text in thread)",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You are an executive project analyst. Given a milestone's Slack thread transcript, its target date, owner autonomy score, and project complexity, estimate the likelihood this milestone will be completed on time.

Consider:
- How much progress is evident in the thread relative to time elapsed vs remaining
- The pace and recency of activity (stale or quiet threads = higher risk)
- Owner autonomy (1-5, higher = more capable of independent execution)
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

    return {
      ok: true,
      likelihood: Math.max(0, Math.min(100, Math.round(likelihood))),
      riskLevel,
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

export type GenerateDeadlineNudgeMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Draft a manager-voice Slack reply that stresses the milestone deadline.
 */
export async function generateDeadlineNudgeMessage(
  slackUrl: string,
  milestoneName: string,
  targetDate: string,
  rosterHints: SlackMemberRosterHint[] | undefined,
  likelihoodContext: DeadlineNudgeLikelihoodContext
): Promise<GenerateDeadlineNudgeMessageResult> {
  const parsed = parseSlackThreadUrl(slackUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid Slack thread URL." };
  }

  const due = parseMilestoneTargetDate(targetDate);
  if (!due) {
    return { ok: false, error: "Invalid or missing target date." };
  }

  const rep = await fetchSlackThreadReplies(parsed.channelId, parsed.threadTs);
  if (!rep.ok) return rep;

  const token = slackUserTokenForThreads();
  const rosterById = rosterMapFromHints(rosterHints);
  const sorted = sortMessagesByTs(rep.messages);
  const tail = sorted.slice(-8);
  const mentionIds: string[] = [];
  for (const m of tail) {
    mentionIds.push(...collectSlackUserIdsFromMessageText(m.text ?? ""));
  }
  const ids = [
    ...new Set([
      ...tail
        .map((m) => m.user)
        .filter((u): u is string => Boolean(u))
        .map((u) => u.toUpperCase()),
      ...mentionIds,
    ]),
  ];
  const { labelMap } = await buildSlackUserDisplayMaps(ids, token, rosterById);
  const lines: string[] = [];
  for (const m of tail) {
    const uid = m.user?.trim().toUpperCase();
    const who = uid
      ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
      : "app/bot";
    lines.push(`[${who}]: ${slackMessageTextForDisplay(m.text ?? "", 800, labelMap)}`);
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
  const dueLabel = dueCal.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const daysPhrase =
    daysRemaining === 0
      ? "today"
      : daysRemaining === 1
        ? "1 day from now"
        : daysRemaining > 1
          ? `in ${daysRemaining} days`
          : daysRemaining === -1
            ? "yesterday (overdue)"
            : `${Math.abs(daysRemaining)} days ago (overdue)`;

  try {
    const message = await claudePlainText(
      `Generate a message to post in this Slack thread from the executive/manager's first-person perspective (use "I" / "I want"). The milestone "${milestoneName}" is due on ${dueLabel} (${daysPhrase}). Based on our assessment, progress appears to be roughly ${likelihoodContext.progressEstimate}% complete, and deadline risk is ${likelihoodContext.riskLevel}. Context: ${likelihoodContext.reasoning}

The message must:
- Clearly state the deadline and urgency
- Acknowledge progress if appropriate
- Ask the team to prioritize finishing on time — tone scales with risk (${likelihoodContext.riskLevel})
- Be direct but professional, 2-4 sentences
- NOT mention AI, automation, or "assessment"
- Output only the message text to post — no quotes or preamble.`,
      `Recent thread messages:\n\n${transcript || "(no text in thread)"}`
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Draft dialog: Slack user token identity (preview header: avatar + name)
// ---------------------------------------------------------------------------

export type SlackThreadPosterPreviewIdentity = {
  displayName: string;
  /** Local `/uploads/...` path or `https://` Slack CDN avatar URL */
  avatarSrc: string | null;
};

/**
 * Resolves who will appear as the message author when posting with the thread
 * user token: Team roster match on `slackHandle`, else Slack `users.info` label + avatar.
 */
export async function getSlackThreadPosterPreviewIdentity(): Promise<SlackThreadPosterPreviewIdentity> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return { displayName: "You", avatarSrc: null };
  }

  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const authData = (await authRes.json()) as {
      ok?: boolean;
      user_id?: string;
    };
    if (!authData.ok || !authData.user_id) {
      return { displayName: "You", avatarSrc: null };
    }

    const uid = authData.user_id.trim().toUpperCase();
    const repo = getRepository();
    const tracker = await repo.load();
    const person = tracker.people.find(
      (p) => (p.slackHandle ?? "").trim().toUpperCase() === uid
    );

    if (person) {
      const path = person.profilePicturePath?.trim();
      return {
        displayName: person.name,
        avatarSrc: path && path.length > 0 ? path : null,
      };
    }

    const displayName = await fetchSlackUserLabelForToken(token, uid);

    const infoRes = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(uid)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const infoData = (await infoRes.json()) as {
      ok?: boolean;
      user?: { profile?: { image_72?: string; image_48?: string } };
    };
    const url =
      infoData.user?.profile?.image_72?.trim() ||
      infoData.user?.profile?.image_48?.trim() ||
      null;

    return { displayName, avatarSrc: url };
  } catch {
    return { displayName: "You", avatarSrc: null };
  }
}

// ---------------------------------------------------------------------------
// Create milestone Slack thread (post to goal channel + save permalink)
// ---------------------------------------------------------------------------

export type DraftMilestoneThreadMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function draftMilestoneThreadMessage(
  milestoneId: string
): Promise<DraftMilestoneThreadMessageResult> {
  const ctx = await buildMilestoneThreadContextBlock(milestoneId);
  if (!ctx.ok) return ctx;

  try {
    const message = await claudePlainText(
      MILESTONE_THREAD_DRAFT_SYSTEM_PROMPT,
      ctx.userBlock
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type ReviseMilestoneThreadDraftResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function reviseMilestoneThreadDraft(
  milestoneId: string,
  currentDraft: string,
  feedback: string
): Promise<ReviseMilestoneThreadDraftResult> {
  const ctx = await buildMilestoneThreadContextBlock(milestoneId);
  if (!ctx.ok) return ctx;

  const fb = feedback.trim();
  if (!fb) {
    return { ok: false, error: "Feedback is empty." };
  }

  try {
    const message = await claudePlainText(
      MILESTONE_THREAD_REVISE_SYSTEM_PROMPT,
      buildMilestoneThreadReviseUserPayload(ctx.userBlock, currentDraft, fb)
    );
    return { ok: true, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type CreateMilestoneSlackThreadResult =
  | { ok: true; slackUrl: string }
  | { ok: false; error: string };

export async function createMilestoneSlackThread(
  milestoneId: string,
  channelId: string,
  message: string
): Promise<CreateMilestoneSlackThreadResult> {
  const ch = channelId.trim();
  const text = message.trim();
  if (!ch) {
    return { ok: false, error: "Slack channel is not set." };
  }
  if (!text) {
    return { ok: false, error: "Message is empty." };
  }

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
  const goalCh = (goal.slackChannelId ?? "").trim();
  if (!goalCh || goalCh !== ch) {
    return {
      ok: false,
      error:
        "Channel does not match this goal’s Slack channel. Refresh the Roadmap and try again.",
    };
  }

  const posted = await postSlackChannelMessage(ch, text);
  if (!posted.ok) return posted;

  const link = await getSlackMessagePermalink(posted.channel, posted.ts);
  if (!link.ok) return link;

  await updateMilestone(milestoneId, { slackUrl: link.permalink });
  return { ok: true, slackUrl: link.permalink };
}
