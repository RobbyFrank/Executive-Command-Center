"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assessMilestoneOnTimeLikelihood,
  type MilestoneLikelihoodResult,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { readBrowserJsonCache, writeBrowserJsonCache } from "@/lib/browserJsonCache";
import { runWithLikelihoodConcurrency } from "@/lib/likelihoodAssessQueue";

/** localStorage retention for cached assessments (semantic invalidation uses thread reply counts). */
const LS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Bump when cached shape changes (e.g. added `threadSummaryLine`) — invalidates prior LS + memory entries. */
const LIKELIHOOD_CACHE_LS_PREFIX = "mlh:v2:";
const LIKELIHOOD_CACHE_SCHEMA_VERSION = 2 as const;

type OkResult = Extract<MilestoneLikelihoodResult, { ok: true }>;

function withThreadSummaryLine(r: OkResult): OkResult {
  return {
    ...r,
    threadSummaryLine:
      typeof r.threadSummaryLine === "string" ? r.threadSummaryLine : "",
  };
}

type CacheEntry = {
  storedAt: number;
  result: OkResult;
  /** Reply total from `fetchSlackThreadStatus` when this assessment was stored; `null` = legacy entry. */
  replyCountAtAssessment: number | null;
  schemaVersion: typeof LIKELIHOOD_CACHE_SCHEMA_VERSION;
};

/** Persisted JSON (outer envelope is added by `writeBrowserJsonCache`). */
type StoredLikelihoodBlob = {
  schemaVersion: typeof LIKELIHOOD_CACHE_SCHEMA_VERSION;
  result: OkResult;
  replyCountAtAssessment: number | null;
};

const store = new Map<string, CacheEntry>();

function lsKey(k: string): string {
  return `${LIKELIHOOD_CACHE_LS_PREFIX}${k}`;
}

/** Removes a cache entry from the in-memory map (both full + minimal keys may reference it). */
function removeStoreEntry(entry: CacheEntry): void {
  for (const [mapKey, val] of store) {
    if (val === entry) store.delete(mapKey);
  }
}

function cacheKey(
  slackUrl: string,
  targetDate: string,
  ownerAutonomy: number | null,
  projectComplexity: number,
  roadmapContext: string | undefined
): string {
  const ctx = (roadmapContext ?? "").trim();
  return `${slackUrl}::${targetDate.trim()}::${ownerAutonomy ?? "x"}::${projectComplexity}::${ctx}`;
}

function minimalLikelihoodKey(
  slackUrl: string,
  targetDate: string,
  ownerAutonomy: number | null,
  projectComplexity: number
): string {
  return `${slackUrl}::${targetDate.trim()}::${ownerAutonomy ?? "x"}::${projectComplexity}`;
}

function normalizeLsPayload(raw: unknown): StoredLikelihoodBlob | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (Number(o.schemaVersion) !== LIKELIHOOD_CACHE_SCHEMA_VERSION) {
    return undefined;
  }
  if (
    "result" in o &&
    o.result &&
    typeof o.result === "object" &&
    o.result !== null &&
    "likelihood" in o.result
  ) {
    return {
      schemaVersion: LIKELIHOOD_CACHE_SCHEMA_VERSION,
      result: withThreadSummaryLine(o.result as OkResult),
      replyCountAtAssessment:
        typeof o.replyCountAtAssessment === "number"
          ? o.replyCountAtAssessment
          : null,
    };
  }
  return undefined;
}

function readFreshEntry(k: string): CacheEntry | undefined {
  const e = store.get(k);
  if (e) {
    if (e.schemaVersion !== LIKELIHOOD_CACHE_SCHEMA_VERSION) {
      removeStoreEntry(e);
      return undefined;
    }
    return {
      ...e,
      result: withThreadSummaryLine(e.result),
    };
  }

  const fromLs = readBrowserJsonCache<unknown>(lsKey(k), LS_TTL_MS);
  if (!fromLs) return undefined;
  const normalized = normalizeLsPayload(fromLs.payload);
  if (!normalized) return undefined;
  const entry: CacheEntry = {
    storedAt: fromLs.storedAt,
    schemaVersion: LIKELIHOOD_CACHE_SCHEMA_VERSION,
    result: withThreadSummaryLine(normalized.result),
    replyCountAtAssessment: normalized.replyCountAtAssessment,
  };
  store.set(k, entry);
  return entry;
}

/** Cached milestone on-time assessment (read-only); same shape as `assessMilestoneOnTimeLikelihood` success. */
export type MilestoneLikelihoodCachedOk = OkResult;

/**
 * Read a milestone likelihood from the shared browser cache without triggering a fetch.
 * Uses the minimal cache key (ignores `roadmapContext`) so it matches stored entries from any context.
 */
export function readCachedMilestoneLikelihood(args: {
  slackUrl: string;
  targetDate: string;
  ownerAutonomy: number | null;
  projectComplexity: number;
}): MilestoneLikelihoodCachedOk | null {
  const u = args.slackUrl.trim();
  const d = args.targetDate.trim();
  if (!u || !d) return null;
  const mk = minimalLikelihoodKey(
    u,
    d,
    args.ownerAutonomy,
    args.projectComplexity
  );
  const hit = readFreshEntry(mk);
  return hit ? withThreadSummaryLine(hit.result) : null;
}

function writeEntry(
  fullKey: string,
  minimalKey: string,
  result: OkResult,
  replyCountAtAssessment: number
): void {
  const now = Date.now();
  const entry: CacheEntry = {
    storedAt: now,
    schemaVersion: LIKELIHOOD_CACHE_SCHEMA_VERSION,
    result,
    replyCountAtAssessment,
  };
  store.set(fullKey, entry);
  store.set(minimalKey, entry);
  const blob: StoredLikelihoodBlob = {
    schemaVersion: LIKELIHOOD_CACHE_SCHEMA_VERSION,
    result,
    replyCountAtAssessment,
  };
  writeBrowserJsonCache(lsKey(fullKey), blob);
  writeBrowserJsonCache(lsKey(minimalKey), blob);
}

function shouldRunAssessment(
  cached: CacheEntry | undefined,
  currentReplyCount: number | null,
  force: boolean
): boolean {
  if (force) return true;
  if (currentReplyCount === null) return false;
  if (!cached) return true;
  if (cached.replyCountAtAssessment === null) return true;
  return cached.replyCountAtAssessment !== currentReplyCount;
}

type AssessOutcome =
  | { kind: "ok"; result: OkResult }
  | { kind: "err"; message: string };

/** Same milestone shown in two places (e.g. strip + row) shares one in-flight Claude call. */
const pendingAssessByKey = new Map<string, Promise<AssessOutcome>>();

export type UseMilestoneLikelihoodArgs = {
  slackUrl: string | null;
  milestoneName: string;
  targetDate: string;
  ownerAutonomy: number | null;
  projectComplexity: number;
  rosterHints: SlackMemberRosterHint[];
  roadmapContext?: string;
  /**
   * From `fetchSlackThreadStatus` after the row finishes loading.
   * `null` while loading or when thread fetch failed — skips auto-assess until a reply count is known.
   */
  threadReplyCount: number | null;
};

export function useMilestoneLikelihood({
  slackUrl,
  milestoneName,
  targetDate,
  ownerAutonomy,
  projectComplexity,
  rosterHints,
  roadmapContext,
  threadReplyCount,
}: UseMilestoneLikelihoodArgs) {
  const key = useMemo(() => {
    if (!slackUrl || !targetDate.trim()) return "";
    return cacheKey(
      slackUrl,
      targetDate,
      ownerAutonomy,
      projectComplexity,
      roadmapContext
    );
  }, [
    slackUrl,
    targetDate,
    ownerAutonomy,
    projectComplexity,
    roadmapContext,
  ]);

  const minimalKey = useMemo(() => {
    if (!slackUrl || !targetDate.trim()) return "";
    return minimalLikelihoodKey(
      slackUrl,
      targetDate,
      ownerAutonomy,
      projectComplexity
    );
  }, [slackUrl, targetDate, ownerAutonomy, projectComplexity]);

  const [result, setResult] = useState<OkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key || !minimalKey) {
      setResult(null);
      setError(null);
      return;
    }
    const hit = readFreshEntry(key) ?? readFreshEntry(minimalKey);
    if (hit) {
      setResult(hit.result);
      setError(null);
    } else {
      setResult(null);
      setError(null);
    }
  }, [key, minimalKey]);

  const assess = useCallback(
    async (options?: { force?: boolean }) => {
      if (!slackUrl || !targetDate.trim()) {
        setResult(null);
        setError(null);
        return;
      }
      if (!key || !minimalKey) return;

      const force = options?.force === true;
      const cached = readFreshEntry(key) ?? readFreshEntry(minimalKey);

      if (!force) {
        if (!shouldRunAssessment(cached, threadReplyCount, false)) {
          if (cached) {
            setResult(cached.result);
            setError(null);
          }
          return;
        }
        if (threadReplyCount === null) return;
      } else if (threadReplyCount === null) {
        if (cached) {
          setResult(cached.result);
          setError(null);
        }
        return;
      }

      setLoading(true);
      setError(null);

      let promise = pendingAssessByKey.get(minimalKey);
      if (!promise) {
        promise = (async (): Promise<AssessOutcome> => {
          try {
            const r = await runWithLikelihoodConcurrency(() =>
              assessMilestoneOnTimeLikelihood(
                slackUrl,
                milestoneName,
                targetDate,
                ownerAutonomy,
                projectComplexity,
                rosterHints,
                roadmapContext
              )
            );
            if (!r.ok) return { kind: "err", message: r.error };
            const rc = threadReplyCount ?? 0;
            const patched = withThreadSummaryLine(r);
            writeEntry(key, minimalKey, patched, rc);
            return { kind: "ok", result: patched };
          } catch (e) {
            const message =
              e instanceof Error ? e.message : "Likelihood assessment failed";
            return { kind: "err", message };
          }
        })().finally(() => {
          pendingAssessByKey.delete(minimalKey);
        });
        pendingAssessByKey.set(minimalKey, promise);
      }

      try {
        const outcome = await promise;
        if (outcome.kind === "err") {
          setError(outcome.message);
          setResult(null);
        } else {
          setError(null);
          setResult(outcome.result);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      key,
      minimalKey,
      slackUrl,
      milestoneName,
      targetDate,
      ownerAutonomy,
      projectComplexity,
      rosterHints,
      roadmapContext,
      threadReplyCount,
    ]
  );

  const assessFnRef = useRef(assess);
  assessFnRef.current = assess;

  /** After thread metadata loads: assess if never stored, legacy cache, or reply count changed. */
  useEffect(() => {
    if (!key || !minimalKey || !slackUrl || !targetDate.trim()) return;
    if (threadReplyCount === null) return;

    const cached = readFreshEntry(key) ?? readFreshEntry(minimalKey);
    if (!shouldRunAssessment(cached, threadReplyCount, false)) {
      if (cached) {
        setResult(cached.result);
        setError(null);
      }
      return;
    }

    void assessFnRef.current();
  }, [key, minimalKey, slackUrl, targetDate, threadReplyCount]);

  return { result, loading, error, assess };
}
