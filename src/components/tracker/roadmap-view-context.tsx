"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Roadmap UI shared client state — see `docs/roadmap-ui-rollout.md`.
 * - Step 1: `columnMode` (full until compact mode lands).
 * - Step 3: `stickyTopPx` — height of the sticky Roadmap toolbar for sub-header stickiness.
 */

export type RoadmapColumnMode = "compact" | "full";

type RoadmapViewContextValue = {
  columnMode: RoadmapColumnMode;
  /** Pixel offset for sticky goal/project column headers (toolbar height). */
  stickyTopPx: number;
  setStickyTopPx: (px: number) => void;
};

const RoadmapViewContext = createContext<RoadmapViewContextValue | null>(null);

export function RoadmapViewProvider({ children }: { children: ReactNode }) {
  const [stickyTopPx, setStickyTopPx] = useState(0);

  const value = useMemo<RoadmapViewContextValue>(
    () => ({
      columnMode: "full",
      stickyTopPx,
      setStickyTopPx,
    }),
    [stickyTopPx]
  );

  return (
    <RoadmapViewContext.Provider value={value}>
      {children}
    </RoadmapViewContext.Provider>
  );
}

export function useRoadmapView(): RoadmapViewContextValue {
  const ctx = useContext(RoadmapViewContext);
  if (!ctx) {
    throw new Error("useRoadmapView must be used inside RoadmapViewProvider");
  }
  return ctx;
}
