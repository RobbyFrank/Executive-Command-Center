"use client";

import { cn } from "@/lib/utils";

/** Small count badge when a roadmap filter has selections. */
export function FilterSelectSelectionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-emerald-200/95"
      aria-hidden
    >
      {count}
    </span>
  );
}

export function filterSelectTriggerButtonClass(
  open: boolean,
  hasSelection: boolean,
  options?: { selectionAccent?: "default" | "hoverOnly" }
) {
  const selectionAccent = options?.selectionAccent ?? "default";
  return cn(
    "flex w-full items-center gap-2 rounded-md border bg-zinc-900/80 py-1.5 pl-2 pr-2 text-left text-sm text-zinc-100",
    "motion-reduce:transition-none transition-[border-color,box-shadow,background-color] duration-150 ease-out",
    "focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400/20 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
    "hover:bg-zinc-900/95",
    hasSelection
      ? selectionAccent === "hoverOnly"
        ? "border-zinc-700 shadow-none hover:border-emerald-500/40 hover:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)] focus-visible:border-emerald-400/48"
        : "border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)] hover:border-emerald-400/42 focus-visible:border-emerald-400/48"
      : "border-zinc-700 hover:border-zinc-600 focus-visible:border-zinc-500/45",
    open &&
      (hasSelection
        ? selectionAccent === "hoverOnly"
          ? "border-zinc-500/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-emerald-400/40 hover:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.14)]"
          : "border-emerald-400/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.14)]"
        : "border-zinc-500/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]")
  );
}
