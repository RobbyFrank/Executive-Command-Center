"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Person } from "@/lib/types/tracker";
import { displayInitials } from "@/lib/displayInitials";
import {
  collectSlackUserIdsFromMessageText,
  decodeSlackHtmlEntities,
} from "@/lib/slackDisplay";
import {
  resolveSlackMentionPreviewDisplays,
  type SlackMemberRosterHint,
  type SlackMentionPreviewDisplay,
} from "@/server/actions/slack";
import { cn } from "@/lib/utils";

const EMPTY_ROSTER_HINTS: SlackMemberRosterHint[] = [];

function buildLocalRosterDisplayMap(
  people: Person[],
  rosterHints: SlackMemberRosterHint[]
): Map<string, { name: string; avatarSrc: string | null }> {
  const m = new Map<string, { name: string; avatarSrc: string | null }>();
  for (const p of people) {
    const id = p.slackHandle?.trim().toUpperCase();
    if (!id) continue;
    m.set(id, {
      name: p.name,
      avatarSrc: p.profilePicturePath?.trim() || null,
    });
  }
  for (const h of rosterHints) {
    const id = h.slackUserId.trim().toUpperCase();
    if (!id) continue;
    if (m.has(id)) continue;
    m.set(id, {
      name: h.name,
      avatarSrc: h.profilePicturePath?.trim() || null,
    });
  }
  return m;
}

export type SlackMentionInlineSize = "sm" | "md";

/**
 * When `"hide"`, mention chips render as a text-only `@Name` pill (no avatar /
 * initials square). Use on surfaces where the mentioned person's avatar is
 * already visible nearby (e.g. the Followups row, where the group header
 * already shows the assignee's photo) so the UI doesn't double up on the same
 * avatar. Default `"show"` keeps the existing avatar-leading chip.
 */
export type SlackMentionAvatarMode = "show" | "hide";

function InlineMentionChip({
  name,
  avatarSrc,
  size = "md",
  avatarMode = "show",
}: {
  name: string;
  avatarSrc?: string | null;
  size?: SlackMentionInlineSize;
  avatarMode?: SlackMentionAvatarMode;
}) {
  const label = name.replace(/^@+/, "").trim() || "?";
  const photo = avatarSrc?.trim();
  const compact = size === "sm";
  const showAvatar = avatarMode === "show";
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex max-w-full items-center rounded bg-sky-500/10 align-baseline text-sky-300",
        compact
          ? showAvatar
            ? "gap-0.5 px-1 py-0 leading-none"
            : "px-1 py-0 leading-none"
          : showAvatar
            ? "gap-1 px-1"
            : "px-1.5"
      )}
      title={`@${label}`}
    >
      {showAvatar ? (
        photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className={cn(
              "shrink-0 rounded-full object-cover ring-1 ring-sky-400/30",
              compact ? "h-3 w-3" : "h-3.5 w-3.5"
            )}
          />
        ) : (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-sky-500/20 font-bold leading-none text-sky-300",
              compact ? "h-3 w-3 text-[7px]" : "h-3.5 w-3.5 text-[8px]"
            )}
            aria-hidden
          >
            {displayInitials(label)}
          </span>
        )
      ) : null}
      <span className="min-w-0 font-semibold not-italic">@{label}</span>
    </span>
  );
}

/**
 * Renders Slack-flavored text: `<@U…>` / links / channels as rich inline nodes,
 * and Slack-style bold (`*like this*`) as `<strong>`. Intentionally minimal
 * (no full markdown).
 */
export function SlackMentionInlineText({
  text,
  people,
  rosterHints,
  className,
  mentionSize = "md",
  mentionAvatar = "show",
}: {
  text: string;
  people: Person[];
  rosterHints?: SlackMemberRosterHint[];
  className?: string;
  /** Chip size for `@mentions`. `sm` pairs well with small preview text. */
  mentionSize?: SlackMentionInlineSize;
  /**
   * `"show"` (default) renders `<@U…>` chips with an avatar + name.
   * `"hide"` drops the avatar so the chip is just a compact `@Name` pill —
   * use on surfaces where the mentioned person's photo is already visible
   * nearby (e.g. the Followups group header) to avoid doubling up.
   */
  mentionAvatar?: SlackMentionAvatarMode;
}) {
  const hints = rosterHints?.length ? rosterHints : EMPTY_ROSTER_HINTS;

  const localById = useMemo(
    () => buildLocalRosterDisplayMap(people, hints),
    [people, hints]
  );

  const mentionIds = useMemo(
    () => [...new Set(collectSlackUserIdsFromMessageText(text))],
    [text]
  );

  const [remoteDisplays, setRemoteDisplays] = useState<
    Record<string, SlackMentionPreviewDisplay>
  >({});

  useEffect(() => {
    if (mentionIds.length === 0) {
      setRemoteDisplays({});
      return;
    }
    const unresolved = mentionIds.filter((id) => !localById.has(id));
    if (unresolved.length === 0) {
      setRemoteDisplays({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await resolveSlackMentionPreviewDisplays(unresolved, hints);
      if (!cancelled) setRemoteDisplays(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionIds, localById, hints]);

  const nodes = useMemo(() => {
    /**
     * Single pass over Slack angle-bracket constructs. Alternatives in order:
     *   1. `<@USERID>` / `<@USERID|Label>`  — user mention
     *   2. `<#CHANNELID>` / `<#CHANNELID|name>` — channel link
     *   3. `<url>` / `<url|label>` — auto-link or named link
     *   4. `<!channel>` / `<!here>` / `<!everyone>` — broadcast
     * Everything else between matches is rendered as plain text, with
     * `!channel` / `!here` / `!everyone` bare tokens normalized to `@…`.
     */
    const re =
      /<@(U[A-Z0-9]+)(?:\|([^>]*))?>|<#([CGD][A-Z0-9]+)(?:\|([^>]*))?>|<((?:https?|mailto):[^|>]+)(?:\|([^>]*))?>|<!(channel|here|everyone|subteam\^[A-Z0-9]+(?:\|[^>]+)?)>/gi;
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;

    /**
     * Slack mrkdwn: `*bold*` (single asterisks, no newlines inside).
     * Runs over a single line or line-segment after entity decode + broadcast normalization.
     */
    function renderBoldSegment(line: string, keyBase: string): ReactNode[] {
      const reBold = /\*([^*\n]+)\*/g;
      const parts: ReactNode[] = [];
      let last = 0;
      let bm: RegExpExecArray | null;
      let bi = 0;
      while ((bm = reBold.exec(line)) !== null) {
        if (bm.index > last) parts.push(line.slice(last, bm.index));
        parts.push(
          <strong key={`${keyBase}-b-${bi++}`} className="font-semibold">
            {bm[1]}
          </strong>
        );
        last = reBold.lastIndex;
      }
      if (last < line.length) parts.push(line.slice(last));
      return parts.length === 0 ? [line] : parts;
    }

    function pushPlain(chunk: string) {
      if (!chunk) return;
      // Slack sends `&`, `<`, `>` as HTML entities in raw text (spec-required
      // because they're their parsing control characters). Decode here, AFTER
      // the outer angle-bracket regex has already extracted real `<@U…>` /
      // `<#C…>` / `<https…>` constructs from the full text.
      const decoded = decodeSlackHtmlEntities(chunk);
      const normalized = decoded.replace(
        /!(channel|here|everyone)\b/gi,
        "@$1"
      );
      const prefix = `frag-${k++}`;

      // Split by newlines so we can style `> `-prefixed lines as blockquotes
      // (Slack mrkdwn blockquote syntax). Keep the newline characters so that
      // `whitespace-pre-wrap` on the parent still shows the line break between
      // a quote and the paragraph that follows it.
      const lines = normalized.split(/(\n)/);
      const segments: ReactNode[] = [];
      for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        if (raw === "\n") {
          segments.push(<Fragment key={`${prefix}-nl-${li}`}>{"\n"}</Fragment>);
          continue;
        }
        // Slack blockquote: a line starting with `>` (optionally followed by a
        // space). The rest of the line is the quoted content.
        //
        // Skip quote styling when `inner` is empty — that happens when the
        // plain-text chunk is just the `>` prefix and the actual quoted
        // content contains a mention/link/channel that the outer regex
        // peeled off into its own token. Rendering an empty quote `<span>`
        // creates a stray visual indicator with nothing in it; better to
        // just drop the styling on that fragment.
        const quoteMatch = /^>\s?(.*)$/.exec(raw);
        if (quoteMatch && quoteMatch[1]?.trim()) {
          const inner = quoteMatch[1] ?? "";
          segments.push(
            <span
              key={`${prefix}-q-${li}`}
              className="block border-l-2 border-zinc-600/80 pl-2 text-zinc-400 italic"
            >
              {renderBoldSegment(inner, `${prefix}-q-${li}`)}
            </span>
          );
          continue;
        }
        segments.push(
          <Fragment key={`${prefix}-l-${li}`}>
            {renderBoldSegment(raw, `${prefix}-l-${li}`)}
          </Fragment>
        );
      }
      out.push(<Fragment key={prefix}>{segments}</Fragment>);
    }

    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        pushPlain(text.slice(last, m.index));
      }
      last = re.lastIndex;

      // 1. User mention
      if (m[1]) {
        const id = m[1].toUpperCase();
        const embedded = m[2]?.trim();
        const loc = localById.get(id);
        const rem = remoteDisplays[id];
        const name = embedded || loc?.name || rem?.name || id;
        const avatarSrc = loc?.avatarSrc ?? rem?.avatarSrc ?? null;
        out.push(
          <InlineMentionChip
            key={`u-${m.index}-${id}`}
            name={name}
            avatarSrc={avatarSrc}
            size={mentionSize}
            avatarMode={mentionAvatar}
          />
        );
        continue;
      }

      // 2. Channel link
      if (m[3]) {
        const chId = m[3].toUpperCase();
        const embedded = m[4]?.trim();
        const label = embedded ? `#${embedded.replace(/^#+/, "")}` : "#channel";
        out.push(
          <a
            key={`c-${m.index}-${chId}`}
            href={`https://slack.com/app_redirect?channel=${encodeURIComponent(chId)}`}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 hover:underline"
            title={label}
          >
            {label}
          </a>
        );
        continue;
      }

      // 3. URL (plain or labeled)
      if (m[5]) {
        const url = m[5].trim();
        const label = m[6]?.trim() || url;
        out.push(
          <a
            key={`l-${m.index}-${k++}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 hover:underline break-words"
            title={url}
          >
            {label}
          </a>
        );
        continue;
      }

      // 4. Broadcast (@channel / @here / @everyone / @subteam)
      if (m[7]) {
        const raw = m[7];
        // `subteam^SXXXXX|name`
        const subteamMatch = /^subteam\^[A-Z0-9]+(?:\|(.+))?$/i.exec(raw);
        const label = subteamMatch
          ? `@${(subteamMatch[1] ?? "group").replace(/^@+/, "")}`
          : `@${raw}`;
        out.push(
          <span
            key={`b-${m.index}-${k++}`}
            className="font-semibold text-sky-300"
            title={label}
          >
            {label}
          </span>
        );
        continue;
      }
    }
    if (last < text.length) {
      pushPlain(text.slice(last));
    }
    return out;
  }, [text, localById, remoteDisplays, mentionSize, mentionAvatar]);

  return <span className={cn(className)}>{nodes}</span>;
}
