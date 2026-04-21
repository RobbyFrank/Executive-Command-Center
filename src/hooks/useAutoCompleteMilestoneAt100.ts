"use client";

import { useEffect } from "react";
import { updateMilestone } from "@/server/actions/tracker";
import {
  readBrowserJsonCache,
  writeBrowserJsonCache,
} from "@/lib/browserJsonCache";
import type { MilestoneStatus } from "@/lib/types/tracker";

/**
 * When the AI-estimated progress for a milestone reaches 100%, flip its status to Done automatically.
 *
 * Guards (in order):
 *  1. `progressEstimate` must be exactly 100 — partial confidence (99, "about done") should not trigger.
 *  2. Current milestone status must be `Not Done`. If the user manually flipped it back to Not Done, we
 *     respect that until the AI re-assesses with new thread activity (see guard 3).
 *  3. Persisted (localStorage) "already attempted" marker keyed by milestone id + thread reply count.
 *     The AI only re-runs when `threadReplyCount` changes (see `useMilestoneLikelihood`), so keying on
 *     reply count lets us re-attempt auto-completion after fresh thread activity, but prevents a tight
 *     loop if the user reverts status and the same stale 100% reading is replayed from cache.
 *  4. Module-level in-flight set prevents double-fire from React strict mode, parallel hook
 *     instances (e.g. `MilestoneRow` and `ProjectRow` both subscribed to the same next-pending
 *     milestone), or effect re-runs with the same inputs.
 *
 * Safe to no-op: returns early when any of `milestoneId`, `progressEstimate`, or `threadReplyCount`
 * is missing/unknown.
 */

const AUTO_COMPLETE_LS_PREFIX = "ecc.autoMsDone.v1:";

type LastAttempt = {
  replyCount: number;
  attemptedAt: number;
};

function lsKey(milestoneId: string): string {
  return `${AUTO_COMPLETE_LS_PREFIX}${milestoneId}`;
}

/** LocalStorage marker lives ~90 days — long enough that repeat thread activity after a user
 *  reversion won't retrigger, but not forever (so a brand-new thread on the same milestone id
 *  still gets a chance). Matches the milestone likelihood cache TTL. */
const AUTO_COMPLETE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function readLastAttempt(milestoneId: string): LastAttempt | undefined {
  const hit = readBrowserJsonCache<LastAttempt>(
    lsKey(milestoneId),
    AUTO_COMPLETE_TTL_MS
  );
  if (!hit) return undefined;
  const p = hit.payload;
  if (
    !p ||
    typeof p.replyCount !== "number" ||
    typeof p.attemptedAt !== "number"
  ) {
    return undefined;
  }
  return p;
}

function writeLastAttempt(milestoneId: string, replyCount: number): void {
  writeBrowserJsonCache<LastAttempt>(lsKey(milestoneId), {
    replyCount,
    attemptedAt: Date.now(),
  });
}

/** Module-level dedupe so `MilestoneRow` + `ProjectRow` (both subscribed to the same next-pending
 *  milestone when a project is expanded) don't both fire `updateMilestone`. Keyed by
 *  `${milestoneId}::${replyCount}` — matches our "retry when thread activity changes" model. */
const attemptedKeys = new Set<string>();

export interface UseAutoCompleteMilestoneAt100Args {
  milestoneId: string | null | undefined;
  status: MilestoneStatus | null | undefined;
  /** Latest AI likelihood result — `null` while loading or before assessment. */
  progressEstimate: number | null | undefined;
  /**
   * Reply count at the time of the assessment. Used to gate re-attempts after user reversion.
   * `null` when unknown (loading / no Slack thread).
   */
  threadReplyCount: number | null;
}

export function useAutoCompleteMilestoneAt100({
  milestoneId,
  status,
  progressEstimate,
  threadReplyCount,
}: UseAutoCompleteMilestoneAt100Args): void {
  useEffect(() => {
    if (!milestoneId) return;
    if (status === "Done") return;
    if (progressEstimate !== 100) return;
    if (threadReplyCount === null || threadReplyCount === undefined) return;

    const attemptKey = `${milestoneId}::${threadReplyCount}`;
    if (attemptedKeys.has(attemptKey)) return;

    const prev = readLastAttempt(milestoneId);
    if (prev && prev.replyCount === threadReplyCount) {
      attemptedKeys.add(attemptKey);
      return;
    }

    attemptedKeys.add(attemptKey);
    writeLastAttempt(milestoneId, threadReplyCount);

    void updateMilestone(milestoneId, { status: "Done" }).catch(() => {
      /* Non-fatal: next assessment cycle may try again. The LS marker already recorded the attempt
         for this reply count, so we intentionally do NOT unmark on failure — that would risk a hot
         retry loop. A new thread message (reply count change) will unblock another attempt. */
    });
  }, [milestoneId, status, progressEstimate, threadReplyCount]);
}
