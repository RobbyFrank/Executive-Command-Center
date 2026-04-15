"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  createMilestoneSlackThread,
  draftMilestoneThreadMessage,
  reviseMilestoneThreadDraft,
} from "@/server/actions/slack";
import { formatSlackChannelHash } from "@/lib/slackDisplay";
import { cn } from "@/lib/utils";

interface SlackCreateThreadDialogProps {
  open: boolean;
  onClose: () => void;
  milestoneId: string;
  milestoneName: string;
  channelId: string;
  channelName: string;
  onCreated?: (slackUrl: string) => void;
}

export function SlackCreateThreadDialog({
  open,
  onClose,
  milestoneId,
  milestoneName,
  channelId,
  channelName,
  onCreated,
}: SlackCreateThreadDialogProps) {
  const [phase, setPhase] = useState<
    "idle" | "drafting" | "ready" | "revising" | "sending"
  >("idle");
  const [draft, setDraft] = useState("");
  const [reviseHint, setReviseHint] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setDraft("");
      setReviseHint("");
      setError(null);
      return;
    }

    let cancelled = false;
    setPhase("drafting");
    setError(null);
    setDraft("");
    setReviseHint("");

    void (async () => {
      const r = await draftMilestoneThreadMessage(milestoneId);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setPhase("ready");
        return;
      }
      setDraft(r.message);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, milestoneId]);

  if (!open) return null;

  const channelLabel = formatSlackChannelHash(channelName || channelId);

  const revise = async () => {
    const hint = reviseHint.trim();
    if (!hint || phase === "revising") return;
    setPhase("revising");
    setError(null);
    const r = await reviseMilestoneThreadDraft(milestoneId, draft, hint);
    if (!r.ok) {
      setError(r.error);
      setPhase("ready");
      toast.error(r.error);
      return;
    }
    setDraft(r.message);
    setReviseHint("");
    setPhase("ready");
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || phase === "sending") return;
    setPhase("sending");
    setError(null);
    const r = await createMilestoneSlackThread(milestoneId, channelId, text);
    if (!r.ok) {
      setError(r.error);
      setPhase("ready");
      toast.error(r.error);
      return;
    }
    toast.success("Posted to Slack — thread link saved on the milestone");
    onCreated?.(r.slackUrl);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[220] bg-black/60"
        aria-hidden
        onClick={() =>
          phase !== "sending" && phase !== "drafting" && phase !== "revising"
            ? onClose()
            : undefined
        }
      />
      <div
        role="dialog"
        aria-labelledby="slack-create-thread-title"
        className={cn(
          "fixed left-1/2 top-1/2 z-[230] w-[min(28rem,calc(100vw-2rem))] max-h-[min(90vh,calc(100vh-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 p-4 shadow-xl shadow-black/50"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2
            id="slack-create-thread-title"
            className="text-sm font-semibold text-zinc-100"
          >
            Draft Slack thread with AI
          </h2>
          <button
            type="button"
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
            disabled={phase === "sending" || phase === "drafting"}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-1 text-[11px] text-zinc-500">
          Milestone:{" "}
          <span className="font-medium text-zinc-300">{milestoneName}</span>
        </p>
        <p className="mb-3 text-[11px] text-zinc-500">
          Will post to{" "}
          <span className="font-mono text-zinc-400">{channelLabel}</span> as
          your Slack user (same token as milestone threads).
        </p>

        {phase === "drafting" ? (
          <p className="py-6 text-center text-xs text-zinc-400">
            Drafting opening message with AI…
          </p>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={phase === "revising" || phase === "sending"}
              rows={10}
              className="mb-3 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
              placeholder="Opening message…"
            />

            <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Revise with AI
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={reviseHint}
                  onChange={(e) => setReviseHint(e.target.value)}
                  placeholder="e.g. Shorter, mention the deadline…"
                  disabled={phase === "revising" || phase === "sending"}
                  className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600"
                />
                <button
                  type="button"
                  disabled={
                    phase === "revising" ||
                    phase === "sending" ||
                    !reviseHint.trim()
                  }
                  onClick={() => void revise()}
                  className="shrink-0 rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                >
                  {phase === "revising" ? "Revising…" : "Revise"}
                </button>
              </div>
            </div>

            {error ? (
              <p className="mb-2 text-[11px] text-red-400/95">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                onClick={onClose}
                disabled={phase === "sending" || phase === "revising"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md border border-violet-600 bg-violet-950/80 px-3 py-1.5 text-[11px] font-medium text-violet-100 hover:bg-violet-900/90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void send()}
                disabled={phase === "sending" || !draft.trim()}
              >
                {phase === "sending" ? "Posting…" : "Post to Slack"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
