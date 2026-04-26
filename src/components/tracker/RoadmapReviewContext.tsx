"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  open: boolean;
  setOpen: (open: boolean) => void;
  openSheet: () => void;
  closeSheet: () => void;
  /** True while a multi- or single-company Slack sync is streaming in the review sheet. */
  slackQueueSyncing: boolean;
  setSlackQueueSyncing: (v: boolean) => void;
  /**
   * Portfolio progress (companies done / total) for the in-flight sync, mirrored
   * from the review sheet for the sidebar label.
   */
  slackQueueSyncProgress: { total: number; completed: number } | null;
  setSlackQueueSyncProgress: (p: { total: number; completed: number } | null) => void;
};

const RoadmapReviewContext = createContext<Ctx | null>(null);

export function RoadmapReviewProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [slackQueueSyncing, setSlackQueueSyncing] = useState(false);
  const [slackQueueSyncProgress, setSlackQueueSyncProgress] = useState<{
    total: number;
    completed: number;
  } | null>(null);
  const openSheet = useCallback(() => setOpen(true), []);
  const closeSheet = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({
      open,
      setOpen,
      openSheet,
      closeSheet,
      slackQueueSyncing,
      setSlackQueueSyncing,
      slackQueueSyncProgress,
      setSlackQueueSyncProgress,
    }),
    [open, setOpen, openSheet, closeSheet, slackQueueSyncing, slackQueueSyncProgress]
  );
  return (
    <RoadmapReviewContext.Provider value={value}>
      {children}
    </RoadmapReviewContext.Provider>
  );
}

export function useRoadmapReview() {
  const c = useContext(RoadmapReviewContext);
  if (!c) {
    throw new Error("useRoadmapReview must be used within RoadmapReviewProvider");
  }
  return c;
}
