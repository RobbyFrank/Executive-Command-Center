"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Loader2,
  Send,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  generateSlackQuickReply,
  pingSlackThread,
  resolveMpimParticipantLabel,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { markUnrepliedAskNudged } from "@/server/actions/unrepliedAsks";
import type { UnrepliedAskSnapshotRow } from "@/server/actions/unrepliedAsks";
import { invalidateSlackThreadStatusCache } from "@/lib/slackThreadStatusCache";
import { entrySlackMessageDate } from "@/lib/unrepliedAsksFilters";
import { SlackMentionInlineText } from "@/components/tracker/SlackMentionInlineText";
import type { Person } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";

/** Stable empty reference for SlackMentionInlineText when `people` is omitted. */
const EMPTY_PEOPLE: Person[] = [];

/** ~7 lines of `text-sm` + `leading-relaxed` (~1.625 × 0.875rem per line). */
const ORIGINAL_ASK_MAX_SCROLL_HEIGHT = "max-h-[10rem]";

type CardPhase =
  | "drafting"
  | "ready"
  | "posting"
  | "posted"
  | "skipped"
  | "error";

type ReplyCardState = {
  entryId: string;
  slackUrl: string;
  askText: string;
  /** Slack channel id — kept so we can lazy-resolve mpim participant labels. */
  channelId: string;
  /** True when this row's channel is a group DM and the label is the resolved participant list. */
  isMpim: boolean;
  channelLabel: string;
  ageLabel: string;
  assigneeName: string | null;
  phase: CardPhase;
  draft: string;
  /** Preview-first: textarea only after click (same UX as QuickReplyPopover). */
  editing: boolean;
  error: string | null;
};

function formatMessageAgeShort(sentAt: Date, now: Date): string {
  const diffMs = now.getTime() - sentAt.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

function initialChannelLabel(row: UnrepliedAskSnapshotRow): string {
  // For group DMs we'll lazy-resolve participant names on open; until then
  // show a neutral placeholder rather than the raw `mpdm-…` Slack id.
  if (row.entry.channelKind === "mpim") return "Group DM";
  const n = row.entry.channelName?.trim();
  return n ? `#${n.replace(/^#+/, "")}` : "#channel";
}

function buildInitialCards(rows: UnrepliedAskSnapshotRow[]): ReplyCardState[] {
  const now = new Date();
  return rows.map((row) => ({
    entryId: row.entry.id,
    slackUrl: row.entry.permalink,
    askText: row.entry.text,
    channelId: row.entry.channelId,
    isMpim: row.entry.channelKind === "mpim",
    channelLabel: initialChannelLabel(row),
    ageLabel: formatMessageAgeShort(entrySlackMessageDate(row.entry), now),
    assigneeName: row.assigneeName,
    phase: "drafting" as const,
    draft: "",
    editing: false,
    error: null,
  }));
}

type BulkReplyAllDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupLabel: string;
  rows: UnrepliedAskSnapshotRow[];
  rosterHints: SlackMemberRosterHint[] | undefined;
  people: Person[];
  onAnyPosted?: () => void;
};

export function BulkReplyAllDialog({
  open,
  onOpenChange,
  groupLabel,
  rows,
  rosterHints,
  people,
  onAnyPosted,
}: BulkReplyAllDialogProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [cards, setCards] = useState<ReplyCardState[]>(() =>
    buildInitialCards(rows)
  );
  const [postAllConfirmOpen, setPostAllConfirmOpen] = useState(false);
  const [postAllRunning, setPostAllRunning] = useState(false);
  const anyPostedRef = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  // `rosterHints` comes from the parent snapshot and gets a new reference on
  // every `router.refresh()`. We keep the latest in a ref so AI calls pick it
  // up, but we do NOT depend on it in the reset effect — otherwise any parent
  // refresh (e.g. after a single post elsewhere on the page) would wipe the
  // user's in-progress drafts and re-trigger every AI request.
  const rosterHintsRef = useRef(rosterHints);
  rosterHintsRef.current = rosterHints;

  const rowIdsKey = useMemo(
    () => rows.map((r) => r.entry.id).join("|"),
    [rows]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset when dialog opens with a given set of rows. Keyed on `rowIdsKey` so
  // we don't redraft on every parent render; `rows` / `rosterHints` are read
  // fresh through refs.
  useEffect(() => {
    if (!open) return;
    anyPostedRef.current = false;
    setPostAllConfirmOpen(false);
    setPostAllRunning(false);
    const next = buildInitialCards(rows);
    setCards(next);

    const cancelled = { current: false };

    // Draft an AI reply per card in parallel.
    void Promise.all(
      next.map(async (c) => {
        const r = await generateSlackQuickReply(
          c.slackUrl,
          rosterHintsRef.current,
          c.assigneeName ?? undefined
        );
        if (cancelled.current) return;
        setCards((prev) =>
          prev.map((p) => {
            if (p.entryId !== c.entryId) return p;
            if (!r.ok) {
              return {
                ...p,
                phase: "error" as const,
                error: r.error,
                draft: "",
                editing: false,
              };
            }
            return {
              ...p,
              phase: "ready" as const,
              draft: r.message.trim(),
              editing: false,
              error: null,
            };
          })
        );
      })
    );

    // Lazy-resolve group DM participant labels — Slack doesn't give us names
    // for mpims so we swap the "Group DM" placeholder for "Nadav, Ghulam &
    // Robby" once `conversations.members` + the profile resolver come back.
    // Batched by channelId so the same DM doesn't resolve twice per open.
    const mpimChannelIds = [
      ...new Set(next.filter((c) => c.isMpim).map((c) => c.channelId)),
    ];
    for (const channelId of mpimChannelIds) {
      void (async () => {
        const r = await resolveMpimParticipantLabel(
          channelId,
          rosterHintsRef.current
        );
        if (cancelled.current) return;
        if (!r.ok) return; // Keep the "Group DM" fallback silently — not worth a toast.
        setCards((prev) =>
          prev.map((p) =>
            p.channelId === channelId && p.isMpim
              ? { ...p, channelLabel: r.label }
              : p
          )
        );
      })();
    }

    return () => {
      cancelled.current = true;
    };
    // `rows` / `rosterHints` omitted on purpose: `rowIdsKey` captures identity
    // changes; latest values are read from refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowIdsKey]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    if (anyPostedRef.current) {
      onAnyPosted?.();
    }
  }, [onAnyPosted, onOpenChange]);

  const updateCard = useCallback(
    (entryId: string, patch: Partial<ReplyCardState>) => {
      setCards((prev) =>
        prev.map((c) => (c.entryId === entryId ? { ...c, ...patch } : c))
      );
    },
    []
  );

  /** Only one card in raw-edit mode at a time (same mental model as QuickReplyPopover). */
  const setCardEditing = useCallback((entryId: string, editing: boolean) => {
    setCards((prev) =>
      prev.map((p) => {
        if (p.entryId === entryId) return { ...p, editing };
        if (editing && p.editing) return { ...p, editing: false };
        return p;
      })
    );
  }, []);

  const draftTextareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  /** Avoid re-focusing on every keystroke while a draft textarea is open. */
  const lastFocusedEditingEntryIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      lastFocusedEditingEntryIdRef.current = null;
      return;
    }
    const current = cards.find((c) => c.editing && c.phase === "ready");
    const id = current?.entryId ?? null;
    if (!id) {
      lastFocusedEditingEntryIdRef.current = null;
      return;
    }
    if (id === lastFocusedEditingEntryIdRef.current) return;
    lastFocusedEditingEntryIdRef.current = id;
    const el = draftTextareaRefs.current.get(id);
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [open, cards]);

  const postOne = useCallback(
    async (entryId: string) => {
      const card = cardsRef.current.find((c) => c.entryId === entryId);
      if (!card) return;
      const text = card.draft.trim();
      if (!text || card.phase === "posting") return;
      updateCard(entryId, { phase: "posting", editing: false, error: null });
      const r = await pingSlackThread(card.slackUrl, text);
      if (!r.ok) {
        updateCard(entryId, { phase: "ready", error: r.error });
        toast.error(r.error);
        return;
      }
      invalidateSlackThreadStatusCache(card.slackUrl);
      const nudged = await markUnrepliedAskNudged(entryId);
      if (!nudged.ok) {
        toast.error(nudged.error);
        updateCard(entryId, { phase: "ready", error: nudged.error });
        return;
      }
      anyPostedRef.current = true;
      updateCard(entryId, { phase: "posted", error: null });
      toast.success("Sent to Slack.");
    },
    [updateCard]
  );

  const skipOne = useCallback(
    (entryId: string) => {
      updateCard(entryId, { phase: "skipped", editing: false, error: null });
    },
    [updateCard]
  );

  const remainingReadyCount = useMemo(
    () =>
      cards.filter((c) => c.phase === "ready" && c.draft.trim().length > 0)
        .length,
    [cards]
  );

  const postedCount = useMemo(
    () => cards.filter((c) => c.phase === "posted").length,
    [cards]
  );

  const postAllRemaining = useCallback(async () => {
    const queue = cardsRef.current.filter(
      (c) => c.phase === "ready" && c.draft.trim().length > 0
    );
    if (queue.length === 0) {
      setPostAllConfirmOpen(false);
      return;
    }
    setPostAllRunning(true);
    let successCount = 0;
    try {
      for (const item of queue) {
        const text = item.draft.trim();
        updateCard(item.entryId, { phase: "posting", editing: false, error: null });
        const r = await pingSlackThread(item.slackUrl, text);
        if (!r.ok) {
          updateCard(item.entryId, { phase: "ready", error: r.error });
          toast.error(r.error);
          continue;
        }
        invalidateSlackThreadStatusCache(item.slackUrl);
        const nudged = await markUnrepliedAskNudged(item.entryId);
        if (!nudged.ok) {
          toast.error(nudged.error);
          updateCard(item.entryId, { phase: "ready", error: nudged.error });
          continue;
        }
        anyPostedRef.current = true;
        updateCard(item.entryId, { phase: "posted", error: null });
        successCount += 1;
      }
      if (successCount > 0) {
        toast.success(
          `Sent ${successCount} repl${successCount === 1 ? "y" : "ies"} to Slack.`
        );
      }
    } finally {
      setPostAllRunning(false);
      setPostAllConfirmOpen(false);
    }
  }, [updateCard]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (postAllRunning) return;
      // Let Escape cancel an open "Post all" confirmation first rather than
      // closing the whole dialog — safer for a bulk action.
      if (postAllConfirmOpen) {
        setPostAllConfirmOpen(false);
        return;
      }
      handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose, postAllRunning, postAllConfirmOpen]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 motion-safe:animate-[unrepliedFade_0.18s_ease-out_both] motion-reduce:animate-none"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => {
          if (postAllRunning) return;
          if (postAllConfirmOpen) {
            setPostAllConfirmOpen(false);
            return;
          }
          handleClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[1] flex max-h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/60 ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100"
            >
              <Sparkles
                className="h-4 w-4 shrink-0 text-violet-300/90"
                aria-hidden
              />
              <span className="truncate">Reply to all with AI</span>
              <span className="font-normal text-zinc-500">·</span>
              <span className="truncate font-normal text-zinc-400">
                {groupLabel}
              </span>
            </h2>
            <p className="mt-1 text-[11px] text-zinc-500">
              {postedCount} of {cards.length} sent
              {remainingReadyCount > 0
                ? ` · ${remainingReadyCount} ready to send`
                : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {remainingReadyCount > 0 && !postAllConfirmOpen ? (
              <button
                type="button"
                disabled={postAllRunning}
                onClick={() => setPostAllConfirmOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-violet-600/80 bg-violet-950/70 px-2.5 py-1.5 text-[11px] font-semibold text-violet-100",
                  "transition-colors hover:bg-violet-900/70 disabled:pointer-events-none disabled:opacity-40"
                )}
              >
                {postAllRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden />
                )}
                Send all remaining ({remainingReadyCount})
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!postAllRunning) handleClose();
              }}
              disabled={postAllRunning}
              aria-label="Close"
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {postAllConfirmOpen ? (
          <div className="shrink-0 border-b border-amber-500/25 bg-amber-950/35 px-4 py-2.5">
            <p className="text-xs text-amber-100/95">
              Send <strong>{remainingReadyCount}</strong> repl
              {remainingReadyCount === 1 ? "y" : "ies"} to Slack? Each one
              posts in its thread immediately.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                disabled={postAllRunning}
                onClick={() => setPostAllConfirmOpen(false)}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={postAllRunning}
                onClick={() => void postAllRemaining()}
                className="rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {postAllRunning ? "Sending…" : "Send all"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-3">
            {cards.map((c) => {
              const terminal = c.phase === "posted" || c.phase === "skipped";
              const busy = c.phase === "drafting" || c.phase === "posting";
              return (
                <li
                  key={c.entryId}
                  className="rounded-lg border border-zinc-800/90 bg-zinc-950/40 p-3"
                >
                  {/*
                    Header metadata — one line that spans the full card, so
                    channel + age always sit above the two columns.
                  */}
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    <span className="truncate font-semibold text-zinc-300">
                      {c.channelLabel}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{c.ageLabel}</span>
                    {c.phase === "posted" ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-0.5 font-medium text-emerald-400">
                          <Check className="h-3 w-3" aria-hidden />
                          Sent
                        </span>
                      </>
                    ) : null}
                    {c.phase === "skipped" ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-medium text-zinc-500">Skipped</span>
                      </>
                    ) : null}
                  </div>

                  {/*
                    Side-by-side layout. Both columns share the exact same
                    shell (border / bg / padding / label row) and stretch to
                    the same height via `md:items-stretch`, so the original
                    ask and the AI reply line up visually no matter how long
                    either one is. Collapses to stacked on narrow screens.
                  */}
                  <div
                    className={cn(
                      "grid gap-3",
                      terminal
                        ? "grid-cols-1"
                        : "grid-cols-1 md:grid-cols-2 md:items-stretch"
                    )}
                  >
                    {/* Original ask — cap height (~7 lines) with scroll for long threads */}
                    <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-zinc-800/70 bg-zinc-950/55 p-2.5">
                      <p className="mb-1.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                        Original ask
                      </p>
                      <div
                        className={cn(
                          "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-md",
                          ORIGINAL_ASK_MAX_SCROLL_HEIGHT
                        )}
                      >
                        <SlackMentionInlineText
                          text={c.askText}
                          people={people}
                          rosterHints={rosterHints}
                          mentionSize="sm"
                          mentionAvatar="hide"
                          className="block whitespace-pre-wrap break-words pr-1 text-sm leading-relaxed text-zinc-300"
                        />
                      </div>
                    </div>

                    {/* AI reply — Slack preview by default; click for raw `<@U…>` editor (QuickReply pattern) */}
                    {terminal ? null : (
                      <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-violet-500/25 bg-violet-950/15 p-2.5">
                        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-violet-300/80">
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            AI reply
                          </span>
                          {c.phase === "ready" && c.editing ? (
                            <button
                              type="button"
                              onClick={() => setCardEditing(c.entryId, false)}
                              className="font-normal normal-case tracking-normal text-zinc-400 transition-colors hover:text-zinc-200"
                            >
                              Done editing
                            </button>
                          ) : c.phase === "ready" && !c.editing ? (
                            <span className="font-normal normal-case tracking-normal text-zinc-600">
                              Click to edit
                            </span>
                          ) : null}
                        </div>
                        {c.phase === "drafting" && c.draft === "" ? (
                          <div className="flex min-h-[6rem] flex-1 items-start gap-2 pt-0.5 text-sm text-zinc-400">
                            <Loader2
                              className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-violet-300"
                              aria-hidden
                            />
                            <span>Reading thread and drafting…</span>
                          </div>
                        ) : c.phase === "error" ? (
                          <p className="min-h-[6rem] flex-1 rounded-md border border-red-500/30 bg-red-950/30 px-2 py-1.5 text-left text-xs leading-relaxed text-red-200/95">
                            {c.error ?? "Could not draft a reply."}
                          </p>
                        ) : !c.editing ? (
                          <button
                            type="button"
                            disabled={c.phase === "posting"}
                            onClick={() => setCardEditing(c.entryId, true)}
                            aria-label="Edit reply draft"
                            className={cn(
                              // Single visual shell: only the outer violet column —
                              // no nested bordered box. Top-align (buttons default to
                              // centered flex content).
                              "flex min-h-[6rem] w-full flex-1 flex-col items-start justify-start rounded-sm border-0 bg-transparent p-0 text-left shadow-none",
                              "transition-colors hover:bg-violet-950/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
                              c.phase === "posting" && "pointer-events-none opacity-60"
                            )}
                          >
                            <SlackMentionInlineText
                              text={c.draft}
                              people={people ?? EMPTY_PEOPLE}
                              rosterHints={rosterHints}
                              mentionSize="sm"
                              mentionAvatar="hide"
                              className="block w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-100"
                            />
                          </button>
                        ) : (
                          <textarea
                            ref={(el) => {
                              if (el)
                                draftTextareaRefs.current.set(c.entryId, el);
                              else
                                draftTextareaRefs.current.delete(c.entryId);
                            }}
                            value={c.draft}
                            onChange={(e) =>
                              updateCard(c.entryId, { draft: e.target.value })
                            }
                            disabled={c.phase === "posting"}
                            rows={5}
                            placeholder="Reply in thread…"
                            aria-label="Reply draft"
                            className={cn(
                              "min-h-[6rem] w-full flex-1 resize-y rounded-md border border-zinc-800/80 bg-zinc-950/55 px-2 py-1.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600",
                              "focus:outline-none focus:ring-2 focus:ring-violet-500/40",
                              c.phase === "posting" &&
                                "pointer-events-none opacity-60"
                            )}
                          />
                        )}
                        {c.error && c.phase !== "error" ? (
                          <p className="mt-2 rounded-md border border-red-500/30 bg-red-950/30 px-2 py-1.5 text-xs text-red-200/95">
                            {c.error}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {terminal ? null : (
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => skipOne(c.entryId)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <SkipForward className="h-3 w-3" aria-hidden />
                        Skip
                      </button>
                      <button
                        type="button"
                        onClick={() => void postOne(c.entryId)}
                        disabled={
                          busy || c.phase === "error" || !c.draft.trim()
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-violet-600 bg-violet-950/80 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-900/90 disabled:pointer-events-none disabled:opacity-40"
                      >
                        {c.phase === "posting" ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Send
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  );
}

type LauncherProps = {
  groupLabel: string;
  rows: UnrepliedAskSnapshotRow[];
  rosterHints: SlackMemberRosterHint[] | undefined;
  people: Person[];
  onAnyPosted?: () => void;
  /**
   * Right-margin utility class applied to the trigger button. Use `mr-4` when
   * this is the rightmost header action, `mr-2` when an Add-to-Team button
   * renders to its right.
   */
  trailingMarginClass?: string;
};

export function BulkReplyAllLauncher({
  groupLabel,
  rows,
  rosterHints,
  people,
  onAnyPosted,
  trailingMarginClass = "mr-4",
}: LauncherProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Draft AI replies for every open ask in this group"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 self-center rounded-md border border-violet-600/50 bg-transparent px-2 py-1 text-[11px] font-medium text-violet-200/90",
          "transition-[opacity,background-color,border-color,color] duration-150",
          "hover:border-violet-500 hover:bg-violet-950/50 hover:text-violet-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60",
          // Touch / small screens: always visible (no hover on touch).
          // md+: reveal only when the group header is hovered / focused, or while the dialog itself is open.
          "opacity-100 md:opacity-0 md:group-hover/followupHeader:opacity-100 md:group-focus-within/followupHeader:opacity-100",
          open && "md:opacity-100",
          trailingMarginClass
        )}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Bulk reply
      </button>
      <BulkReplyAllDialog
        open={open}
        onOpenChange={setOpen}
        groupLabel={groupLabel}
        rows={rows}
        rosterHints={rosterHints}
        people={people}
        onAnyPosted={onAnyPosted}
      />
    </>
  );
}
