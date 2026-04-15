"use client";

import { useEffect, useId, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Sparkles } from "lucide-react";
import {
  summarizeSlackThread,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import type { SlackThreadStatusOk } from "@/lib/slackThreadStatusCache";
import { displayInitials } from "@/lib/displayInitials";

interface SlackThreadPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  slackUrl: string;
  milestoneName: string;
  /** Latest status; refetched when popover opens */
  status: SlackThreadStatusOk | null;
  rosterHints?: SlackMemberRosterHint[];
  onRefreshStatus: () => void;
  onOpenPing: () => void;
}

export function SlackThreadPopover({
  open,
  onClose,
  anchorRef,
  slackUrl,
  milestoneName,
  status,
  rosterHints = [],
  onRefreshStatus,
  onOpenPing,
}: SlackThreadPopoverProps) {
  const popoverId = useId();
  const [placement, setPlacement] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const el = anchorRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    setPlacement({
      top: rect.bottom + 4,
      right: Math.max(4, window.innerWidth - rect.right),
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) {
      setSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }
    onRefreshStatus();
  }, [open, onRefreshStatus]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => {
      const el = anchorRef.current;
      if (!el || typeof window === "undefined") return;
      const rect = el.getBoundingClientRect();
      setPlacement({
        top: rect.bottom + 4,
        right: Math.max(4, window.innerWidth - rect.right),
      });
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, anchorRef]);

  const runSummarize = async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    const r = await summarizeSlackThread(slackUrl, rosterHints);
    setSummaryLoading(false);
    if (!r.ok) {
      setSummaryError(r.error);
      return;
    }
    setSummary(r.summary);
  };

  const portal =
    open &&
    placement &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[200]"
          aria-hidden
          onClick={() => onClose()}
        />
        <div
          id={popoverId}
          role="dialog"
          aria-label="Slack thread"
          className="fixed z-[210] w-[min(22rem,calc(100vw-1.5rem))] max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-3.5 shadow-xl shadow-black/40"
          style={{ top: placement.top, right: placement.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1 text-sm font-semibold tracking-tight text-zinc-100">
            Slack thread
          </p>
          <p className="mb-3 text-[11px] text-zinc-500">
            {milestoneName}
            {status ? (
              <>
                {" "}
                · {status.replyCount} message
                {status.replyCount === 1 ? "" : "s"} · Last activity{" "}
                {status.lastReplyRelative}
                {status.isStale ? (
                  <span className="text-amber-400/95"> · Quiet 24h+</span>
                ) : null}
              </>
            ) : null}
          </p>

          {status && status.recentMessages.length > 0 ? (
            <div className="mb-3 space-y-2 border-b border-zinc-800/90 pb-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Recent
              </p>
              {status.recentMessages.map((m, i) => (
                <div
                  key={`${m.slackUserId ?? m.userLabel}-${i}`}
                  className="flex gap-2 rounded-md bg-zinc-950/60 px-2 py-1.5"
                >
                  {m.avatarSrc ? (
                    <img
                      src={m.avatarSrc}
                      alt=""
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/80"
                    />
                  ) : (
                    <div
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-300 ring-1 ring-zinc-700/80"
                      aria-hidden
                    >
                      {displayInitials(m.userLabel)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-[11px] leading-snug">
                    <p className="font-medium text-zinc-300">{m.userLabel}</p>
                    <p className="whitespace-pre-wrap break-words text-zinc-400">
                      {m.text || (
                        <span className="italic text-zinc-600">(empty)</span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {summary ? (
            <div className="mb-3 rounded-md border border-violet-500/25 bg-violet-950/25 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-200">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300/90">
                <Sparkles className="h-3 w-3" aria-hidden />
                Summary
              </p>
              <p className="whitespace-pre-wrap">{summary}</p>
            </div>
          ) : null}
          {summaryError ? (
            <p className="mb-2 text-[11px] text-red-400/90">{summaryError}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={summaryLoading}
              onClick={() => void runSummarize()}
              className="rounded-md border border-zinc-600 bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {summaryLoading ? "Summarizing…" : "Summarize thread"}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPing();
              }}
              className="rounded-md border border-violet-600/50 bg-violet-950/40 px-2.5 py-1 text-[11px] font-medium text-violet-100 hover:bg-violet-900/50"
            >
              Ping thread…
            </button>
            <a
              href={slackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Open in Slack
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
      </>,
      document.body
    );

  return <>{portal}</>;
}
