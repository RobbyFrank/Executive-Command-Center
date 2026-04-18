import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import {
  fetchSlackThreadReplies,
  fetchSlackUserLabelForToken,
  parseSlackThreadUrl,
  slackUserTokenForThreads,
} from "@/lib/slack";
import {
  collectSlackUserIdsFromMessageText,
  slackMessageTextForDisplay,
} from "@/lib/slackDisplay";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

export const THREAD_STALE_MS = 24 * 60 * 60 * 1000;

/** Team roster hints (Slack user id + display name + optional avatar) for thread previews. */
export type SlackMemberRosterHint = {
  slackUserId: string;
  name: string;
  /** Site path under public/, e.g. /uploads/people/robby.png */
  profilePicturePath?: string;
};

export function rosterMapFromHints(
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

export async function buildSlackUserDisplayMaps(
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

export function formatShortRelative(d: Date): string {
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

export function sortMessagesByTs<T extends { ts: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
  );
}

export async function claudePlainText(
  system: string,
  user: string
): Promise<string> {
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

type ThreadPingTailTranscriptResult =
  | { ok: true; transcript: string }
  | { ok: false; error: string };

/** Last 8 thread messages, labeled for AI (shared by ping / nudge / revise). */
export async function buildRecentThreadPingTranscript(
  slackUrl: string,
  rosterHints?: SlackMemberRosterHint[]
): Promise<ThreadPingTailTranscriptResult> {
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
    lines.push(
      `[${who}]: ${slackMessageTextForDisplay(m.text ?? "", 800, labelMap)}`
    );
  }
  return { ok: true, transcript: lines.join("\n\n") };
}

export const THREAD_PING_REVISE_SYSTEM_PROMPT =
  'The user wants you to revise a Slack thread reply — a short follow-up posted inside an existing Slack conversation (not a new top-level channel post). Apply their feedback while keeping the tone appropriate and professional. Never use an em dash (Unicode U+2014); use commas, colons, ASCII hyphens, or parentheses instead. If the current draft begins with a Slack user mention token like <@U…>, keep that exact mention as the first characters of the revised message. You are writing as the human sender described in the Authorship section of the background: speak in first person (I / my / our), do NOT @-mention or write out the sender\'s own name anywhere in the message, and when the Authorship section names an assignee, address them (not yourself). Output only the revised message text to post, with no preamble or quotes.';

type ThreadReplySenderIdentity = {
  slackUserId: string | null;
  displayName: string | null;
};

/** Resolve who is posting: `auth.test` for the user token, preferring Team roster names. */
export async function resolveThreadReplySenderIdentity(
  token: string | undefined,
  rosterById: Map<string, { name: string; profilePicturePath?: string }>
): Promise<ThreadReplySenderIdentity> {
  if (!token) return { slackUserId: null, displayName: null };
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
      return { slackUserId: null, displayName: null };
    }
    const uid = authData.user_id.trim().toUpperCase();
    const rosterHit = rosterById.get(uid);
    if (rosterHit?.name) {
      return { slackUserId: uid, displayName: rosterHit.name };
    }
    const label = await fetchSlackUserLabelForToken(token, uid);
    const displayName =
      label && label !== "Unknown" && label !== uid ? label : null;
    return { slackUserId: uid, displayName };
  } catch {
    return { slackUserId: null, displayName: null };
  }
}

/**
 * Plain-text background block that tells the model who is posting, who the work
 * is assigned to, and which Slack mention tokens to use. Appended to the user
 * payload for thread-reply generation/revision so drafts address the right
 * person and never @-mention the sender themselves.
 */
export function buildThreadReplyAuthorshipBackground(
  sender: ThreadReplySenderIdentity,
  assigneeName: string | undefined,
  rosterHints: SlackMemberRosterHint[] | undefined
): string {
  const lines: string[] = [];
  lines.push("Authorship:");

  if (sender.displayName && sender.slackUserId) {
    lines.push(
      `- You are writing this reply AS ${sender.displayName} (Slack <@${sender.slackUserId}>). Speak in first person ("I", "my", "our"). Do NOT @-mention yourself and do NOT write out your own name anywhere in the message; refer to yourself only as "I" or "me".`
    );
  } else if (sender.displayName) {
    lines.push(
      `- You are writing this reply AS ${sender.displayName}. Speak in first person ("I", "my", "our"). Do NOT write out your own name in the message; refer to yourself only as "I" or "me".`
    );
  } else {
    lines.push(
      '- You are writing this reply as the person posting from this account. Speak in first person ("I", "my", "our"). Do not invent a sender name or @-mention anyone as the sender.'
    );
  }

  const assignee = assigneeName?.trim() ?? "";
  const senderUid = sender.slackUserId ?? "";
  if (assignee) {
    const rosterHit = (rosterHints ?? []).find(
      (h) =>
        h.name.trim().toLowerCase() === assignee.toLowerCase() &&
        h.slackUserId.trim() !== ""
    );
    const assigneeUid = rosterHit?.slackUserId.trim().toUpperCase() ?? "";
    if (assigneeUid && assigneeUid !== senderUid) {
      lines.push(
        `- The person assigned to this work is ${assignee} (Slack <@${assigneeUid}>). When you ask for an update or push on the deadline, direct it at them by mentioning <@${assigneeUid}>, not yourself and not the full team. Do not @-mention anyone else unless the thread context makes it clearly necessary.`
      );
    } else if (assigneeUid && assigneeUid === senderUid) {
      lines.push(
        `- The person assigned to this work is also the sender (you). Address the thread with first-person language ("I'll wrap this up…"), do not @-mention yourself.`
      );
    } else {
      lines.push(
        `- The person assigned to this work is ${assignee}. Address them by name if you call someone out; do not address yourself and do not @-mention anyone else unless clearly needed.`
      );
    }
  }

  const mentionable = (rosterHints ?? []).filter(
    (h) => h.slackUserId.trim() !== "" && h.name.trim() !== ""
  );
  if (mentionable.length > 0) {
    lines.push("");
    lines.push(
      "Team roster with Slack mention tokens (use <@USER_ID> at every reference to these people by name, except when the reference is to yourself — the sender — where you must use first-person instead):"
    );
    for (const p of mentionable) {
      const uid = p.slackUserId.trim().toUpperCase();
      const selfMarker = uid === senderUid ? " — this is YOU; never mention" : "";
      lines.push(`- ${p.name}: <@${uid}>${selfMarker}`);
    }
  }

  return lines.join("\n");
}

export function calendarDaysDiffUtc(a: Date, b: Date): number {
  const t = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const u = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((t - u) / 86400000);
}

export function slackTsToDate(ts: string): Date {
  const n = parseFloat(ts);
  return new Date(Number.isFinite(n) ? n * 1000 : 0);
}

export function parseMilestoneTargetDate(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;
  const ymd = parseCalendarDateString(t);
  if (ymd) return ymd;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
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
