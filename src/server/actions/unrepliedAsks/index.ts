"use server";

import { revalidatePath } from "next/cache";
import { trimSlackUserId } from "@/lib/loginSlackMessage";
import type { AskEntry } from "@/lib/schemas/unrepliedAsks";
import {
  clampLookbackDays,
  DEFAULT_UNREPLIED_LOOKBACK_DAYS,
  isAskSurfacedOnWall,
} from "@/lib/unrepliedAsksFilters";
import type { Person } from "@/lib/types/tracker";
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
import { getRepository } from "@/server/repository";
import {
  mutateUnrepliedAsks,
  readUnrepliedAsks,
} from "@/server/repository/unreplied-asks-storage";
import { getSlackPosterAuthContext } from "@/server/actions/slack/poster-preview";
import type { SlackMemberRosterHint } from "@/server/actions/slack/thread-ai-shared";
import { resolveSlackUserDisplays } from "@/server/actions/slack/user-profile";
import { runUnrepliedAsksScan } from "./scan";

/**
 * Resolved display info for one assignee (roster-first, Slack profile cache fallback).
 * `onRoster === false` is what drives the "Add to Team" CTA on the group header.
 */
export type UnrepliedAskAssigneeDisplay = {
  slackUserId: string;
  name: string;
  profilePicturePath?: string;
  onRoster: boolean;
};

export type UnrepliedAskSnapshotRow = {
  entry: AskEntry;
  founderName: string;
  founderProfilePicturePath?: string;
  /**
   * Effective assignees for grouping on the wall, most-recent first.
   *
   * Sourced from `entry.effectiveAssigneeSlackUserIds` when the scan
   * computed it from the thread (the last run of non-founder messages before
   * the ask). Falls back to `[entry.assigneeSlackUserId]` when the thread has
   * no teammate messages yet (ask is the only message), and is empty when
   * neither signal is available.
   */
  assignees: UnrepliedAskAssigneeDisplay[];
  /** Resolved name for the **primary** (most-recent) assignee; kept for back-compat with existing consumers. */
  assigneeName: string | null;
  assigneeProfilePicturePath?: string;
  /** `true` iff **every** effective assignee is on the Team roster. */
  assigneeOnRoster: boolean;
  /** True when the Slack user token posts as someone other than the message author. */
  posterMismatch: boolean;
};

export type UnrepliedAsksSnapshot = {
  rows: UnrepliedAskSnapshotRow[];
  lookbackDays: number;
  lastScanAt: string | null;
  posterSlackUserId: string | null;
  posterDisplayName: string;
  rosterHints: SlackMemberRosterHint[];
};

function buildRosterHints(people: Person[]): SlackMemberRosterHint[] {
  const out: SlackMemberRosterHint[] = [];
  for (const p of people) {
    const slackUserId = trimSlackUserId(p.slackHandle);
    if (!slackUserId) continue;
    const hint: SlackMemberRosterHint = {
      slackUserId,
      name: p.name,
    };
    const pic = p.profilePicturePath?.trim();
    if (pic) hint.profilePicturePath = pic;
    out.push(hint);
  }
  return out;
}

function personBySlackId(
  people: Person[]
): Map<string, Person> {
  const m = new Map<string, Person>();
  for (const p of people) {
    const id = trimSlackUserId(p.slackHandle);
    if (id) m.set(id, p);
  }
  return m;
}

/**
 * Picks the effective assignees for an entry as an ordered array of uppercase
 * Slack user ids (most-recent first). Prefers the scan-computed list derived
 * from thread messages, and only falls back to the classifier's single guess
 * when the scan couldn't compute one (e.g. the thread has no teammate
 * messages yet because the ask is the only message).
 */
function resolveEffectiveAssigneeIds(entry: AskEntry): string[] {
  const fromThread = (entry.effectiveAssigneeSlackUserIds ?? [])
    .map((id) => id.trim().toUpperCase())
    .filter(Boolean);
  if (fromThread.length > 0) return [...new Set(fromThread)];
  const fromClassifier = entry.assigneeSlackUserId?.trim().toUpperCase();
  return fromClassifier ? [fromClassifier] : [];
}

/**
 * Surfaced rows for the Followups wall + poster context for attribution warnings.
 */
export async function getUnrepliedAsksSnapshot(
  people: Person[]
): Promise<UnrepliedAsksSnapshot> {
  const data = await readUnrepliedAsks();
  const lookbackDays = clampLookbackDays(
    data.lookbackDays ?? DEFAULT_UNREPLIED_LOOKBACK_DAYS
  );
  const now = new Date();
  const bySlack = personBySlackId(people);
  const poster = await getSlackPosterAuthContext();

  /**
   * First pass: decide which entries surface on the wall and collect the set
   * of off-roster assignee IDs across **all** effective assignees so we can
   * resolve their Slack profiles in one batch (cache-backed via
   * `resolveSlackUserDisplays`).
   */
  const surfaced: {
    entry: AskEntry;
    assigneeIds: string[];
  }[] = [];
  const offRosterIds = new Set<string>();
  for (const entry of data.entries) {
    if (!isAskSurfacedOnWall(entry, lookbackDays, now)) continue;
    const assigneeIds = resolveEffectiveAssigneeIds(entry);
    for (const id of assigneeIds) {
      if (!bySlack.has(id)) offRosterIds.add(id);
    }
    surfaced.push({ entry, assigneeIds });
  }

  const slackDisplays =
    offRosterIds.size > 0
      ? await resolveSlackUserDisplays([...offRosterIds])
      : {};

  const rows: UnrepliedAskSnapshotRow[] = [];
  for (const { entry, assigneeIds } of surfaced) {
    const founder = people.find((p) => p.id === entry.founderPersonId);
    const assignees: UnrepliedAskAssigneeDisplay[] = [];
    for (const id of assigneeIds) {
      const rosterHit = bySlack.get(id);
      const fallback = slackDisplays[id];
      const name =
        rosterHit?.name?.trim() || fallback?.name?.trim() || id;
      const profilePicturePath =
        rosterHit?.profilePicturePath?.trim() ||
        fallback?.avatarSrc ||
        undefined;
      assignees.push({
        slackUserId: id,
        name,
        profilePicturePath,
        onRoster: Boolean(rosterHit),
      });
    }

    const primary = assignees[0];
    const allOnRoster =
      assignees.length > 0 && assignees.every((a) => a.onRoster);

    rows.push({
      entry,
      founderName: founder?.name?.trim() || "Unknown",
      founderProfilePicturePath:
        founder?.profilePicturePath?.trim() || undefined,
      assignees,
      assigneeName: primary?.name ?? null,
      assigneeProfilePicturePath: primary?.profilePicturePath,
      // Kept as "all assignees are on the roster" so the "Add to Team" CTA
      // appears whenever at least one assignee still needs importing.
      assigneeOnRoster: allOnRoster,
      posterMismatch: Boolean(
        poster.slackUserId &&
          entry.founderSlackUserId.trim().toUpperCase() !== poster.slackUserId
      ),
    });
  }

  rows.sort((a, b) => parseFloat(b.entry.ts) - parseFloat(a.entry.ts));

  return {
    rows,
    lookbackDays,
    lastScanAt: data.lastScanAt ?? null,
    posterSlackUserId: poster.slackUserId,
    posterDisplayName: poster.displayName,
    rosterHints: buildRosterHints(people),
  };
}

/** Badge count in the sidebar (same filter as the wall). */
export async function getUnrepliedAsksOpenCount(): Promise<number> {
  const data = await readUnrepliedAsks();
  const lookbackDays = clampLookbackDays(
    data.lookbackDays ?? DEFAULT_UNREPLIED_LOOKBACK_DAYS
  );
  const now = new Date();
  let n = 0;
  for (const entry of data.entries) {
    if (isAskSurfacedOnWall(entry, lookbackDays, now)) n += 1;
  }
  return n;
}

export async function setUnrepliedLookbackDays(
  days: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const d = clampLookbackDays(days);
  try {
    await mutateUnrepliedAsks((draft) => {
      draft.lookbackDays = d;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
  revalidatePath("/unreplied");
  revalidatePath("/", "layout");
  return { ok: true };
}

export type RefreshUnrepliedAsksResult =
  | {
      ok: true;
      newClassified: number;
      threadRefreshes: number;
      threadErrors: number;
      founderCount: number;
    }
  | { ok: false; error: string };

export async function refreshUnrepliedAsks(): Promise<RefreshUnrepliedAsksResult> {
  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return {
      ok: false,
      error: `Too many AI requests. Try again in ${rate.retryAfterSeconds}s.`,
    };
  }

  const people = await getRepository().getPeople();
  const scan = await runUnrepliedAsksScan(people);
  if (!scan.ok) return scan;

  revalidatePath("/unreplied");
  revalidatePath("/", "layout");
  return scan;
}

export async function dismissUnrepliedAsk(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Missing id." };
  try {
    await mutateUnrepliedAsks((draft) => {
      const e = draft.entries.find((x) => x.id === trimmed);
      if (e && e.state === "open") {
        e.state = "dismissed";
        e.dismissedAt = new Date().toISOString();
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
  revalidatePath("/unreplied");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function snoozeUnrepliedAsk(
  id: string,
  days: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Missing id." };
  const d = Math.min(30, Math.max(1, Math.floor(Number(days))));
  if (!Number.isFinite(d)) return { ok: false, error: "Invalid days." };
  const until = new Date(Date.now() + d * 86_400_000).toISOString();
  try {
    await mutateUnrepliedAsks((draft) => {
      const e = draft.entries.find((x) => x.id === trimmed);
      if (e && e.state === "open") {
        e.snoozeUntil = until;
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
  revalidatePath("/unreplied");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markUnrepliedAskNudged(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Missing id." };
  try {
    await mutateUnrepliedAsks((draft) => {
      const e = draft.entries.find((x) => x.id === trimmed);
      if (e && e.state === "open") {
        e.state = "nudged";
        e.nudgedAt = new Date().toISOString();
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
  revalidatePath("/unreplied");
  revalidatePath("/", "layout");
  return { ok: true };
}
