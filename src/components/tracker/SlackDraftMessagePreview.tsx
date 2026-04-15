"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import type { Person } from "@/lib/types/tracker";
import { displayInitials } from "@/lib/displayInitials";
import {
  expandSlackEmojiShortcodes,
  slackInlineMrkdwnForPreviewPlain,
} from "@/lib/slackDisplay";
import { cn } from "@/lib/utils";

function buildSlackIdMap(people: Person[]): Map<string, Person> {
  const m = new Map<string, Person>();
  for (const p of people) {
    const id = p.slackHandle?.trim().toUpperCase();
    if (id) m.set(id, p);
  }
  return m;
}

function formatSlackStyleTimestamp(d: Date): string {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfD = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff =
    (startOfToday.getTime() - startOfD.getTime()) / 86400000;
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (dayDiff === 0) return `Today at ${timeStr}`;
  if (dayDiff === 1) return `Yesterday at ${timeStr}`;
  return (
    d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }) + ` at ${timeStr}`
  );
}

/** Slack dark-theme @mention (desktop): navy pill + bright blue text */
function SlackStyleUserMention({ displayName }: { displayName: string }) {
  const label = displayName.replace(/^@+/, "").trim() || "?";
  return (
    <span
      className="mx-0.5 inline-block max-w-full rounded-[3px] bg-[#1d364a] px-[5px] py-px align-baseline text-[13px] font-semibold leading-snug text-[#1294dd]"
      title={`@${label}`}
    >
      @{label}
    </span>
  );
}

function renderBoldPlain(processed: string, keyBase: string): ReactNode[] {
  const re = /\*([^*]+)\*/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(processed)) !== null) {
    if (m.index > last) {
      out.push(
        <span key={`${keyBase}-t-${i++}`}>{processed.slice(last, m.index)}</span>
      );
    }
    out.push(
      <strong
        key={`${keyBase}-b-${i++}`}
        className="font-semibold text-[#f3f4f4]"
      >
        {m[1]}
      </strong>
    );
    last = re.lastIndex;
  }
  if (last < processed.length) {
    out.push(
      <span key={`${keyBase}-t-${i++}`}>{processed.slice(last)}</span>
    );
  }
  return out.length ? out : [<span key={keyBase}>{processed}</span>];
}

function renderMrkdwnFragment(raw: string, keyBase: string): ReactNode[] {
  if (!raw) return [];
  const out: ReactNode[] = [];
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = codeRe.exec(raw)) !== null) {
    if (m.index > last) {
      const plain = slackInlineMrkdwnForPreviewPlain(raw.slice(last, m.index));
      out.push(...renderBoldPlain(plain, `${keyBase}-bp-${idx++}`));
    }
    out.push(
      <code
        key={`${keyBase}-c-${idx++}`}
        className="mx-0.5 rounded border border-[#c87f2a]/40 bg-[#35373b] px-[3px] py-px font-mono text-[12.5px] font-normal leading-snug text-[#e8912d]"
      >
        {expandSlackEmojiShortcodes(m[1])}
      </code>
    );
    last = codeRe.lastIndex;
  }
  if (last < raw.length) {
    const plain = slackInlineMrkdwnForPreviewPlain(raw.slice(last));
    out.push(...renderBoldPlain(plain, `${keyBase}-bp-${idx++}`));
  }
  return out.length ? out : renderBoldPlain(slackInlineMrkdwnForPreviewPlain(raw), keyBase);
}

export function SlackDraftMessagePreview({
  text,
  people,
  posterDisplayName,
  posterAvatarSrc,
  postedAt,
  className,
}: {
  text: string;
  people: Person[];
  /** Name shown in the Slack-style header (token / roster user). */
  posterDisplayName: string;
  /** Local public path or https Slack avatar URL */
  posterAvatarSrc: string | null;
  postedAt: Date;
  className?: string;
}) {
  const bySlackId = useMemo(() => buildSlackIdMap(people), [people]);

  const nodes = useMemo(() => {
    const re = /<@(U[A-Z0-9]+)(?:\|([^>]*))?>/gi;
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        const chunk = text.slice(last, m.index);
        out.push(
          <Fragment key={`frag-${k++}`}>
            {renderMrkdwnFragment(chunk, `f-${m.index}-${k}`)}
          </Fragment>
        );
      }
      const id = m[1].toUpperCase();
      const embedded = m[2]?.trim();
      const person = bySlackId.get(id);
      const nodeKey = `m-${m.index}-${id}`;
      if (person) {
        out.push(
          <SlackStyleUserMention key={nodeKey} displayName={person.name} />
        );
      } else if (embedded) {
        out.push(
          <SlackStyleUserMention key={nodeKey} displayName={embedded} />
        );
      } else {
        out.push(
          <SlackStyleUserMention key={nodeKey} displayName={id} />
        );
      }
      last = re.lastIndex;
    }
    if (last < text.length) {
      out.push(
        <Fragment key={`frag-${k++}`}>
          {renderMrkdwnFragment(text.slice(last), `tail-${k}`)}
        </Fragment>
      );
    }
    return out;
  }, [text, bySlackId]);

  const empty = text.trim() === "";
  const timeLabel = formatSlackStyleTimestamp(postedAt);
  const showPhoto = Boolean(posterAvatarSrc?.trim());

  return (
    <div
      className={cn(
        "slack-draft-preview rounded-md border border-[#35373b] bg-[#1a1d21] px-3 py-2 font-sans text-[15px] leading-[1.466] text-[#d1d2d3] shadow-inner shadow-black/20",
        className
      )}
    >
      {empty ? (
        <span className="text-[#9a9b9d]">Nothing to preview yet.</span>
      ) : (
        <div className="flex gap-2.5">
          <div className="shrink-0 pt-0.5">
            {showPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterAvatarSrc!}
                alt=""
                className="h-9 w-9 rounded-[3px] object-cover ring-1 ring-black/30"
              />
            ) : (
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-[#3f4147] text-[11px] font-bold text-[#e8e8e8] ring-1 ring-black/30"
                aria-hidden
              >
                {displayInitials(posterDisplayName)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-bold text-[#f3f4f4]">
                {posterDisplayName}
              </span>
              <span className="text-[12px] font-normal leading-none text-[#ababad]">
                {timeLabel}
              </span>
            </div>
            <div className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-[15px] leading-[1.466] text-[#d1d2d3]">
              {nodes}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
