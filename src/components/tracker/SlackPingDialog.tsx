"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  generateDeadlineNudgeMessage,
  generateThreadPingMessage,
  pingSlackThread,
  type DeadlineNudgeLikelihoodContext,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { invalidateSlackThreadStatusCache } from "@/lib/slackThreadStatusCache";
import { formatCalendarDateHint } from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";

interface SlackPingDialogProps {
  open: boolean;
  onClose: () => void;
  slackUrl: string;
  milestoneName: string;
  rosterHints?: SlackMemberRosterHint[];
  /** Called after a successful post so the parent can refetch thread status. */
  onSent?: () => void;
  /** "ping" = ask for an update; "nudge" = push on deadline (requires `targetDate` + `likelihoodContext`). */
  mode?: "ping" | "nudge";
  targetDate?: string;
  likelihoodContext?: DeadlineNudgeLikelihoodContext | null;
}

export function SlackPingDialog({
  open,
  onClose,
  slackUrl,
  milestoneName,
  rosterHints = [],
  onSent,
  mode = "ping",
  targetDate = "",
  likelihoodContext = null,
}: SlackPingDialogProps) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "sending">(
    "idle"
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setDraft("");
      setError(null);
      return;
    }

    let cancelled = false;
    setPhase("loading");
    setError(null);
    setDraft("");

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
          likelihoodContext
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
        rosterHints
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
  ]);

  if (!open) return null;

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
    toast.success("Message sent to Slack thread");
    onClose();
  };

  const title =
    mode === "nudge" ? "Nudge on deadline" : "Ask for an update";
  const dueHint = targetDate.trim()
    ? formatCalendarDateHint(targetDate.trim())
    : null;

  const layer = (
    <>
      <div
        className="fixed inset-0 z-[220] bg-black/60"
        aria-hidden
        onClick={() => phase !== "sending" && onClose()}
      />
      <div
        role="dialog"
        aria-labelledby="slack-ping-title"
        className={cn(
          "fixed left-1/2 top-1/2 z-[230] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-600 bg-zinc-900 p-4 shadow-xl shadow-black/50"
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2
            id="slack-ping-title"
            className="text-sm font-semibold text-zinc-100"
          >
            {title}
          </h2>
          <button
            type="button"
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-[11px] text-zinc-500">
          {mode === "nudge" && dueHint ? (
            <>
              Draft pushes the team on hitting the milestone (
              <span className="text-zinc-400">{dueHint}</span>
              ). Edit before sending; posts from your Slack user token.
            </>
          ) : (
            <>
              Draft asks for a status update—especially useful when the thread
              has been quiet. Edit before sending; posts from your Slack account
              (user token).
            </>
          )}
        </p>
        {phase === "loading" ? (
          <p className="py-6 text-center text-xs text-zinc-400">
            {mode === "nudge"
              ? "Generating deadline nudge…"
              : "Generating update request…"}
          </p>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={phase === "sending"}
              rows={mode === "nudge" ? 6 : 5}
              className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
              placeholder="Message to post in the thread…"
            />
            {error ? (
              <p className="mb-2 text-[11px] text-red-400/95">{error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                onClick={onClose}
                disabled={phase === "sending"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md border border-violet-600 bg-violet-950/80 px-3 py-1.5 text-[11px] font-medium text-violet-100 hover:bg-violet-900/90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void send()}
                disabled={phase === "sending" || !draft.trim()}
              >
                {phase === "sending" ? "Sending…" : "Send to Slack"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );

  if (!mounted) return null;

  return createPortal(layer, document.body);
}
