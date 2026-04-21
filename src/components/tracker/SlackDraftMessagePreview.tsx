"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Person } from "@/lib/types/tracker";
import { displayInitials } from "@/lib/displayInitials";
import {
  collectSlackUserIdsFromMessageText,
  expandSlackEmojiShortcodes,
  slackInlineMrkdwnForPreviewPlain,
} from "@/lib/slackDisplay";
import {
  resolveSlackMentionPreviewDisplays,
  type SlackMemberRosterHint,
  type SlackMentionPreviewDisplay,
} from "@/server/actions/slack";
import { cn } from "@/lib/utils";

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

function resolveMentionDisplay(
  slackUserId: string,
  embedded: string | undefined,
  localById: Map<string, { name: string; avatarSrc: string | null }>,
  remoteById: Record<string, SlackMentionPreviewDisplay>
): { name: string; avatarSrc: string | null } {
  const emb = embedded?.trim();
  const loc = localById.get(slackUserId);
  const rem = remoteById[slackUserId];
  const name = emb || loc?.name || rem?.name || slackUserId;
  const avatarSrc = loc?.avatarSrc ?? rem?.avatarSrc ?? null;
  return { name, avatarSrc };
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

/**
 * Slack dark-theme user mention with optional avatar — same palette as `SlackThreadPopover`
 * (`.c-mrkdwn__mention`-style blue wash + `#1d9bd1` label).
 */
function SlackStyleUserMention({
  displayName,
  avatarSrc,
  compact,
}: {
  displayName: string;
  avatarSrc?: string | null;
  compact?: boolean;
}) {
  const label = displayName.replace(/^@+/, "").trim() || "?";
  const photo = avatarSrc?.trim();
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-[3px] bg-[rgba(29,155,209,0.16)] py-px pl-0.5 pr-[6px] align-baseline leading-snug",
        compact ? "text-[12px]" : "text-[16px]"
      )}
      title={`@${label}`}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className={cn(
            "shrink-0 rounded-[2px] object-cover",
            compact ? "h-3 w-3" : "h-4 w-4"
          )}
        />
      ) : (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-[2px] bg-[rgba(29,155,209,0.22)] font-bold leading-none text-[#1d9bd1]",
            compact
              ? "h-3 w-3 text-[7px]"
              : "h-4 w-4 text-[9px]"
          )}
          aria-hidden
        >
          {displayInitials(label)}
        </span>
      )}
      <span className="min-w-0 font-semibold text-[#1d9bd1]">
        @{label}
      </span>
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
        className="font-semibold text-[#f8f8f8]"
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

function renderMrkdwnFragment(
  raw: string,
  keyBase: string,
  compact?: boolean
): ReactNode[] {
  if (!raw) return [];
  const out: ReactNode[] = [];
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  const codeCls = compact
    ? "mx-0.5 inline rounded-[3px] bg-[#1b1d21] px-1 py-px font-mono text-[11px] font-normal leading-snug text-[#e8912d] ring-1 ring-white/10"
    : "mx-0.5 inline rounded-[3px] bg-[#1b1d21] px-1 py-px font-mono text-[13px] font-normal leading-snug text-[#e8912d] ring-1 ring-white/10";
  while ((m = codeRe.exec(raw)) !== null) {
    if (m.index > last) {
      const plain = slackInlineMrkdwnForPreviewPlain(raw.slice(last, m.index));
      out.push(...renderBoldPlain(plain, `${keyBase}-bp-${idx++}`));
    }
    out.push(
      <code key={`${keyBase}-c-${idx++}`} className={codeCls}>
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
  rosterHints = [],
  posterDisplayName,
  posterAvatarSrc,
  postedAt,
  className,
  compact,
}: {
  text: string;
  people: Person[];
  /** Same roster hints as thread AI (Slack user id + name + optional photo path). */
  rosterHints?: SlackMemberRosterHint[];
  /** Name shown in the Slack-style header (token / roster user). */
  posterDisplayName: string;
  /** Local public path or https Slack avatar URL */
  posterAvatarSrc: string | null;
  postedAt: Date;
  className?: string;
  /** Smaller typography (e.g. Slack scrape evidence cards). */
  compact?: boolean;
}) {
  const localById = useMemo(
    () => buildLocalRosterDisplayMap(people, rosterHints),
    [people, rosterHints]
  );

  const mentionIds = useMemo(
    () => [...new Set(collectSlackUserIdsFromMessageText(text))],
    [text]
  );

  const rosterHintsSerialized = useMemo(
    () => JSON.stringify(rosterHints),
    [rosterHints]
  );

  const [remoteDisplays, setRemoteDisplays] = useState<
    Record<string, SlackMentionPreviewDisplay>
  >({});

  useEffect(() => {
    if (mentionIds.length === 0) {
      setRemoteDisplays({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await resolveSlackMentionPreviewDisplays(
        mentionIds,
        rosterHints
      );
      if (!cancelled) setRemoteDisplays(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionIds, rosterHintsSerialized]);

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
            {renderMrkdwnFragment(chunk, `f-${m.index}-${k}`, compact)}
          </Fragment>
        );
      }
      const id = m[1].toUpperCase();
      const embedded = m[2]?.trim();
      const nodeKey = `m-${m.index}-${id}`;
      const disp = resolveMentionDisplay(
        id,
        embedded,
        localById,
        remoteDisplays
      );
      out.push(
        <SlackStyleUserMention
          key={nodeKey}
          displayName={disp.name}
          avatarSrc={disp.avatarSrc}
          compact={compact}
        />
      );
      last = re.lastIndex;
    }
    if (last < text.length) {
      out.push(
        <Fragment key={`frag-${k++}`}>
          {renderMrkdwnFragment(text.slice(last), `tail-${k}`, compact)}
        </Fragment>
      );
    }
    return out;
  }, [text, localById, remoteDisplays, compact]);

  const empty = text.trim() === "";
  const timeLabel = formatSlackStyleTimestamp(postedAt);
  const showPhoto = Boolean(posterAvatarSrc?.trim());

  return (
    <div
      className={cn(
        "slack-draft-preview rounded-md border border-[#35373b] bg-[#1a1d21] font-sans leading-[1.5] text-[#f8f8f8]",
        compact
          ? "px-2.5 py-2 text-[12px] leading-relaxed"
          : "px-3 py-2.5 text-[16px]",
        className
      )}
    >
      {empty ? (
        <span className="text-[#9a9b9d]">Nothing to preview yet.</span>
      ) : (
        <div className={cn("flex", compact ? "gap-2" : "gap-2.5")}>
          <div className="shrink-0 pt-0.5">
            {showPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterAvatarSrc!}
                alt=""
                className={cn(
                  "rounded-[3px] object-cover",
                  compact ? "h-7 w-7" : "h-9 w-9"
                )}
              />
            ) : (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-[3px] bg-[#363636] font-bold text-[#e0e0e0]",
                  compact
                    ? "h-7 w-7 text-[9px]"
                    : "h-9 w-9 text-[11px]"
                )}
                aria-hidden
              >
                {displayInitials(posterDisplayName)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={cn(
                  "font-bold leading-tight text-[#f8f8f8]",
                  compact ? "text-[12px]" : "text-[16px]"
                )}
              >
                {posterDisplayName}
              </span>
              <span
                className={cn(
                  "font-normal leading-none text-[#ababab]",
                  compact ? "text-[10px]" : "text-[12px]"
                )}
              >
                {timeLabel}
              </span>
            </div>
            <div
              className={cn(
                "mt-0.5 min-w-0 whitespace-pre-wrap break-words [word-break:break-word] text-[#f8f8f8]",
                compact ? "text-[12px] leading-relaxed" : "text-[16px] leading-[1.5]"
              )}
            >
              {nodes}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
