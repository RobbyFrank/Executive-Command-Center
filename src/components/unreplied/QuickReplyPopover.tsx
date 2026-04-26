"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  generateSlackQuickReply,
  pingSlackThread,
  reviseSlackQuickReply,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { invalidateSlackThreadStatusCache } from "@/lib/slackThreadStatusCache";
import { SlackMentionInlineText } from "@/components/tracker/SlackMentionInlineText";
import type { Person } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";

type Phase = "drafting" | "ready" | "revising" | "sending" | "error";

/** Stable empty reference so SlackMentionInlineText's memo deps don't churn. */
const EMPTY_PEOPLE: Person[] = [];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Anchor element (the "Draft reply" button on the Followups row). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Slack permalink for the ask message; we post into the same thread. */
  slackUrl: string;
  rosterHints?: SlackMemberRosterHint[];
  /**
   * Team roster so the live preview above the textarea can render `<@U…>`
   * mention tokens as avatar + name chips (same helper used on the Followups
   * row itself). When present, the user sees "@Ghulam" — not the raw
   * `<@U09LXBW5WCE>` — while editing, matching how Slack will render the
   * message once it's posted.
   */
  people?: Person[];
  /** Optional assignee name so the AI can address them in the reply. */
  assigneeName?: string | null;
  /** Called after a successful post so the parent can refetch / mark nudged. */
  onSent?: () => void;
};

/**
 * One-click quick-reply popover for the Followups wall.
 *
 * Opens anchored to the "Draft reply" button, immediately drafts a short
 * context-grounded reply with AI (reads the thread's recent messages). The
 * draft is shown as a rendered Slack preview first; clicking it opens the raw
 * editor. A compact "Revise with AI" affordance stays visible so the user can
 * refine with one line of feedback without leaving the popover.
 */
export function QuickReplyPopover({
  open,
  onClose,
  anchorRef,
  slackUrl,
  rosterHints,
  people,
  assigneeName,
  onSent,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("drafting");
  const [draft, setDraft] = useState("");
  const [reviseHint, setReviseHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Preview-first: textarea appears only after the user clicks the preview. */
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Draft on open. Re-draft if the anchored message changes (different row).
  useEffect(() => {
    if (!open || !slackUrl) return;
    let cancelled = false;
    setPhase("drafting");
    setDraft("");
    setReviseHint("");
    setError(null);
    setEditing(false);
    void (async () => {
      const r = await generateSlackQuickReply(
        slackUrl,
        rosterHints,
        assigneeName ?? undefined
      );
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setPhase("error");
        return;
      }
      setDraft(r.message.trim());
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slackUrl, rosterHints, assigneeName]);

  // Placement + outside-click + escape + scroll reposition.
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
      const panelWidth = Math.min(420, window.innerWidth - 24);
      const margin = 8;
      const gap = 8;
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
      if (maxBelow >= 260 || maxBelow >= maxAbove) {
        top = below;
        maxHeight = Math.max(260, Math.min(520, maxBelow));
      } else {
        maxHeight = Math.max(260, Math.min(520, maxAbove));
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

  // Focus the textarea when the user opens the raw editor; caret at end (not
  // select-all) so typing appends naturally.
  useEffect(() => {
    if (phase !== "ready" || !editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [phase, editing]);

  const revise = async () => {
    const hint = reviseHint.trim();
    if (!hint) return;
    if (phase === "revising" || phase === "drafting" || phase === "sending") {
      return;
    }
    const previousDraft = draft;
    setPhase("revising");
    setError(null);
    const r = await reviseSlackQuickReply(
      slackUrl,
      rosterHints,
      previousDraft,
      hint,
      assigneeName ?? undefined
    );
    if (!r.ok) {
      setDraft(previousDraft);
      setError(r.error);
      setPhase("ready");
      toast.error(r.error);
      return;
    }
    setDraft(r.message.trim());
    setReviseHint("");
    setPhase("ready");
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || phase === "sending") return;
    setPhase("sending");
    setError(null);
    const r = await pingSlackThread(slackUrl, text);
    if (!r.ok) {
      setError(r.error);
      setPhase("ready");
      toast.error(r.error);
      return;
    }
    invalidateSlackThreadStatusCache(slackUrl);
    onSent?.();
    toast.success("Posted to Slack.");
    onClose();
  };

  if (!mounted || !open || !placement) return null;

  const busy =
    phase === "drafting" || phase === "revising" || phase === "sending";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Quick reply"
      aria-busy={busy}
      className={cn(
        "fixed z-[300] flex flex-col overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900/98 shadow-2xl shadow-black/60 ring-1 ring-white/5",
        "motion-safe:animate-[unrepliedFade_0.18s_ease-out_both] motion-reduce:animate-none"
      )}
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
          <Sparkles
            className="h-4 w-4 text-violet-300/90"
            aria-hidden
          />
          <span>AI quick reply</span>
          {phase === "drafting" ? (
            <span className="text-xs font-normal text-zinc-500">
              · drafting…
            </span>
          ) : phase === "revising" ? (
            <span className="text-xs font-normal text-zinc-500">
              · revising…
            </span>
          ) : phase === "sending" ? (
            <span className="text-xs font-normal text-zinc-500">
              · posting…
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={phase === "sending"}
          aria-label="Close"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
        {phase === "drafting" && draft === "" ? (
          <div className="flex items-center gap-2 rounded-md border border-zinc-800/90 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400">
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-violet-300"
              aria-hidden
            />
            <span>Reading thread and drafting a reply…</span>
          </div>
        ) : !editing ? (
          <button
            type="button"
            disabled={phase === "sending"}
            onClick={() => setEditing(true)}
            aria-label="Edit reply draft"
            className={cn(
              "w-full rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-2 text-left transition-colors",
              "hover:border-violet-500/35 hover:bg-zinc-950/70 focus:outline-none focus:ring-2 focus:ring-violet-500/40",
              phase === "sending" && "pointer-events-none opacity-60"
            )}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" aria-hidden />
                Preview
              </span>
              <span className="font-normal normal-case tracking-normal text-zinc-600">
                Click to edit
              </span>
            </div>
            {/*
              Renders `<@U…>` / channels / links as Slack will show after post.
              Plain text uses the same component for a single preview surface.
            */}
            <SlackMentionInlineText
              text={draft}
              people={people ?? EMPTY_PEOPLE}
              rosterHints={rosterHints}
              mentionSize="sm"
              mentionAvatar="hide"
              className="block whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200"
            />
          </button>
        ) : (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              // Unfocusing the textarea — by clicking anywhere outside it
              // (Revise input, Cancel/Post buttons, or completely outside the
              // popover) — collapses it back into the rendered Slack preview
              // so `<@U…>` tokens render as mention chips again instead of
              // raw IDs. Skip during a send so the in-flight UI is stable.
              if (phase === "sending") return;
              setEditing(false);
            }}
            disabled={phase === "sending"}
            rows={5}
            placeholder="Reply in thread…"
            aria-label="Reply draft"
            className={cn(
              "min-h-[6rem] w-full resize-y rounded-md border border-zinc-700/80 bg-zinc-950/80 px-2.5 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600",
              "focus:outline-none focus:ring-2 focus:ring-violet-500/40",
              phase === "sending" && "pointer-events-none opacity-60"
            )}
          />
        )}

        {error ? (
          <p className="rounded-md border border-red-500/30 bg-red-950/30 px-2 py-1.5 text-sm text-red-200/95">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={reviseHint}
            onChange={(e) => setReviseHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void revise();
              }
            }}
            placeholder="Revise with AI (e.g. shorter, warmer)…"
            disabled={busy}
            className={cn(
              "min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600",
              "focus:outline-none focus:ring-2 focus:ring-violet-500/30",
              busy && "pointer-events-none opacity-60"
            )}
          />
          <button
            type="button"
            onClick={() => void revise()}
            disabled={busy || !reviseHint.trim()}
            title="Revise the draft with AI"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40"
          >
            {phase === "revising" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            Revise
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          disabled={phase === "sending"}
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          title="Post this reply to the Slack thread"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
            "border-violet-600 bg-violet-950/80 text-violet-100 hover:bg-violet-900/90",
            "disabled:pointer-events-none disabled:opacity-40"
          )}
        >
          {phase === "sending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden />
          )}
          {phase === "sending" ? "Posting…" : "Post to Slack"}
        </button>
      </div>
    </div>,
    document.body
  );
}
