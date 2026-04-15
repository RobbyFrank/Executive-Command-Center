"use client";

import { forwardRef } from "react";
import type { SlackThreadStatusOk } from "@/lib/slackThreadStatusCache";
import { displayInitials } from "@/lib/displayInitials";
import { cn } from "@/lib/utils";

const BODY_PREVIEW_MAX_CHARS = 200;
const BODY_PREVIEW_MAX_CHARS_COMPACT = 110;

function truncateBody(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

export interface MilestoneSlackThreadInlineProps {
  status: SlackThreadStatusOk | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  /** Tighter type and shorter preview (e.g. project row next-milestone strip). */
  compact?: boolean;
}

/**
 * Compact thread preview next to the milestone name: status dot, relative time, short snippet.
 * Opens the thread popover (anchor ref) on click.
 */
export const MilestoneSlackThreadInline = forwardRef<
  HTMLButtonElement,
  MilestoneSlackThreadInlineProps
>(function MilestoneSlackThreadInline(
  { status, loading, error, onOpen, compact = false },
  ref
) {
  const bodyMax = compact ? BODY_PREVIEW_MAX_CHARS_COMPACT : BODY_PREVIEW_MAX_CHARS;
  const lastMsg = status?.recentMessages?.at(-1);
  const titleParts: string[] = [];
  if (error) titleParts.push(error);
  if (status) {
    if (status.isStale) titleParts.push("No activity in 24h");
    titleParts.push(`Last activity ${status.lastReplyRelative}`);
    if (lastMsg) {
      titleParts.push(`${lastMsg.userLabel}: ${lastMsg.text || "(empty)"}`);
    } else if (status.snippet.trim()) {
      titleParts.push(status.snippet);
    }
  }
  const title = titleParts.join(" · ") || "Slack thread";

  const showAuthorRow =
    !loading &&
    !error &&
    status &&
    lastMsg &&
    (lastMsg.userLabel || lastMsg.text);

  const fallbackSnippet =
    !loading && !error && status?.snippet.trim() && !showAuthorRow;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={cn(
        "group/inline flex min-w-0 w-full max-w-full items-center justify-start rounded-md py-0.5 pl-0 pr-1 text-left transition-colors",
        compact ? "min-h-6 gap-1" : "min-h-7 gap-1.5",
        "hover:bg-zinc-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
      )}
      title={title}
    >
      {loading ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-500/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-500" />
        </span>
      ) : error ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-600 ring-1 ring-zinc-500/40" />
      ) : status?.isStale ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-amber-500/40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]" />
      )}
      <span
        className={cn(
          "shrink-0 font-medium tabular-nums",
          compact ? "text-[10px]" : "text-[11px]",
          error
            ? "text-zinc-500"
            : status?.isStale
              ? "text-amber-200/90"
              : "text-zinc-400"
        )}
      >
        {loading ? "…" : error ? "Thread error" : status?.lastReplyRelative ?? "—"}
      </span>
      {compact &&
      status &&
      !loading &&
      !error &&
      status.replyCount > 0 ? (
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
          {" · "}
          {status.replyCount} msg{status.replyCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {showAuthorRow ? (
        <>
          <span
            className={cn("shrink-0 text-zinc-600", compact ? "text-[10px]" : "text-[11px]")}
            aria-hidden
          >
            —
          </span>
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center",
              compact ? "gap-1" : "gap-1.5"
            )}
          >
            {lastMsg.avatarSrc ? (
              <img
                src={lastMsg.avatarSrc}
                alt=""
                className={cn(
                  "shrink-0 rounded-full object-cover ring-1 ring-zinc-600/80",
                  compact ? "h-4 w-4" : "h-5 w-5"
                )}
              />
            ) : (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold text-zinc-300 ring-1 ring-zinc-600/80",
                  compact
                    ? "h-4 w-4 text-[8px]"
                    : "h-5 w-5 text-[9px]"
                )}
                aria-hidden
              >
                {displayInitials(lastMsg.userLabel)}
              </span>
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate leading-snug",
                compact ? "text-[10px]" : "text-[11px]"
              )}
            >
              <span className="font-semibold text-zinc-200">
                {lastMsg.userLabel}
              </span>
              {lastMsg.text?.trim() ? (
                <>
                  <span className="text-zinc-600"> · </span>
                  <span className="font-normal text-zinc-500 group-hover/inline:text-zinc-400">
                    {truncateBody(lastMsg.text, bodyMax)}
                  </span>
                </>
              ) : null}
            </span>
          </span>
        </>
      ) : null}
      {fallbackSnippet ? (
        <>
          <span
            className={cn("shrink-0 text-zinc-600", compact ? "text-[10px]" : "text-[11px]")}
            aria-hidden
          >
            —
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate leading-snug text-zinc-500 group-hover/inline:text-zinc-400",
              compact ? "text-[10px]" : "text-[11px]"
            )}
          >
            {status?.snippet ?? ""}
          </span>
        </>
      ) : null}
    </button>
  );
});
