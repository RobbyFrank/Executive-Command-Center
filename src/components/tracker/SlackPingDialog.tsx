"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { parseSlackThreadUrl } from "@/lib/slack";
import {
  generateDeadlineNudgeMessage,
  generateThreadPingMessage,
  getSlackThreadPosterPreviewIdentity,
  pingSlackThread,
  reviseSlackThreadPingMessage,
  type DeadlineNudgeLikelihoodContext,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { invalidateSlackThreadStatusCache } from "@/lib/slackThreadStatusCache";
import { formatCalendarDateHint } from "@/lib/relativeCalendarDate";
import { formatSlackChannelHash } from "@/lib/slackDisplay";
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

interface SlackPingDialogProps {
  open: boolean;
  onClose: () => void;
  slackUrl: string;
  milestoneName: string;
  /** Roadmap goal description (parent of project). */
  goalDescription?: string;
  projectName?: string;
  /** Goal Slack channel (for header label; optional if unknown). */
  channelId?: string;
  channelName?: string;
  /** Team roster: used to resolve `<@U…>` mentions in the preview. */
  people?: Person[];
  rosterHints?: SlackMemberRosterHint[];
  /** Called after a successful post so the parent can refetch thread status. */
  onSent?: () => void;
  /**
   * "ping" = ask for an update; "nudge" = push on deadline (requires `targetDate` + `likelihoodContext`);
   * "reply" = freeform AI-drafted reply (no auto-draft; user supplies intent).
   */
  mode?: "ping" | "nudge" | "reply";
  targetDate?: string;
  likelihoodContext?: DeadlineNudgeLikelihoodContext | null;
  /** Project owner / assignee name: AI addresses this person instead of the sender. */
  assigneeName?: string | null;
  /** Milestone row (or other container) to leave clear of the dimmed overlay. */
  spotlightRef?: RefObject<HTMLElement | null>;
}

export function SlackPingDialog({
  open,
  onClose,
  slackUrl,
  milestoneName,
  goalDescription = "",
  projectName = "",
  channelId = "",
  channelName = "",
  people = [],
  rosterHints = [],
  onSent,
  mode = "ping",
  targetDate = "",
  likelihoodContext = null,
  assigneeName = null,
  spotlightRef,
}: SlackPingDialogProps) {
  const [phase, setPhase] = useState<
    "idle" | "drafting" | "ready" | "revising" | "sending"
  >("idle");
  const [draft, setDraft] = useState("");
  const [reviseHint, setReviseHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [draftView, setDraftView] = useState<DraftViewMode>("preview");
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

  const parsedUrl = useMemo(
    () => parseSlackThreadUrl(slackUrl),
    [slackUrl]
  );
  const channelLabel = formatSlackChannelHash(
    channelName.trim() ||
      channelId.trim() ||
      (parsedUrl?.channelId ? parsedUrl.channelId : "")
  );

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
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, spotlightRef]);

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

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setDraft("");
      setReviseHint("");
      setError(null);
      return;
    }

    setError(null);
    setDraft("");
    setReviseHint("");

    // "reply" mode is user-driven: skip auto-generation and start in Edit with an
    // empty textarea. The user either types directly or asks the AI to draft via
    // the intent box below.
    if (mode === "reply") {
      setDraftView("edit");
      setPhase("ready");
      return;
    }

    setDraftView("preview");
    let cancelled = false;
    setPhase("drafting");

    void (async () => {
      if (mode === "nudge") {
        const td = targetDate.trim();
        if (!td || !likelihoodContext) {
          if (!cancelled) {
            setError(
              "Deadline nudge needs a target date and a completed deadline assessment."
            );
            setPhase("ready");
          }
          return;
        }
        const r = await generateDeadlineNudgeMessage(
          slackUrl,
          milestoneName,
          td,
          rosterHints,
          likelihoodContext,
          assigneeName?.trim() || undefined
        );
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          setPhase("ready");
          setDraft("");
          return;
        }
        setDraft(r.message);
        setPhase("ready");
        return;
      }

      const r = await generateThreadPingMessage(
        slackUrl,
        milestoneName,
        rosterHints,
        assigneeName?.trim() || undefined
      );
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setPhase("ready");
        setDraft("");
        return;
      }
      setDraft(r.message);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    slackUrl,
    milestoneName,
    rosterHints,
    mode,
    targetDate,
    likelihoodContext,
    assigneeName,
  ]);

  if (!open) return null;

  const tryDismissBackdrop = () => {
    if (
      phase !== "sending" &&
      phase !== "drafting" &&
      phase !== "revising"
    ) {
      onClose();
    }
  };

  const revise = async () => {
    const hint = reviseHint.trim();
    if (!hint || phase === "revising" || phase === "drafting") return;

    const previousDraft = draft;
    setPhase("revising");
    setError(null);
    setDraft("");

    const r = await reviseSlackThreadPingMessage(
      slackUrl,
      milestoneName,
      rosterHints,
      mode,
      previousDraft,
      hint,
      targetDate,
      likelihoodContext,
      assigneeName?.trim() || undefined
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
    setDraftView("preview");
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

  const title =
    mode === "nudge"
      ? "Nudge on deadline"
      : mode === "reply"
        ? "Draft a reply"
        : "Ask for an update";
  const dueHint = targetDate.trim()
    ? formatCalendarDateHint(targetDate.trim())
    : null;
  const isReplyMode = mode === "reply";
  const draftIsEmpty = draft.trim() === "";
  const aiSectionTitle = isReplyMode ? "Draft with AI" : "Revise with AI";
  const aiInputPlaceholder = isReplyMode
    ? draftIsEmpty
      ? "Describe what you want to say, e.g. Thank them for the demo and ask about Monday's cut-over…"
      : "Adjust the draft, e.g. Make it shorter, sound more casual…"
    : "e.g. Shorter, mention the deadline, add a call to action…";
  const aiActionLabel = isReplyMode && draftIsEmpty ? "Draft" : "Revise";
  const aiBusyLabel = isReplyMode && draftIsEmpty ? "Drafting…" : "Revising…";

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
        aria-labelledby="slack-ping-dialog-title"
        className={cn(
          "fixed left-1/2 top-1/2 z-[230] flex w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 shadow-xl shadow-black/50 sm:w-[min(48rem,calc(100vw-2rem))]",
          "max-h-[min(92vh,calc(100vh-1rem))]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-zinc-800/90 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <h2
              id="slack-ping-dialog-title"
              className="text-base font-semibold leading-snug text-zinc-100"
            >
              {title}
            </h2>
            <button
              type="button"
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={onClose}
              disabled={
                phase === "sending" ||
                phase === "drafting" ||
                phase === "revising"
              }
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <p
            className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xs leading-relaxed text-zinc-300"
            title="Goal / milestone / project"
          >
            <span className="min-w-0 max-w-full break-words font-medium">
              {goalDescription.trim() || "—"}
            </span>
            <span className="shrink-0 text-zinc-600" aria-hidden>
              /
            </span>
            <span className="min-w-0 max-w-full break-words font-medium">
              {milestoneName}
            </span>
            <span className="shrink-0 text-zinc-600" aria-hidden>
              /
            </span>
            <span className="min-w-0 max-w-full break-words font-medium">
              {projectName.trim() || "—"}
            </span>
          </p>

          <div className="mt-2.5 flex items-center gap-2 text-zinc-300">
            <SlackLogo className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            <span className="font-mono text-sm text-zinc-400">
              {channelLabel || "—"}
            </span>
          </div>

          <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
            {mode === "nudge" && dueHint ? (
              <>
                Draft pushes the team on hitting the milestone (
                <span className="text-zinc-300">{dueHint}</span>
                ). Posts as a reply in the linked thread using your Slack user
                token.
              </>
            ) : mode === "reply" ? (
              <>
                Tell the AI what you want to say and it will draft a reply grounded
                in the thread context. You can also type directly and revise with
                AI. Posts as a reply in the linked thread using your Slack user
                token.
              </>
            ) : (
              <>
                Draft asks for a status update—especially useful when the
                thread has been quiet. Posts as a reply in the linked thread
                using your Slack user token.
              </>
            )}
          </p>
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
                {draft.trim() === ""
                  ? mode === "nudge"
                    ? "Drafting a deadline nudge with AI…"
                    : "Drafting a Slack reply with AI…"
                  : "Finishing draft…"}
              </span>
            </div>
          ) : null}

          <div>
            <p
              id="slack-ping-draft-message-label"
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
                disabled={phase === "drafting"}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  draftView === "preview"
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300",
                  phase === "drafting" && "pointer-events-none opacity-50"
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

            {draftView === "preview" ? (
              <div
                role="region"
                aria-labelledby="slack-ping-draft-message-label"
              >
                <SlackDraftMessagePreview
                  text={draft}
                  people={people}
                  posterDisplayName={poster?.displayName ?? "You"}
                  posterAvatarSrc={poster?.avatarSrc ?? null}
                  postedAt={previewAt}
                />
              </div>
            ) : (
              <textarea
                id="slack-ping-draft-body"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={
                  phase === "drafting" ||
                  phase === "revising" ||
                  phase === "sending"
                }
                rows={14}
                aria-labelledby="slack-ping-draft-message-label"
                className="min-h-[min(42vh,18rem)] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                placeholder="Reply in thread…"
              />
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {aiSectionTitle}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <input
                type="text"
                value={reviseHint}
                onChange={(e) => setReviseHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void revise();
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
                  !reviseHint.trim()
                }
                onClick={() => void revise()}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium sm:min-w-[7.5rem]",
                  phase === "revising"
                    ? "cursor-wait border-zinc-500 bg-zinc-800 text-zinc-200"
                    : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                )}
              >
                {phase === "revising" ? (
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

        <div className="sticky bottom-0 z-[1] flex justify-end gap-3 border-t border-zinc-800/90 bg-zinc-900/98 px-5 py-4 backdrop-blur-sm sm:px-6">
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
            disabled={
              phase === "sending" ||
              phase === "revising" ||
              phase === "drafting"
            }
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg border border-violet-600 bg-violet-950/80 px-4 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-900/90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void send()}
            disabled={
              phase === "sending" ||
              phase === "drafting" ||
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
