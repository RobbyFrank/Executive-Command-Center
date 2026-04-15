"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  createMilestoneSlackThread,
  draftMilestoneThreadMessage,
  getSlackThreadPosterPreviewIdentity,
  reviseMilestoneThreadDraft,
} from "@/server/actions/slack";
import { formatSlackChannelHash } from "@/lib/slackDisplay";
import type { Person } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";
import { SlackDraftMessagePreview } from "./SlackDraftMessagePreview";
import { SlackLogo } from "./SlackLogo";

type DraftViewMode = "preview" | "edit";

interface SlackCreateThreadDialogProps {
  open: boolean;
  onClose: () => void;
  milestoneId: string;
  milestoneName: string;
  /** Roadmap goal description (parent of project). */
  goalDescription?: string;
  projectName?: string;
  channelId: string;
  channelName: string;
  /** Team roster: used to resolve `<@U…>` mentions in the preview. */
  people?: Person[];
  onCreated?: (slackUrl: string) => void;
}

export function SlackCreateThreadDialog({
  open,
  onClose,
  milestoneId,
  milestoneName,
  goalDescription = "",
  projectName = "",
  channelId,
  channelName,
  people = [],
  onCreated,
}: SlackCreateThreadDialogProps) {
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

  useEffect(() => {
    setMounted(true);
  }, []);

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

    setDraftView("preview");
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
    setDraftView("preview");
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
    toast.success("Posted to Slack. Thread link saved on the milestone.");
    onCreated?.(r.slackUrl);
    onClose();
  };

  const layer = (
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
          "fixed left-1/2 top-1/2 z-[230] flex w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 shadow-xl shadow-black/50 sm:w-[min(48rem,calc(100vw-2rem))]",
          "max-h-[min(92vh,calc(100vh-1rem))]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-zinc-800/90 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <h2
              id="slack-create-thread-title"
              className="text-base font-semibold leading-snug text-zinc-100"
            >
              Draft Slack thread with AI
            </h2>
            <button
              type="button"
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={onClose}
              disabled={phase === "sending" || phase === "drafting"}
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
              {channelLabel}
            </span>
          </div>
        </div>

        {phase === "drafting" ? (
          <div className="px-5 py-14 text-center sm:px-6">
            <p className="text-sm text-zinc-400">
              Drafting opening message with AI…
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4 px-5 pb-4 pt-4 sm:px-6 sm:pt-4">
              <div>
                <p
                  id="slack-draft-message-label"
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
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      draftView === "preview"
                        ? "bg-zinc-700 text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                    onClick={() => setDraftView("preview")}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={draftView === "edit"}
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      draftView === "edit"
                        ? "bg-zinc-700 text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                    onClick={() => setDraftView("edit")}
                  >
                    Edit
                  </button>
                </div>

                {draftView === "preview" ? (
                  <div
                    role="region"
                    aria-labelledby="slack-draft-message-label"
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
                    id="slack-draft-body"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={phase === "revising" || phase === "sending"}
                    rows={14}
                    aria-labelledby="slack-draft-message-label"
                    className="min-h-[min(42vh,18rem)] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    placeholder="Opening message…"
                  />
                )}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Revise with AI
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                  <input
                    type="text"
                    value={reviseHint}
                    onChange={(e) => setReviseHint(e.target.value)}
                    placeholder="e.g. Shorter, mention the deadline, add a call to action…"
                    disabled={phase === "revising" || phase === "sending"}
                    className="min-h-[2.75rem] min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  />
                  <button
                    type="button"
                    disabled={
                      phase === "revising" ||
                      phase === "sending" ||
                      !reviseHint.trim()
                    }
                    onClick={() => void revise()}
                    className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 sm:min-w-[7.5rem]"
                  >
                    {phase === "revising" ? "Revising…" : "Revise"}
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
                disabled={phase === "sending" || phase === "revising"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg border border-violet-600 bg-violet-950/80 px-4 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-900/90 disabled:cursor-not-allowed disabled:opacity-40"
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

  if (!mounted) return null;

  return createPortal(layer, document.body);
}
