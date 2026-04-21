"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Person } from "@/lib/types/tracker";
import { displayInitials } from "@/lib/displayInitials";
import { collectSlackUserIdsFromMessageText } from "@/lib/slackDisplay";
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

function InlineMentionChip({
  name,
  avatarSrc,
}: {
  name: string;
  avatarSrc?: string | null;
}) {
  const label = name.replace(/^@+/, "").trim() || "?";
  const photo = avatarSrc?.trim();
  return (
    <span
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded bg-sky-500/10 px-1 align-baseline text-sky-300"
      title={`@${label}`}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className="h-3.5 w-3.5 shrink-0 rounded-full object-cover ring-1 ring-sky-400/30"
        />
      ) : (
        <span
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[8px] font-bold leading-none text-sky-300"
          aria-hidden
        >
          {displayInitials(label)}
        </span>
      )}
      <span className="min-w-0 font-semibold not-italic">@{label}</span>
    </span>
  );
}

/**
 * Renders plain Slack-flavored text and replaces `<@U...>` tokens with
 * an inline avatar + @name chip. Intentionally minimal — no markdown or
 * channel-link parsing — so it plugs into existing layouts (e.g. evidence
 * quote cards) without changing their typography.
 */
export function SlackMentionInlineText({
  text,
  people,
  rosterHints,
  className,
}: {
  text: string;
  people: Person[];
  rosterHints?: SlackMemberRosterHint[];
  className?: string;
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
    const re = /<@(U[A-Z0-9]+)(?:\|([^>]*))?>/gi;
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        out.push(
          <Fragment key={`frag-${k++}`}>{text.slice(last, m.index)}</Fragment>
        );
      }
      const id = m[1].toUpperCase();
      const embedded = m[2]?.trim();
      const loc = localById.get(id);
      const rem = remoteDisplays[id];
      const name = embedded || loc?.name || rem?.name || id;
      const avatarSrc = loc?.avatarSrc ?? rem?.avatarSrc ?? null;
      out.push(
        <InlineMentionChip
          key={`m-${m.index}-${id}`}
          name={name}
          avatarSrc={avatarSrc}
        />
      );
      last = re.lastIndex;
    }
    if (last < text.length) {
      out.push(<Fragment key={`frag-${k++}`}>{text.slice(last)}</Fragment>);
    }
    return out;
  }, [text, localById, remoteDisplays]);

  return <span className={cn(className)}>{nodes}</span>;
}
