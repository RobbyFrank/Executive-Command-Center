"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type RoadmapColumnHeaderProps = {
  /** Shown in the native tooltip on hover (and after delay). */
  tooltip: string;
  className?: string;
  children: ReactNode;
};

/**
 * Roadmap sticky column title: `title` tooltip plus hover affordance
 * (cursor-help, dotted underline, brighter text) so users know more info exists.
 */
export function RoadmapColumnHeader({
  tooltip,
  className,
  children,
}: RoadmapColumnHeaderProps) {
  return (
    <div
      className={cn(
        "min-w-0 cursor-help select-none transition-colors duration-150",
        "hover:text-zinc-300 hover:underline hover:decoration-dotted hover:decoration-zinc-500 hover:underline-offset-[5px]",
        className
      )}
      title={tooltip}
    >
      {children}
    </div>
  );
}
