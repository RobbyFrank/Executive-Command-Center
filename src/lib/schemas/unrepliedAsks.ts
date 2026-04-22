import { z } from "zod";

export const AskClassificationSchema = z.enum(["ask", "not_ask", "error"]);

export const AskEntryStateSchema = z.enum([
  "open",
  "dismissed",
  "nudged",
  "replied",
]);

export const AskChannelKindSchema = z.enum(["channel", "mpim"]);

/**
 * Emoji reaction on the ask message itself, refreshed on every scan from
 * `conversations.replies`. Rendered on the Followups row so the wall shows
 * teammate acknowledgments (e.g. eyes / thumbsup) even before a text reply.
 */
export const AskReactionSchema = z.object({
  /** Slack shortname, no colons (e.g. `thumbsup`, `white_check_mark`, custom workspace emoji). */
  name: z.string().min(1),
  count: z.number().int().min(1),
  /** User IDs that reacted; may also contain bot IDs. */
  users: z.array(z.string()).default([]),
});

export const AskEntrySchema = z.object({
  /** Stable id: `${channelId}|${ts}` */
  id: z.string().min(1),
  founderSlackUserId: z.string().min(1),
  founderPersonId: z.string().min(1),
  channelId: z.string().min(1),
  channelName: z.string(),
  channelKind: AskChannelKindSchema,
  ts: z.string().min(1),
  /** Same as ts for root messages; kept for clarity */
  threadTs: z.string().min(1),
  permalink: z.string().min(1),
  text: z.string(),
  classification: AskClassificationSchema,
  classifiedAt: z.string().min(1),
  /**
   * Classifier's single-person guess at ask time (may be null when the ask is
   * broadcast or the addressee isn't obvious). Kept for backwards-compat and
   * as a fallback when the thread has no teammate messages yet.
   */
  assigneeSlackUserId: z.string().optional(),
  /**
   * Effective assignees derived from the thread on each scan: the distinct
   * non-founder authors in the run of messages immediately before the ask
   * (walking back until we hit a founder message or the thread start).
   *
   * - `[Robby(founder), Ghulam, Robby(ask)]` → `[Ghulam]`
   * - `[Robby(founder), James, Dave, Robby(ask)]` → `[Dave, James]` (most-recent first)
   *
   * The UI groups by this set when present; `assigneeSlackUserId` is only
   * used when this is empty (e.g. the ask is the only message in the thread).
   * Uppercased `U…` / `W…` ids.
   */
  effectiveAssigneeSlackUserIds: z.array(z.string()).optional(),
  lastReplyTs: z.string().optional(),
  lastExternalReplyTs: z.string().optional(),
  hasExternalReply: z.boolean(),
  /** Reactions on the ask message (refreshed on each scan from conversations.replies). */
  reactions: z.array(AskReactionSchema).optional(),
  firstSurfacedAt: z.string().optional(),
  state: AskEntryStateSchema,
  nudgedAt: z.string().optional(),
  dismissedAt: z.string().optional(),
  /** When set and `Date.now() < snoozeUntil`, entry is hidden from the wall */
  snoozeUntil: z.string().optional(),
});

/**
 * Per-founder high-water mark: the newest Slack `ts` we have fetched (and persisted)
 * for that founder. Keyed by the founder's Slack user ID (uppercased, `U…` form).
 *
 * The scanner uses this to fetch only messages **newer than** the watermark
 * (incremental fetch). When a founder has no watermark yet, the scan backfills
 * a fixed window (see `DEFAULT_INITIAL_BACKFILL_DAYS`).
 */
export const FounderWatermarksSchema = z.record(z.string(), z.string());

export const UnrepliedAsksDataSchema = z.object({
  revision: z.number().int().min(0),
  lastScanAt: z.string().optional(),
  /** Stored for backwards-compat; new scans use watermarks for incremental fetch. */
  lookbackDays: z.number().int().min(7).max(99).optional(),
  /** Per-founder newest-ts watermark (by Slack user id). */
  founderWatermarks: FounderWatermarksSchema.optional(),
  entries: z.array(AskEntrySchema),
});

export type AskClassification = z.infer<typeof AskClassificationSchema>;
export type AskEntryState = z.infer<typeof AskEntryStateSchema>;
export type AskChannelKind = z.infer<typeof AskChannelKindSchema>;
export type AskReaction = z.infer<typeof AskReactionSchema>;
export type AskEntry = z.infer<typeof AskEntrySchema>;
export type UnrepliedAsksData = z.infer<typeof UnrepliedAsksDataSchema>;
