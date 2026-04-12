"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewLogEntry } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";
import { ReviewLogHistoryList } from "./ReviewLogHistoryList";

interface ReviewLogPanelProps {
  entries: ReviewLogEntry[] | undefined;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Log-only: does not update last reviewed. Omit on the Review page so only “mark reviewed” is offered. */
  onAppendNote?: (text: string) => void | Promise<unknown>;
  /** Marks reviewed; optional note from the draft (trimmed). When `onAppendNote` is omitted, this is the only action (Review queue flow). */
  onMarkReviewed?: (note?: string) => void | Promise<unknown>;
  disabled?: boolean;
  className?: string;
  /** `sidebar` — Review page right column: capped history height, compact composer */
  variant?: "default" | "compact" | "sidebar";
  /**
   * Review page column: no panel chrome or title (section provides heading); history
   * height is not capped here — parent supplies `overflow-y-auto`.
   */
  embedded?: boolean;
}

export function ReviewLogPanel({
  entries,
  draft,
  onDraftChange,
  onAppendNote,
  onMarkReviewed,
  disabled = false,
  className,
  variant = "default",
  embedded = false,
}: ReviewLogPanelProps) {
  const router = useRouter();
  const list = entries ?? [];
  const sorted = useMemo(
    () => [...list].sort((a, b) => b.at.localeCompare(a.at)),
    [list]
  );
  const [pending, setPending] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (pending || disabled) return;
    setPending(true);
    try {
      await fn();
      onDraftChange("");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const isSidebar = variant === "sidebar";
  const isEmbedded = embedded;
  const textAreaClass = isSidebar
    ? "min-h-[52px] text-xs py-1.5"
    : variant === "compact"
      ? "min-h-[52px] text-xs py-1.5"
      : "min-h-[72px] text-sm py-2";

  const historyListSize = isSidebar || variant === "compact" ? "compact" : "default";

  const hasAppend = typeof onAppendNote === "function";
  const hasMark = typeof onMarkReviewed === "function";
  /** Review queue: one primary action in this column (optional note, then advance). */
  const reviewCompletionOnly = hasMark && !hasAppend;

  return (
    <div
      className={cn(
        !isEmbedded && "rounded-lg border border-zinc-800/90 bg-zinc-950/35",
        isEmbedded && "flex flex-col",
        !isEmbedded &&
          isSidebar &&
          "flex max-h-[min(78vh,640px)] flex-col px-3 py-3",
        !isEmbedded && !isSidebar && variant === "compact" && "px-2.5 py-2",
        !isEmbedded && !isSidebar && variant !== "compact" && "px-3 py-3",
        className
      )}
    >
      {!isEmbedded ? (
        <p
          className={cn(
            "shrink-0 font-semibold tracking-tight text-zinc-200",
            isSidebar ? "text-xs" : variant === "compact" ? "text-xs" : "text-sm"
          )}
        >
          Review notes
          {sorted.length > 0 ? (
            <span className="font-normal text-zinc-500 tabular-nums">
              {" "}
              · {sorted.length}
            </span>
          ) : null}
        </p>
      ) : null}
      {sorted.length > 0 ? (
        <div
          className={cn(
            !isEmbedded && "mt-2.5 border-t border-zinc-800/80 pt-2.5",
            isEmbedded && "border-t border-zinc-800/80 pt-3",
            isSidebar && !isEmbedded && "flex min-h-0 flex-1 flex-col"
          )}
        >
          <p
            className={cn(
              "mb-2 shrink-0 font-medium uppercase tracking-wider text-zinc-500",
              isSidebar || variant === "compact" ? "text-[10px]" : "text-[11px]"
            )}
          >
            History · newest first
          </p>
          <ReviewLogHistoryList
            entries={sorted}
            size={historyListSize}
            className={
              isEmbedded
                ? undefined
                : isSidebar
                  ? "max-h-[min(32vh,240px)] min-h-0 flex-1 sm:max-h-[min(38vh,280px)]"
                  : undefined
            }
          />
        </div>
      ) : null}
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={
          reviewCompletionOnly
            ? "Optional note for this review (or leave blank)…"
            : "Optional feedback for this review…"
        }
        disabled={pending || disabled}
        rows={isSidebar ? 2 : variant === "compact" ? 2 : 3}
        className={cn(
          isEmbedded ? "mt-3" : "mt-2",
          "w-full shrink-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500",
          textAreaClass
        )}
      />
      <div
        className={cn(
          "mt-2 flex flex-wrap items-center gap-2",
          isSidebar && "shrink-0",
          reviewCompletionOnly && "flex-col items-stretch"
        )}
      >
        {reviewCompletionOnly && onMarkReviewed ? (
          <button
            type="button"
            disabled={pending || disabled}
            onClick={() =>
              void run(async () => {
                await onMarkReviewed(draft.trim() || undefined);
              })
            }
            className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark reviewed &amp; next
          </button>
        ) : (
          <>
            {hasAppend && onAppendNote ? (
              <button
                type="button"
                disabled={pending || disabled || !draft.trim()}
                onClick={() =>
                  void run(async () => {
                    await onAppendNote(draft);
                  })
                }
                className="rounded-md border border-zinc-600 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add note
              </button>
            ) : null}
            {hasMark && onMarkReviewed ? (
              <button
                type="button"
                disabled={pending || disabled}
                onClick={() =>
                  void run(async () => {
                    await onMarkReviewed(draft.trim() || undefined);
                  })
                }
                className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Mark reviewed
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
