"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, MessagesSquare, X } from "lucide-react";
import { displayInitials } from "@/lib/displayInitials";
import {
  readSlackThreadStatusCache,
  writeSlackThreadStatusCache,
  type SlackThreadStatusOk,
} from "@/lib/slackThreadStatusCache";
import {
  fetchSlackThreadStatus,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import type { Person } from "@/lib/types/tracker";
import { SlackMentionInlineText } from "@/components/tracker/SlackMentionInlineText";
import { SlackReactionsRow } from "./SlackReactionsRow";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Slack permalink for the ask message (we fetch the thread replies from this URL). */
  slackUrl: string;
  rosterHints?: SlackMemberRosterHint[];
  /** Team roster — improves `@mention` chips in thread snippets. */
  people?: Person[];
  /**
   * Slack ts (`1700000000.012345`) of the ask shown in the row. When it matches a
   * message in the thread preview, that row is highlighted and scrolled into view.
   */
  focusTs?: string;
};

/**
 * Lightweight thread-preview popover for Followups rows. Shows the **last 5**
 * thread messages inline (authors, avatars, relative time). Reuses the
 * `fetchSlackThreadStatus` server action + browser cache that the Roadmap
 * milestone popover uses, but the chrome is much simpler.
 */
export function FollowupThreadPopover({
  open,
  onClose,
  anchorRef,
  slackUrl,
  rosterHints,
  people = [],
  focusTs,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [status, setStatus] = useState<SlackThreadStatusOk | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = useMemo(() => {
    if (!slackUrl) return "";
    const sig = (rosterHints ?? [])
      .map((h) => h.slackUserId)
      .sort()
      .join(",");
    return sig ? `${slackUrl}::team:${sig}` : slackUrl;
  }, [slackUrl, rosterHints]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch (or hydrate from cache) when opening.
  useEffect(() => {
    if (!open || !slackUrl) return;
    let cancelled = false;
    const cached = readSlackThreadStatusCache(cacheKey);
    if (cached) {
      setStatus(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setStatus(null);
    setLoading(true);
    setError(null);
    void (async () => {
      const r = await fetchSlackThreadStatus(slackUrl, rosterHints);
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      writeSlackThreadStatusCache(cacheKey, r);
      setStatus(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slackUrl, cacheKey, rosterHints]);

  // Position + close-on-outside + close-on-escape + close-on-scroll.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;

    function recompute() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const panelWidth = Math.min(440, window.innerWidth - 24);
      const margin = 8;
      const gap = 6;
      const idealLeft = rect.right - panelWidth;
      const left = Math.min(
        Math.max(margin, idealLeft),
        window.innerWidth - panelWidth - margin
      );
      const below = rect.bottom + gap;
      const maxBelow = window.innerHeight - below - margin;
      const maxAbove = rect.top - gap - margin;
      let top: number;
      let maxHeight: number;
      if (maxBelow >= 180 || maxBelow >= maxAbove) {
        top = below;
        maxHeight = Math.max(180, Math.min(520, maxBelow));
      } else {
        maxHeight = Math.max(180, Math.min(520, maxAbove));
        top = rect.top - gap - maxHeight;
      }
      setPlacement({ top, left, width: panelWidth, maxHeight });
    }
    recompute();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDocPointer(e: MouseEvent) {
      const panel = panelRef.current;
      const anchorEl = anchorRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (panel && panel.contains(target)) return;
      if (anchorEl && anchorEl.contains(target)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    document.addEventListener("mousedown", onDocPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
      document.removeEventListener("mousedown", onDocPointer);
    };
  }, [open, anchorRef, onClose]);

  const focusTsNorm = useMemo(() => focusTs?.trim() ?? "", [focusTs]);
  const focusedItemRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!open || !focusedItemRef.current) return;
    /**
     * After the popover is placed and messages have rendered, scroll the
     * highlighted row into view inside the panel (not the whole page).
     */
    const id = requestAnimationFrame(() => {
      focusedItemRef.current?.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open, status]);

  if (!mounted || !open || !placement) return null;

  const messages = status?.recentMessages ?? [];

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Slack thread preview"
      className={cn(
        "fixed z-[300] overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900/98 shadow-2xl shadow-black/60 ring-1 ring-white/5",
        "motion-safe:animate-[unrepliedFade_0.18s_ease-out_both] motion-reduce:animate-none"
      )}
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
          <MessagesSquare
            className="h-3.5 w-3.5 text-violet-300/90"
            aria-hidden
          />
          <span>Thread preview</span>
          {status ? (
            <span className="text-[10px] font-normal tabular-nums text-zinc-500">
              · {status.replyCount} msg
              {status.replyCount === 1 ? "" : "s"}
              {status.lastReplyRelative
                ? ` · ${status.lastReplyRelative}`
                : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={slackUrl}
            target="_blank"
            rel="noreferrer"
            title="Open in Slack"
            aria-label="Open in Slack"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div
        className="overflow-y-auto px-3 py-2"
        style={{ maxHeight: placement.maxHeight - 40 }}
      >
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>Loading thread…</span>
          </div>
        ) : error ? (
          <p className="rounded border border-red-500/30 bg-red-950/30 px-2.5 py-2 text-[11px] text-red-200/95">
            {error}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-500">
            No replies yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {messages.map((m, i) => {
              const isFocused =
                Boolean(focusTsNorm) &&
                Boolean(m.ts) &&
                m.ts?.trim() === focusTsNorm;
              return (
                <li
                  key={`${m.slackUserId ?? m.userLabel}-${i}`}
                  ref={isFocused ? focusedItemRef : undefined}
                  aria-current={isFocused ? "true" : undefined}
                  className={cn(
                    "relative flex gap-2 rounded-md px-2 py-1.5 transition-colors",
                    isFocused
                      ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/40"
                      : undefined
                  )}
                >
                  {isFocused ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-r bg-violet-400"
                    />
                  ) : null}
                  {m.avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.avatarSrc}
                      alt=""
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-[4px] object-cover"
                    />
                  ) : (
                    <div
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-zinc-800 text-[10px] font-bold text-zinc-200"
                      aria-hidden
                    >
                      {displayInitials(m.userLabel)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          "truncate text-[11px] font-semibold",
                          isFocused ? "text-violet-100" : "text-zinc-100"
                        )}
                      >
                        {m.userLabel}
                      </span>
                      {m.postedRelative ? (
                        <span
                          className={cn(
                            "text-[10px]",
                            isFocused ? "text-violet-300/90" : "text-zinc-500"
                          )}
                        >
                          {m.postedRelative}
                        </span>
                      ) : null}
                      {isFocused ? (
                        <span className="rounded-full bg-violet-500/20 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
                          This ask
                        </span>
                      ) : null}
                    </div>
                    {(() => {
                      // Prefer the raw Slack text when available so mentions,
                      // channels, URLs, and broadcasts render as inline chips /
                      // links via SlackMentionInlineText. Old cached payloads
                      // (pre-textRaw) fall back to the server-flattened `text`.
                      const body = (m.textRaw ?? m.text ?? "").trim();
                      if (!body) {
                        return (
                          <p className="mt-0.5 text-[12px] italic text-zinc-500">
                            (empty)
                          </p>
                        );
                      }
                      return (
                        <SlackMentionInlineText
                          text={body}
                          people={people}
                          rosterHints={rosterHints}
                          mentionSize="sm"
                          className={cn(
                            "mt-0.5 block whitespace-pre-wrap break-words text-[12px] leading-snug",
                            isFocused ? "text-violet-50" : "text-zinc-300"
                          )}
                        />
                      );
                    })()}
                    <SlackReactionsRow
                      reactions={m.reactions}
                      size="xs"
                      className="mt-1"
                      title="Reactions"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
