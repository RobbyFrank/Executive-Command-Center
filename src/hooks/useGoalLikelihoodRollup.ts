"use client";

import { useEffect, useMemo, useState } from "react";
import type { GoalWithProjects, Person } from "@/lib/types/tracker";
import {
  computeGoalLikelihoodRollup,
  type GoalLikelihoodRollup,
} from "@/lib/goalLikelihoodRollup";
import { readCachedMilestoneLikelihood } from "@/hooks/useMilestoneLikelihood";
import { slackRosterHintsFromPeople } from "@/lib/slack-roster-hints";
import { readSlackThreadFreshness } from "@/lib/slackThreadFreshness";

export function useGoalLikelihoodRollup(
  goal: GoalWithProjects,
  people: Person[],
  /** When false (e.g. goal expanded), skips work and returns `rollup: null`. */
  enabled: boolean
): {
  rollup: GoalLikelihoodRollup | null;
  /** True while some assessable projects are still missing cached milestone likelihoods. */
  loading: boolean;
} {
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const rosterHints = useMemo(
    () => slackRosterHintsFromPeople(people),
    [people]
  );

  const [pollTick, setPollTick] = useState(0);

  const baseRollup = useMemo((): GoalLikelihoodRollup | null => {
    if (!enabled) return null;
    return computeGoalLikelihoodRollup(
      goal,
      peopleById,
      readCachedMilestoneLikelihood
    );
  }, [enabled, goal, peopleById, pollTick]);

  /**
   * Fold the freshest "last reply" signal across all threads under this goal into the rollup.
   * Read from the shared thread-status cache (same entries the milestone rows hydrate), so no
   * extra network calls are issued at the goal level. Re-evaluated on `pollTick` so the signal
   * picks up newly-hydrated thread statuses within a second of the row becoming visible.
   */
  const rollup = useMemo((): GoalLikelihoodRollup | null => {
    if (!baseRollup) return null;
    if (baseRollup.threadSlackUrls.length === 0) return baseRollup;
    const freshness = readSlackThreadFreshness(
      baseRollup.threadSlackUrls,
      rosterHints
    );
    if (freshness === baseRollup.freshness) return baseRollup;
    return { ...baseRollup, freshness };
  }, [baseRollup, rosterHints, pollTick]);

  /**
   * Poll while either (a) child milestone likelihoods are still landing in the cache, or
   * (b) the thread freshness signal hasn't populated yet — the thread-status cache is hydrated
   * asynchronously by {@link useSlackThreadStatus} in each milestone row, so the first few paints
   * may not see any entries yet. The existing 1s cadence is cheap (pure cache reads).
   */
  const needsPoll = Boolean(
    enabled &&
      rollup &&
      (!rollup.ready ||
        (rollup.threadSlackUrls.length > 0 && rollup.freshness === null))
  );

  useEffect(() => {
    if (!needsPoll) return;
    const id = window.setInterval(() => {
      setPollTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [needsPoll]);

  const loading = Boolean(
    rollup &&
      !rollup.ready &&
      rollup.coverage.total > 0 &&
      rollup.coverage.cached < rollup.coverage.total
  );

  return { rollup, loading };
}
