"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type CompanySectionOverlayContextValue = {
  /** Portaled previews (e.g. truncated cell tooltips) that should still “count” as interacting with this company block. */
  overlayCount: number;
  incrementOverlay: () => void;
  decrementOverlay: () => void;
};

const CompanySectionOverlayContext =
  createContext<CompanySectionOverlayContextValue | null>(null);

export function CompanySectionOverlayProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [overlayCount, setOverlayCount] = useState(0);
  const incrementOverlay = useCallback(
    () => setOverlayCount((c) => c + 1),
    []
  );
  const decrementOverlay = useCallback(
    () => setOverlayCount((c) => Math.max(0, c - 1)),
    []
  );
  const value = useMemo(
    () => ({ overlayCount, incrementOverlay, decrementOverlay }),
    [overlayCount, incrementOverlay, decrementOverlay]
  );
  return (
    <CompanySectionOverlayContext.Provider value={value}>
      {children}
    </CompanySectionOverlayContext.Provider>
  );
}

export function useCompanySectionOverlayOptional() {
  return useContext(CompanySectionOverlayContext);
}
