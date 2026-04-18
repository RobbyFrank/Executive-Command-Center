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
  formatShortRelative,
  rosterMapFromHints,
  sortMessagesByTs,
  THREAD_STALE_MS,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";

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
