"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readBrowserJsonCache, writeBrowserJsonCache } from "@/lib/browserJsonCache";
import { assessGoalOneLiner } from "@/server/actions/ai/goal-one-liner";
import type { GoalLikelihoodRollup } from "@/lib/goalLikelihoodRollup";

const LS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const GOAL_ONE_LINER_CACHE_PREFIX = "gol:v1:";
const GOAL_ONE_LINER_SCHEMA_VERSION = 1 as const;

type StoredBlob = {
  schemaVersion: typeof GOAL_ONE_LINER_SCHEMA_VERSION;
  summaryLine: string;
};

function normalizePayload(raw: unknown): StoredBlob | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (Number(o.schemaVersion) !== GOAL_ONE_LINER_SCHEMA_VERSION) return undefined;
  if (typeof o.summaryLine === "string" && o.summaryLine.trim()) {
    return {
      schemaVersion: GOAL_ONE_LINER_SCHEMA_VERSION,
      summaryLine: o.summaryLine.trim(),
    };
  }
  return undefined;
}

function cacheContentKey(
  goalId: string,
  goalDescription: string,
  rollup: GoalLikelihoodRollup
): string {
  const payload = {
    schema: GOAL_ONE_LINER_SCHEMA_VERSION,
    goalId,
    description: goalDescription.trim(),
    onTime: rollup.onTimeLikelihood,
    risk: rollup.riskLevel,
    aiConf: rollup.aiConfidence,
    projects: rollup.projectSummaries.map((s) => ({
      p: s.projectName,
      m: s.milestoneName,
      line: s.summaryLine,
      l: s.likelihood,
      r: s.riskLevel,
      pe: s.progressEstimate,
    })),
  };
  return `${GOAL_ONE_LINER_CACHE_PREFIX}${JSON.stringify(payload)}`;
}

export function useGoalOneLiner(
  goalId: string,
  goalDescription: string,
  rollup: GoalLikelihoodRollup | null,
  /** Fetch only when goal row needs the strip (e.g. collapsed) and rollup is fully ready. */
  enabled: boolean
): {
  summaryLine: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [summaryLine, setSummaryLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const rollupSig = useMemo(() => {
    if (!rollup?.ready) return "";
    return cacheContentKey(goalId, goalDescription, rollup);
  }, [goalId, goalDescription, rollup]);

  /** Latest rollup snapshot — used inside the async effect so we don't have to depend on its identity. */
  const rollupRef = useRef<GoalLikelihoodRollup | null>(rollup);
  rollupRef.current = rollup;
  const goalDescriptionRef = useRef(goalDescription);
  goalDescriptionRef.current = goalDescription;

  const skipCacheNextRef = useRef(false);
  /**
   * In-flight signatures: prevents a 1s poll tick from cancelling + restarting
   * an identical `assessGoalOneLiner` call while the previous one is still pending.
   */
  const inFlightSigRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    skipCacheNextRef.current = true;
    setRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !rollupSig) {
      setSummaryLine(null);
      setError(null);
      setLoading(false);
      inFlightSigRef.current = null;
      return;
    }

    const skipCache = skipCacheNextRef.current;
    skipCacheNextRef.current = false;

    if (!skipCache) {
      const fromLs = readBrowserJsonCache<unknown>(rollupSig, LS_TTL_MS);
      if (fromLs) {
        const normalized = normalizePayload(fromLs.payload);
        if (normalized) {
          setSummaryLine(normalized.summaryLine);
          setError(null);
          setLoading(false);
          return;
        }
      }
    }

    /** Same signature already fetching — don't cancel it, don't start another. */
    if (inFlightSigRef.current === rollupSig) return;

    inFlightSigRef.current = rollupSig;
    const fetchSig = rollupSig;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const snapshot = rollupRef.current;
        if (!snapshot?.ready) return;
        const r = await assessGoalOneLiner({
          goalDescription: goalDescriptionRef.current,
          projectSummaries: snapshot.projectSummaries,
          rollupLikelihood: snapshot.onTimeLikelihood,
          rollupRiskLevel: snapshot.riskLevel,
          rollupAiConfidence: snapshot.aiConfidence,
        });
        if (r.ok) {
          const blob: StoredBlob = {
            schemaVersion: GOAL_ONE_LINER_SCHEMA_VERSION,
            summaryLine: r.summaryLine,
          };
          writeBrowserJsonCache(fetchSig, blob);
        }
        /** Signature changed while we were fetching — stored under the old key; latest effect run will pick it up. */
        if (inFlightSigRef.current !== fetchSig) return;
        if (r.ok) {
          setSummaryLine(r.summaryLine);
          setError(null);
        } else {
          setSummaryLine(null);
          setError(r.error);
        }
      } catch (e) {
        if (inFlightSigRef.current !== fetchSig) return;
        setSummaryLine(null);
        setError(e instanceof Error ? e.message : "Goal summary failed");
      } finally {
        if (inFlightSigRef.current === fetchSig) {
          inFlightSigRef.current = null;
          setLoading(false);
        }
      }
    })();
  }, [enabled, rollupSig, refreshNonce]);

  return { summaryLine, loading, error, refresh };
}
