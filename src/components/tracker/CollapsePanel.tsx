"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CollapsePanelProps = {
  open: boolean;
  children: React.ReactNode;
  /** Classes for the inner overflow wrapper (after `min-h-0 overflow-hidden`) */
  className?: string;
  /** Override outer grid transition timing/easing (default: 180ms ease-out) */
  transitionClassName?: string;
  /** Extra classes merged into the inner wrapper */
  innerClassName?: string;
};

/**
 * Gentle height animation via CSS grid (0fr ↔ 1fr). Keeps subtree mounted while
 * collapsed so expand/collapse can animate without measuring DOM height.
 */
export function CollapsePanel({
  open,
  children,
  className,
  transitionClassName,
  innerClassName,
}: CollapsePanelProps) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] motion-reduce:transition-none",
        transitionClassName ?? "duration-[180ms] ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}
    >
      <div
        className={cn(
          "min-h-0",
          /* `overflow-hidden` breaks nested `position: sticky` vs the page scroll; when open, allow sticky rows (e.g. Roadmap project headers). */
          open ? "overflow-visible" : "overflow-hidden",
          innerClassName,
          className
        )}
        inert={open ? undefined : true}
        aria-hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
