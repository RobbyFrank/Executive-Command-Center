"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSlackThreadStatus,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import type { Person } from "@/lib/types/tracker";
import {
  readSlackThreadStatusCache,
  writeSlackThreadStatusCache,
  type SlackThreadStatusOk,
} from "@/lib/slackThreadStatusCache";
import { slackRosterHintsFromPeople } from "@/lib/slack-roster-hints";

export type UseSlackThreadStatusResult = {
  status: SlackThreadStatusOk | null;
  loading: boolean;
  error: string | null;
  rosterHints: SlackMemberRosterHint[];
  statusCacheKey: string;
  /** Uses cache when fresh; pass `{ force: true }` after posting to Slack. */
  refresh: (options?: { force?: boolean }) => Promise<void>;
};

/**
 * Shared Slack thread metadata for a milestone URL (one fetch per row).
 */
export function useSlackThreadStatus(
  slackUrl: string | null,
  people: Person[]
): UseSlackThreadStatusResult {
  const rosterHints = useMemo(
    () => slackRosterHintsFromPeople(people),
    [people]
  );

  const statusCacheKey = useMemo(() => {
    if (!slackUrl) return "";
    if (rosterHints.length === 0) return slackUrl;
    const sig = rosterHints.map((h) => h.slackUserId).sort().join(",");
    return `${slackUrl}::team:${sig}`;
  }, [slackUrl, rosterHints]);

  const [status, setStatus] = useState<SlackThreadStatusOk | null>(null);
  const [loading, setLoading] = useState(Boolean(slackUrl));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slackUrl) {
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }
    const cached = readSlackThreadStatusCache(statusCacheKey);
    if (cached) {
      setStatus(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchSlackThreadStatus(slackUrl, rosterHints);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setStatus(null);
      return;
    }
    writeSlackThreadStatusCache(statusCacheKey, r);
    setStatus(r);
  }, [slackUrl, statusCacheKey, rosterHints]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!slackUrl) return;
      if (!options?.force) {
        const cached = readSlackThreadStatusCache(statusCacheKey);
        if (cached) {
          setStatus(cached);
          return;
        }
      }
      const r = await fetchSlackThreadStatus(slackUrl, rosterHints);
      if (r.ok) {
        writeSlackThreadStatusCache(statusCacheKey, r);
        setStatus(r);
      }
    },
    [slackUrl, rosterHints, statusCacheKey]
  );

  return {
    status,
    loading,
    error,
    rosterHints,
    statusCacheKey,
    refresh,
  };
}
