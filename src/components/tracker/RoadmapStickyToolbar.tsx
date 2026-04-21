"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRoadmapView } from "./roadmap-view-context";

/**
 * Wraps the Roadmap filter/title bar (sticky top). Measures its height so
 * {@link TrackerColumnHeaders} can use `position: sticky` with `top` just below it.
 */
export function RoadmapStickyToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { setStickyTopPx } = useRoadmapView();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () =>
      setStickyTopPx(Math.round(el.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setStickyTopPx]);

  return (
    <div
      ref={ref}
      className={cn(
        "sticky top-0 z-30 min-w-0 max-w-full border-b border-zinc-800/70",
        /*
          Solid fill (no backdrop-blur) — content scrolls cleanly behind it instead
          of smearing. Matches {@link RoadmapStickyBelowToolbarGap} so the seam to
          the strip below is invisible.
        */
        "bg-[var(--surface-toolbar)] px-6 pt-6 pb-3"
      )}
    >
      {children}
    </div>
  );
}
