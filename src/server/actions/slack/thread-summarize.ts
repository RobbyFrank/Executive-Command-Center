"use server";

import {
  fetchSlackThreadReplies,
  parseSlackThreadUrl,
  slackUserTokenForThreads,
} from "@/lib/slack";
import {
  collectSlackUserIdsFromMessageText,
  slackMessageTextForDisplay,
} from "@/lib/slackDisplay";
import {
  buildSlackUserDisplayMaps,
  claudePlainText,
  rosterMapFromHints,
  sortMessagesByTs,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";

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
