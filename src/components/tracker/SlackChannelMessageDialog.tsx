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
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  draftGoalChannelMessage,
  generateGoalChannelNudgeMessage,
  generateGoalChannelPingMessage,
  getSlackThreadPosterPreviewIdentity,
  postGoalChannelMessage,
  reviseGoalChannelAiMessage,
  reviseGoalChannelMessage,
  type GoalChannelAiContext,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { useResolvedSlackChannelLabel } from "@/hooks/useResolvedSlackChannelLabel";
import type { Person } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";
import { SlackDraftMessagePreview } from "./SlackDraftMessagePreview";
import { SlackLogo } from "./SlackLogo";
import {
  SlackThreadSpotlightBackdrop,
  readSpotlightHole,
  type SlackThreadSpotlightHole,
} from "./SlackThreadSpotlightBackdrop";

type DraftViewMode = "preview" | "edit";

/**
 * `ping` — friendly request for a goal status (AI auto-drafts on open).
 * `nudge` — direct push on timeline (AI auto-drafts; disabled when rollup not ready).
 * `reply` — free-form executive message (starts empty; AI draft is opt-in via the intent box).
 */
export type SlackChannelMessageMode = "ping" | "nudge" | "reply";

/** Why the goal channel composer closed: user backed out vs successful Slack post. */
export type SlackChannelMessageCloseReason = "dismiss" | "posted";

export interface SlackChannelMessageDialogProps {
  open: boolean;
  /** `dismiss` — Back, Esc, backdrop, or X. `posted` — message was sent successfully. */
  onClose: (reason: SlackChannelMessageCloseReason) => void;
  goalId: string;
  goalDescription: string;
  channelId: string;
  channelName: string;
  people?: Person[];
  onSent?: () => void;
  /** Element to keep clear of the dimmed overlay (e.g. goal row). */
  spotlightRef?: RefObject<HTMLElement | null>;
  /** Action mode; defaults to `reply` when omitted. */
  mode?: SlackChannelMessageMode;
  /** Goal rollup + per-project signals + roster hints for ping/nudge/revise drafting. */
  goalContext?: GoalChannelAiContext | null;
}

function modeTitle(mode: SlackChannelMessageMode): string {
  switch (mode) {
    case "ping":
      return "Ask for a goal update";
    case "nudge":
      return "Push on timeline";
    case "reply":
    default:
      return "New message in channel";
  }
}

/**
 * Post a fresh top-level message to a goal's Slack channel. Three modes:
 * - `reply` opens empty in Edit mode (user-driven, AI-optional via intent box)
 * - `ping` / `nudge` auto-draft on open using the goal's rollup + per-project signals
 */
export function SlackChannelMessageDialog({
  open,
  onClose,
  goalId,
  goalDescription,
  channelId,
  channelName,
  people = [],
  onSent,
  spotlightRef,
  mode = "reply",
  goalContext = null,
}: SlackChannelMessageDialogProps) {
  const [phase, setPhase] = useState<
    "idle" | "drafting" | "ready" | "revising" | "sending"
  >("ready");
  const [draft, setDraft] = useState("");
  const [aiIntent, setAiIntent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [draftView, setDraftView] = useState<DraftViewMode>("edit");
  const [poster, setPoster] = useState<{
    displayName: string;
    avatarSrc: string | null;
  } | null>(null);
  const [previewAt, setPreviewAt] = useState(() => new Date());
  const [spotlightGeo, setSpotlightGeo] = useState<{
    hole: SlackThreadSpotlightHole;
    vw: number;
    vh: number;
  } | null>(null);

  const rosterHints = useMemo((): SlackMemberRosterHint[] => {
    return people
      .filter((p) => p.slackHandle.trim() !== "")
      .map((p) => ({
        slackUserId: p.slackHandle,
        name: p.name,
        profilePicturePath: p.profilePicturePath.trim() || undefined,
      }));
  }, [people]);

  const channelLabel = useResolvedSlackChannelLabel(open, channelName, channelId);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setSpotlightGeo(null);
      return;
    }
    const el = spotlightRef?.current ?? null;
    if (!el || typeof window === "undefined") {
      setSpotlightGeo(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const hole = readSpotlightHole(el, el);
    if (!hole) {
      setSpotlightGeo(null);
      return;
    }
    setSpotlightGeo({ hole, vw, vh });
  }, [open, spotlightRef]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => {
      const el = spotlightRef?.current ?? null;
      if (!el || typeof window === "undefined") return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const hole = readSpotlightHole(el, el);
      if (!hole) return;
      setSpotlightGeo({ hole, vw, vh });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (phase === "sending" || phase === "drafting" || phase === "revising") {
          return;
        }
        onClose("dismiss");
      }
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, spotlightRef, onClose, phase]);

  useEffect(() => {
    if (!open) {
      setPoster(null);
      return;
    }
    setPreviewAt(new Date());
    let cancelled = false;
    void (async () => {
      const id = await getSlackThreadPosterPreviewIdentity();
      if (!cancelled) setPoster(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * Auto-draft snapshot — captured once per `open` transition so the draft doesn't get
   * wiped + re-run whenever `goalContext` is rebuilt by the parent (which happens on
   * every rollup cache poll tick). We read the latest ref inside the effect.
   */
  const goalContextRef = useRef(goalContext);
  goalContextRef.current = goalContext;

  /** Reset draft state and (for ping/nudge) auto-draft on open. */
  useEffect(() => {
    if (!open) {
      setPhase("ready");
      setDraft("");
      setAiIntent("");
      setError(null);
      setDraftView("edit");
      return;
    }

    setDraft("");
    setAiIntent("");
    setError(null);

    if (mode === "reply") {
      setDraftView("edit");
      setPhase("ready");
      return;
    }

    const snapshot = goalContextRef.current;
    if (!snapshot) {
      setDraftView("edit");
      setError(
        mode === "nudge"
          ? "Goal assessment not ready. Open the goal popover again in a moment."
          : "Goal signals not available yet."
      );
      setPhase("ready");
      return;
    }

    setDraftView("preview");
    setPhase("drafting");
    let cancelled = false;

    void (async () => {
      const r =
        mode === "nudge"
          ? await generateGoalChannelNudgeMessage(snapshot)
          : await generateGoalChannelPingMessage(snapshot);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setDraftView("edit");
        setPhase("ready");
        return;
      }
      setDraft(r.message);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  if (!open) return null;

  const tryDismissBackdrop = () => {
    if (
      phase !== "sending" &&
      phase !== "drafting" &&
      phase !== "revising"
    ) {
      onClose("dismiss");
    }
  };

  const draftIsEmpty = draft.trim() === "";
  const aiActionLabel = draftIsEmpty ? "Draft" : "Revise";
  const aiBusyLabel = draftIsEmpty ? "Drafting…" : "Revising…";
  const aiInputPlaceholder = draftIsEmpty
    ? "Describe what to say, e.g. I'm worried we'll miss the Oct 30 cut-over — ask each lead for a status today…"
    : "Adjust the draft, e.g. Make it shorter, more urgent, add a deadline…";

  const runAi = async () => {
    const intent = aiIntent.trim();
    if (!intent) return;
    if (phase === "drafting" || phase === "revising" || phase === "sending") {
      return;
    }

    setError(null);
    if (draftIsEmpty) {
      setPhase("drafting");
      const r = await draftGoalChannelMessage(goalDescription, intent);
      if (!r.ok) {
        setError(r.error);
        setPhase("ready");
        toast.error(r.error);
        return;
      }
      setDraft(r.message);
      setAiIntent("");
      setDraftView("preview");
      setPhase("ready");
      return;
    }

    /** Prefer the context-aware revise action when we have the goal rollup; falls back to the simpler description-only revise for `reply` mode without context. */
    setPhase("revising");
    const previous = draft;
    const r = goalContext
      ? await reviseGoalChannelAiMessage(goalContext, previous, intent)
      : await reviseGoalChannelMessage(goalDescription, previous, intent);
    if (!r.ok) {
      setError(r.error);
      setPhase("ready");
      toast.error(r.error);
      return;
    }
    setDraft(r.message);
    setAiIntent("");
    setDraftView("preview");
    setPhase("ready");
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || phase === "sending") return;
    setPhase("sending");
    setError(null);
    const r = await postGoalChannelMessage(goalId, text);
    if (!r.ok) {
      setError(r.error);
      setPhase("ready");
      toast.error(r.error);
      return;
    }
    toast.success("Posted to Slack.");
    onSent?.();
    onClose("posted");
  };

  const title = modeTitle(mode);

  const layer = (
    <>
      {spotlightGeo ? (
        <SlackThreadSpotlightBackdrop
          hole={spotlightGeo.hole}
          winW={spotlightGeo.vw}
          winH={spotlightGeo.vh}
          backdropZIndex={218}
          onDismiss={tryDismissBackdrop}
        />
      ) : (
        <div
          className="fixed inset-0 z-[220] bg-black/60"
          aria-hidden
          onClick={tryDismissBackdrop}
        />
      )}
      <div
        role="dialog"
        aria-busy={phase === "drafting" || phase === "revising"}
        aria-labelledby="slack-channel-message-title"
        className={cn(
          "fixed left-1/2 top-1/2 z-[230] flex w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 shadow-xl shadow-black/50 sm:w-[min(48rem,calc(100vw-2rem))]",
          "max-h-[min(92vh,calc(100vh-1rem))]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-zinc-800/90 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <h2
              id="slack-channel-message-title"
              className="text-base font-semibold leading-snug text-zinc-100"
            >
              {title}
            </h2>
            <button
              type="button"
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={() => onClose("dismiss")}
              disabled={
                phase === "sending" ||
                phase === "drafting" ||
                phase === "revising"
              }
              aria-label="Back to goal delivery"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <p
            className="mt-2 truncate text-xs text-zinc-400"
            title={goalDescription}
          >
            Goal: {goalDescription.trim() || "(untitled)"}
          </p>

          <div className="mt-2.5 flex items-center gap-2 text-zinc-300">
            <SlackLogo className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            <span className="font-mono text-sm text-zinc-400">
              {channelLabel}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-5 pb-4 pt-4 sm:px-6 sm:pt-4">
          {phase === "drafting" ? (
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-lg border border-zinc-700/80 bg-zinc-950/50 px-3.5 py-2.5 text-sm text-zinc-300",
                draft.trim() !== "" && "border-zinc-800/80 bg-transparent py-1.5"
              )}
              role="status"
              aria-live="polite"
            >
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-violet-400"
                aria-hidden
              />
              <span>
                {mode === "nudge"
                  ? "Drafting a deadline nudge with AI…"
                  : mode === "ping"
                    ? "Drafting a status-update request with AI…"
                    : "Drafting with AI…"}
              </span>
            </div>
          ) : null}

          <div>
            <p
              id="slack-channel-message-label"
              className="mb-2 text-xs font-medium text-zinc-400"
            >
              Message
            </p>
            <div
              className="mb-2 flex rounded-lg border border-zinc-700 bg-zinc-950/80 p-0.5"
              role="tablist"
              aria-label="Message view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={draftView === "preview"}
                disabled={phase === "drafting" || draftIsEmpty}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  draftView === "preview"
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300",
                  (phase === "drafting" || draftIsEmpty) &&
                    "pointer-events-none opacity-50"
                )}
                onClick={() => setDraftView("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draftView === "edit"}
                disabled={phase === "drafting"}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  draftView === "edit"
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300",
                  phase === "drafting" && "pointer-events-none opacity-50"
                )}
                onClick={() => setDraftView("edit")}
              >
                Edit
              </button>
            </div>

            {draftView === "preview" && !draftIsEmpty ? (
              <div
                role="region"
                aria-labelledby="slack-channel-message-label"
              >
                <SlackDraftMessagePreview
                  text={draft}
                  people={people}
                  rosterHints={rosterHints}
                  posterDisplayName={poster?.displayName ?? "You"}
                  posterAvatarSrc={poster?.avatarSrc ?? null}
                  postedAt={previewAt}
                />
              </div>
            ) : (
              <textarea
                id="slack-channel-message-body"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={
                  phase === "drafting" ||
                  phase === "revising" ||
                  phase === "sending"
                }
                rows={10}
                aria-labelledby="slack-channel-message-label"
                className="min-h-[min(36vh,16rem)] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                placeholder={
                  mode === "reply"
                    ? "Type your message to the channel…"
                    : "AI draft will appear here — edit freely or ask for a revision below."
                }
                autoFocus={mode === "reply"}
              />
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {draftIsEmpty ? "Draft with AI" : "Revise with AI"}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <input
                type="text"
                value={aiIntent}
                onChange={(e) => setAiIntent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void runAi();
                }}
                placeholder={aiInputPlaceholder}
                disabled={
                  phase === "drafting" ||
                  phase === "revising" ||
                  phase === "sending"
                }
                className="min-h-[2.75rem] min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <button
                type="button"
                disabled={
                  phase === "drafting" ||
                  phase === "revising" ||
                  phase === "sending" ||
                  !aiIntent.trim()
                }
                onClick={() => void runAi()}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium sm:min-w-[7.5rem]",
                  phase === "drafting" || phase === "revising"
                    ? "cursor-wait border-zinc-500 bg-zinc-800 text-zinc-200"
                    : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                )}
              >
                {phase === "drafting" || phase === "revising" ? (
                  <>
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-zinc-400"
                      aria-hidden
                    />
                    {aiBusyLabel}
                  </>
                ) : (
                  aiActionLabel
                )}
              </button>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-400/95">{error}</p>
          ) : null}
        </div>

        <div className="sticky bottom-0 z-[1] flex items-center justify-between gap-3 border-t border-zinc-800/90 bg-zinc-900/98 px-5 py-4 backdrop-blur-sm sm:px-6">
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
            onClick={() => onClose("dismiss")}
            disabled={
              phase === "sending" ||
              phase === "revising" ||
              phase === "drafting"
            }
          >
            Back
          </button>
          <button
            type="button"
            className="rounded-lg border border-violet-600 bg-violet-950/80 px-4 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-900/90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void send()}
            disabled={
              phase === "sending" ||
              phase === "drafting" ||
              phase === "revising" ||
              !draft.trim()
            }
          >
            {phase === "sending" ? "Posting…" : "Post to Slack"}
          </button>
        </div>
      </div>
    </>
  );

  if (!mounted) return null;
  return createPortal(layer, document.body);
}
