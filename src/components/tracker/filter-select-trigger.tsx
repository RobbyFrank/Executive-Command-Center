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
  hasSelection: boolean
) {
  return cn(
    "flex w-full items-center gap-2 rounded-md border bg-zinc-900/80 py-1.5 pl-2 pr-2 text-left text-sm text-zinc-100",
    "motion-reduce:transition-none transition-[border-color,box-shadow] duration-150 ease-out",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
    hasSelection
      ? "border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)]"
      : "border-zinc-700",
    open && "border-zinc-600"
  );
}
