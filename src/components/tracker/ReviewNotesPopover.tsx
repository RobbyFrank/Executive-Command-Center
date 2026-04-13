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
import { useRouter } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import type { ReviewLogEntry } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";
import { ReviewLogHistoryList } from "./ReviewLogHistoryList";

interface ReviewNotesPopoverProps {
  entries: ReviewLogEntry[] | undefined;
  onAppendNote: (text: string) => void | Promise<unknown>;
  /**
   * When true, the control stays visible and pulses — use when this project is in the
   * Review queue (same rule as Roadmap “Need review” / stale vs last reviewed).
   */
  pulseAttention?: boolean;
  /** Roadmap: `group/goal` vs `group/project` for row hover. Default: goal rows. */
  rowGroup?: "goal" | "project";
}

export function ReviewNotesPopover({
  entries,
  onAppendNote,
  pulseAttention = false,
  rowGroup = "goal",
}: ReviewNotesPopoverProps) {
  const router = useRouter();
  const list = entries ?? [];
  const sorted = useMemo(
    () => [...list].sort((a, b) => b.at.localeCompare(a.at)),
    [list]
  );
  const count = list.length;
  const rowGroupHoverOpacity =
    rowGroup === "project"
      ? "group-hover/project:opacity-100"
      : "group-hover/goal:opacity-100";

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverId = useId();
  const [placement, setPlacement] = useState<{
    top: number;
    right: number;
  } | null>(null);

  const updatePlacement = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    setPlacement({
      top: rect.bottom + 4,
      right: Math.max(4, window.innerWidth - rect.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePlacement();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await Promise.resolve(onAppendNote(trimmed));
      setDraft("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }, [draft, pending, onAppendNote, router]);

  const portal =
    open &&
    placement &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[200]"
          aria-hidden
          onClick={() => setOpen(false)}
        />
        <div
          id={popoverId}
          role="dialog"
          aria-label="Review notes"
          className="fixed z-[210] w-[22rem] rounded-xl border border-zinc-700 bg-zinc-900 p-3.5 shadow-xl shadow-black/40"
          style={{ top: placement.top, right: placement.right }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <p className="mb-3 text-sm font-semibold tracking-tight text-zinc-100">
            Review notes
          </p>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            History · newest first
          </p>
          {sorted.length > 0 ? (
            <div className="mb-3 border-b border-zinc-800/90 pb-3">
              <ReviewLogHistoryList entries={sorted} size="compact" />
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-4 text-center">
              <p className="text-[11px] text-zinc-500">No notes yet.</p>
            </div>
          )}
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Add a note
          </p>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note…"
            disabled={pending}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button
            type="button"
            disabled={pending || !draft.trim()}
            onClick={() => void submit()}
            className="mt-1.5 rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </>,
      document.body
    );

  return (
    <div
      ref={triggerRef}
      className="relative shrink-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={
          pulseAttention
            ? "Needs review — open notes (on Review queue)"
            : count > 0
              ? `Review notes (${count}) — open to read history or add`
              : "Review notes — open to add"
        }
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative inline-flex items-center justify-center rounded p-1 transition-colors",
          pulseAttention &&
            "text-amber-400/95 opacity-100 ring-2 ring-amber-500/50 motion-safe:animate-pulse hover:text-amber-300",
          !pulseAttention &&
            cn(
              count > 0
                ? cn(
                    "text-zinc-400 opacity-0 hover:opacity-100 hover:text-zinc-300 focus-visible:opacity-100",
                    rowGroupHoverOpacity
                  )
                : cn(
                    "text-zinc-500 opacity-0 hover:opacity-100 hover:text-zinc-400 focus-visible:opacity-100",
                    rowGroupHoverOpacity
                  ),
              open && "opacity-100"
            )
        )}
      >
        <MessageSquareText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {count > 0 ? (
          <span
            className="pointer-events-none absolute -right-1 -top-0.5 min-w-[0.875rem] rounded px-[1px] text-center text-[9px] font-medium tabular-nums leading-none text-zinc-200 ring-1 ring-zinc-600/90 bg-zinc-900/95"
            aria-hidden
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      {portal}
    </div>
  );
}
