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
  /** Fade inner content with height (smoother disclosure lists) */
  fadeContent?: boolean;
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
  fadeContent = false,
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
          fadeContent &&
            "transition-opacity duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150 motion-reduce:transition-none",
          fadeContent && (open ? "opacity-100" : "opacity-0"),
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
