"use client";

import { Check, Flag } from "lucide-react";
import type { Priority } from "@/lib/types/tracker";
import {
  PRIORITY_MENU_LABEL,
  priorityFlagIconClass,
  prioritySelectTextClass,
} from "@/lib/prioritySort";
import { cn } from "@/lib/utils";
import type { OverlaySelectFormatContext } from "./overlaySelectTypes";

/** Roadmap priority dropdown + collapsed cell: colored flag + label (values stay P0–P3). */
export function formatPriorityOverlayDisplay(
  value: string,
  ctx?: OverlaySelectFormatContext
) {
  const p = value as Priority;
  const label = PRIORITY_MENU_LABEL[p] ?? value;

  if (ctx?.role === "trigger") {
    return (
      <span className="flex w-full items-center justify-center">
        <Flag
          className={cn("h-4 w-4 shrink-0", priorityFlagIconClass(p))}
          strokeWidth={2}
          aria-hidden
        />
      </span>
    );
  }

  const showCheck = ctx?.role === "option" && ctx.isSelected;
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <Flag
          className={cn("h-3.5 w-3.5 shrink-0", priorityFlagIconClass(p))}
          strokeWidth={2}
          aria-hidden
        />
        <span
          className={cn(
            "truncate text-sm font-medium",
            prioritySelectTextClass(p)
          )}
        >
          {label}
        </span>
      </span>
      {showCheck ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-violet-400"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : null}
    </span>
  );
}
