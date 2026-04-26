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
};

const RoadmapReviewContext = createContext<Ctx | null>(null);

export function RoadmapReviewProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(() => setOpen(true), []);
  const closeSheet = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, setOpen, openSheet, closeSheet }),
    [open, setOpen, openSheet, closeSheet]
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
