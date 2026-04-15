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
    return {
      userLabel: label,
      slackUserId: uid,
      avatarSrc: avatar,
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

// ---------------------------------------------------------------------------
// Create milestone Slack thread (post to goal channel + save permalink)
// ---------------------------------------------------------------------------

type MilestoneThreadContextBlock =
  | { ok: true; userBlock: string; milestoneName: string }
  | { ok: false; error: string };

async function buildMilestoneThreadContextBlock(
  milestoneId: string
): Promise<MilestoneThreadContextBlock> {
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
  const company = data.companies.find((c) => c.id === goal.companyId);

  const projectMilestones = data.milestones
    .filter((m) => m.projectId === project.id)
    .sort(compareMilestonesByTargetDate);

  const lines: string[] = [];
  lines.push(`Company: ${company?.name ?? "?"} (${company?.shortName ?? "?"})`);
  lines.push(`Goal: ${goal.description}`);
  if (goal.measurableTarget.trim()) {
    lines.push(`Goal description (detail): ${goal.measurableTarget}`);
  }
  if (goal.whyItMatters.trim()) {
    lines.push(`Why it matters: ${goal.whyItMatters}`);
  }
  if (goal.currentValue.trim()) {
    lines.push(`Current: ${goal.currentValue}`);
  }
  lines.push(`Project: ${project.name}`);
  if (project.description.trim()) {
    lines.push(`Project scope: ${project.description}`);
  }
  if (project.definitionOfDone.trim()) {
    lines.push(`Done when: ${project.definitionOfDone}`);
  }
  lines.push(`Project status: ${project.status} | Priority: ${project.priority}`);

  lines.push("");
  lines.push("Milestones (this project), in date order:");
  for (const m of projectMilestones) {
    const mark =
      m.id === milestone.id ? " ← THIS MILESTONE" : "";
    lines.push(
      `- ${m.name} [${m.status}]${m.targetDate ? ` target ${m.targetDate}` : ""}${mark}`
    );
  }

  const siblingSnips: string[] = [];
  for (const m of projectMilestones) {
    if (m.id === milestone.id) continue;
    const url = m.slackUrl?.trim() ?? "";
    if (!isValidHttpUrl(url)) continue;
    if (siblingSnips.length >= 4) break;
    const st = await fetchSlackThreadStatus(url);
    if (st.ok) {
      siblingSnips.push(
        `• ${m.name}: ${st.snippet || "thread linked"}`
      );
    } else {
      siblingSnips.push(`• ${m.name}: (Slack thread linked — could not load preview)`);
    }
  }
  if (siblingSnips.length > 0) {
    lines.push("");
    lines.push("Other milestones with Slack threads (context):");
    lines.push(siblingSnips.join("\n"));
  }

  lines.push("");
  lines.push(
    `Write an opening Slack message for the milestone: "${milestone.name}"`
  );
  if (milestone.targetDate.trim()) {
    lines.push(`Target date: ${milestone.targetDate}`);
  }

  return {
    ok: true,
    userBlock: lines.join("\n"),
    milestoneName: milestone.name,
  };
}

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
      "You are drafting a Slack message to kick off discussion about a milestone. Be direct and professional. Include what needs to happen, any relevant context from the goal/project, and what you expect from the team. Format for Slack plain text (use *bold* sparingly if useful, short bullets if needed). Keep it focused — about 3–6 short paragraphs or equivalent. Output only the message text to post — no preamble or quotes.",
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
      "The user wants you to revise this Slack thread opening message. Apply their feedback while keeping the message professional and focused. Output only the revised message text — no preamble or quotes.",
      `Background:\n${ctx.userBlock}\n\n---\n\nCurrent draft:\n${currentDraft.trim()}\n\n---\n\nUser feedback:\n${fb}`
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
