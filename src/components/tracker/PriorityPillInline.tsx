"use client";

import { Flag } from "lucide-react";
import type { Priority } from "@/lib/types/tracker";
import {
  PRIORITY_MENU_LABEL,
  priorityFlagIconClass,
  prioritySelectTextClass,
} from "@/lib/prioritySort";
import { cn } from "@/lib/utils";

/** Roadmap-aligned priority chip: flag icon + Urgent / High / Normal / Low (not raw P0–P3). */
export function PriorityPillInline({ priority }: { priority: string }) {
  const p = priority as Priority;
  const label = PRIORITY_MENU_LABEL[p] ?? priority;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-1.5 text-[10px] font-semibold"
      )}
      title={`Priority · ${label}`}
    >
      <Flag
        className={cn("h-3 w-3 shrink-0", priorityFlagIconClass(p))}
        strokeWidth={2}
        aria-hidden
      />
      <span className={cn("tracking-wide", prioritySelectTextClass(p))}>
        {label}
      </span>
    </span>
  );
}
