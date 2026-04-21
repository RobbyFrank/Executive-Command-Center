"use client";

import { useRoadmapView } from "./roadmap-view-context";
import {
  ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX,
  ROADMAP_TOOLBAR_STICKY_FALLBACK_PX,
} from "@/lib/tracker-sticky-layout";

/**
 * Opaque strip that sits in the scroll flow under the toolbar, then sticks flush under it
 * so scrolling content does not show through the gap above the first company row.
 */
export function RoadmapStickyBelowToolbarGap() {
  const { stickyTopPx } = useRoadmapView();
  const toolbarPx =
    stickyTopPx > 0 ? stickyTopPx : ROADMAP_TOOLBAR_STICKY_FALLBACK_PX;

  return (
    <div
      aria-hidden
      className="sticky z-[29] -mx-6 shrink-0 bg-[var(--surface-toolbar)] pointer-events-none"
      style={{
        top: toolbarPx,
        height: ROADMAP_STICKY_GAP_BELOW_TOOLBAR_PX,
      }}
    />
  );
}
