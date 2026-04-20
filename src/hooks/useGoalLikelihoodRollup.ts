"use client";

import { useEffect, useMemo, useState } from "react";
import type { GoalWithProjects, Person } from "@/lib/types/tracker";
import {
  computeGoalLikelihoodRollup,
  type GoalLikelihoodRollup,
} from "@/lib/goalLikelihoodRollup";
import { readCachedMilestoneLikelihood } from "@/hooks/useMilestoneLikelihood";

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

  const [pollTick, setPollTick] = useState(0);

  const rollup = useMemo((): GoalLikelihoodRollup | null => {
    if (!enabled) return null;
    return computeGoalLikelihoodRollup(
      goal,
      peopleById,
      readCachedMilestoneLikelihood
    );
  }, [enabled, goal, peopleById, pollTick]);

  /** Poll only while we're waiting for child milestone likelihoods to land in the cache. */
  const needsPoll = Boolean(enabled && rollup && !rollup.ready);

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
