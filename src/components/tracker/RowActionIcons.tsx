"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RowActionIconsProps {
  children: ReactNode;
  rowGroup?: "goal" | "project";
  /**
   * When true the container stays fully visible regardless of hover state.
   * Pass `true` when a child needs to be permanently shown (active exec flags,
   * pulsing review-notes icon, etc.) — this avoids the parent opacity cascade
   * hiding it.
   */
  forceVisible?: boolean;
}

/**
 * Container for the row “…” control that opens the context menu.
 *
 * Fades in/out with an opacity + pointer-events transition keyed to the parent
 * row's Tailwind group hover (`group/goal` or `group/project`).
 *
 * Pass `forceVisible` when the row should always show the control (e.g. at risk
 * or spotlight) without requiring hover.
 */
export function RowActionIcons({
  children,
  rowGroup = "goal",
  forceVisible = false,
}: RowActionIconsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 shrink-0 transition-opacity duration-150 ease-out motion-reduce:duration-0",
        forceVisible
          ? "opacity-100"
          : cn(
              "opacity-0 pointer-events-none",
              rowGroup === "project"
                ? "group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
                : "group-hover/goal:opacity-100 group-hover/goal:pointer-events-auto",
              "focus-within:opacity-100 focus-within:pointer-events-auto",
            ),
      )}
    >
      {children}
    </div>
  );
}
