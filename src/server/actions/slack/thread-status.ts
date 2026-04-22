"use server";

import {
  fetchSlackThreadReplies,
  parseSlackThreadUrl,
  slackUserTokenForThreads,
} from "@/lib/slack";
import {
  collectSlackUserIdsFromMessageText,
  slackMessageTextForDisplay,
  truncateSlackTextAvoidSplitMentions,
} from "@/lib/slackDisplay";
import {
  buildSlackUserDisplayMaps,
  formatShortRelative,
  rosterMapFromHints,
  sortMessagesByTs,
  THREAD_STALE_MS,
  type SlackMemberRosterHint,
} from "./thread-ai-shared";

/**
 * One emoji reaction on a preview message. `name` is the Slack shortname (no
 * colons, e.g. `thumbsup`). Rendered as a small pill below the message text
 * in the thread popover.
 */
export type SlackThreadPreviewReaction = {
  name: string;
  count: number;
};

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
        /**
         * Server-resolved plain text with mentions / channels / URLs flattened
         * to `@Name` / `#channel` / raw URL. Used as a fallback for cached
         * payloads created before `textRaw` existed; prefer `textRaw` on the
         * client so inline mention chips can render.
         */
        text: string;
        /**
         * Raw Slack message text (still contains `<@U…>`, `<#C…>`, `<http…>`,
         * `<!channel>` tokens + `&gt;` / `&amp;` entities). Rendered client-side
         * by `SlackMentionInlineText` so mentions become inline chips with
         * avatars rather than flat `@Name` text. Truncated to a safe length
         * without cutting angle-bracket tokens mid-way.
         */
        textRaw?: string;
        /** When present, per-message time (older cached payloads may omit). */
        postedRelative?: string;
        slackUserId?: string;
        avatarSrc?: string | null;
        /** Slack message ts (`1700000000.012345`) — used by callers to match the focused message. */
        ts?: string;
        /** Emoji reactions; only set when the message has at least one. */
        reactions?: SlackThreadPreviewReaction[];
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
  /**
   * Last 5 messages — plus the **thread root** prepended when it falls outside
   * that window. Callers (Followups) rely on being able to locate the ask they
   * opened the preview from; the ask is usually the root, so including it here
   * lets the UI highlight it even when the thread has many replies.
   */
  const tailFive = sorted.slice(-5);
  const parent = sorted[0];
  const lastPreviewMessages =
    parent && !tailFive.some((m) => m.ts === parent.ts)
      ? [parent, ...tailFive]
      : tailFive;
  const mentionIds = new Set<string>();
  for (const m of lastPreviewMessages) {
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

  const recentMessages = lastPreviewMessages.map((m) => {
    const uid = m.user?.trim().toUpperCase();
    const label =
      uid != null
        ? (labelMap.get(uid) ?? rosterById.get(uid)?.name ?? uid)
        : "App";
    const avatar =
      uid != null ? (avatarById.get(uid) ?? null) : null;
    const postedAt = new Date(parseFloat(m.ts) * 1000);
    const reactions =
      m.reactions && m.reactions.length > 0
        ? m.reactions.map((r) => ({ name: r.name, count: r.count }))
        : undefined;
    const raw = m.text ?? "";
    return {
      userLabel: label,
      slackUserId: uid,
      avatarSrc: avatar,
      postedRelative: formatShortRelative(postedAt),
      // Flattened preview text — kept for back-compat (old cached popovers use this).
      text: slackMessageTextForDisplay(raw, 500, labelMap),
      // Raw Slack text so the client can render mention chips, channel links,
      // broadcasts, and HTML-entity-escaped content via SlackMentionInlineText.
      // Truncated safely so no angle-bracket token is split.
      textRaw: truncateSlackTextAvoidSplitMentions(raw, 500),
      ts: m.ts,
      reactions,
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
