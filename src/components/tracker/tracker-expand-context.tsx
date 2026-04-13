"use client";

import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/** Expansion preset for the roadmap tree (toolbar dropdown + bulk apply tick) */
export type TrackerExpandPreset =
  | "goals_only"
  | "goals_and_projects"
  | "goals_projects_milestones"
  | "collapse"
  | null;

export type TrackerExpandBulk = {
  bulkTick: number;
  expandPreset: TrackerExpandPreset;
  /** Focus (single drill-in): at most one goal and one project expanded at a time */
  focusProjectMode: boolean;
  /** Which goal row is expanded in single-project mode; null means none */
  focusedGoalId: string | null;
  setFocusedGoalId: Dispatch<SetStateAction<string | null>>;
  /** Which project row is expanded in single-project mode; null means none */
  focusedProjectId: string | null;
  setFocusedProjectId: Dispatch<SetStateAction<string | null>>;
  /** Incremented when Focus mode is turned on to collapse other goals/projects */
  focusEnforceTick: number;
};

const TrackerExpandContext = createContext<TrackerExpandBulk | null>(null);

export function TrackerExpandProvider({
  value,
  children,
}: {
  value: TrackerExpandBulk;
  children: ReactNode;
}) {
  return (
    <TrackerExpandContext.Provider value={value}>
      {children}
    </TrackerExpandContext.Provider>
  );
}

export function useTrackerExpandBulk(): TrackerExpandBulk {
  const ctx = useContext(TrackerExpandContext);
  if (!ctx) {
    throw new Error("useTrackerExpandBulk must be used inside TrackerExpandProvider");
  }
  return ctx;
}
