"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hash, Loader2, Lock, X } from "lucide-react";
import type { SlackChannel } from "@/lib/slack";
import { createPrivateSlackChannelForOnboarding } from "@/server/actions/onboarding/createPrivateChannel";
import { prependChannelToSlackChannelsListCache } from "@/lib/slackChannelsListClientCache";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface CreatePrivateChannelDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the channel is created and the client cache is updated. */
  onCreated: (channel: SlackChannel) => void;
  /** Optional name seeded into the input (e.g. from the new hire's first name). */
  seedName?: string;
}

/**
 * Lightweight modal for creating a **private** Slack channel from the onboarding
 * recommender. No public-channel toggle by design — private-only keeps the surface narrow
 * and matches how new-hire "context channels" tend to be used in practice.
 */
export function CreatePrivateChannelDialog({
  open,
  onClose,
  onCreated,
  seedName,
}: CreatePrivateChannelDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(seedName ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setName(seedName ?? "");
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, seedName]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  const submit = useCallback(async () => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setError("Channel name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await createPrivateSlackChannelForOnboarding({ name: trimmed });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      prependChannelToSlackChannelsListCache(r.channel);
      toast.success(`Created #${r.channel.name}`);
      onCreated(r.channel);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [name, onClose, onCreated]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/65 p-3 sm:p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-private-channel-title"
    >
      <div
        className="absolute inset-0"
        aria-hidden
        onClick={() => !submitting && onClose()}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2
            id="create-private-channel-title"
            className="inline-flex items-center gap-2 text-base font-semibold text-zinc-100"
          >
            <Lock className="h-4 w-4 text-zinc-400" aria-hidden />
            Create private Slack channel
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block text-xs font-medium text-zinc-400">
            Channel name
          </label>
          <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 px-2.5 py-2 focus-within:border-zinc-500">
            <Hash className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) =>
                setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. onboarding-ana"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              maxLength={80}
              disabled={submitting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="text-[11px] leading-snug text-zinc-500">
            Lowercase letters, digits, hyphens, underscores, and dots only. Up to 80
            characters. You become the channel creator and will auto-invite the new hire
            when you send the assignment message.
          </p>
          {error ? (
            <p className="text-xs leading-snug text-red-400/95">{error}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !name.trim()}
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-600",
              "disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Create private channel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
