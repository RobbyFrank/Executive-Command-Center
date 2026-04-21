"use server";

import type { Person } from "@/lib/types/tracker";
import {
  fetchSlackJoinDateFromProfileGet,
  fetchSlackUserById,
  logSlackJoinDate,
} from "@/lib/slack";
import { SLACK_REFRESH_NO_NEW_DATA_MESSAGE } from "@/lib/slack-refresh-messages";
import {
  deleteFileIfInUploads,
  savePersonProfileFromRemoteUrl,
} from "@/server/imageFiles";
import { getPeople, updatePerson } from "@/server/actions/tracker";
import { buildSlackMessageEnrichmentForUser } from "./roster-enrich-from-messages";

export type RefreshPersonResult =
  | { ok: true; person: Person; avatarWarning?: string }
  | { ok: false; error: string };

/**
 * Collects department labels currently in use on the roster (minus the passed-in person
 * whose own value may be blank). Used to anchor the AI when inferring a new member's
 * department from Slack messages, so "Engineering" doesn't get re-proposed as
 * "Engineers" when the team already has the former.
 */
function collectKnownDepartments(
  people: Person[],
  excludePersonId?: string
): string[] {
  const set = new Set<string>();
  for (const p of people) {
    if (excludePersonId && p.id === excludePersonId) continue;
    const d = p.department?.trim();
    if (d) set.add(d);
  }
  return [...set];
}

/**
 * Fetches the latest profile from Slack for a person that already has a `slackHandle`.
 * Updates name, email, join date, and profile picture (Blob). Join date is resolved from
 * **`users.profile.get`** first (Atlas `start_date` and ISO dates in custom fields), then falls
 * back to `users.info` data from `fetchSlackUserById` — matching Import-from-Slack enrichment.
 * Does **not** touch other roster fields.
 */
export async function refreshPersonFromSlack(
  personId: string,
  slackHandle: string
): Promise<RefreshPersonResult> {
  const slackId = slackHandle.trim().toUpperCase();
  if (!slackId) {
    return { ok: false, error: "No Slack user ID on this team member." };
  }

  const lookup = await fetchSlackUserById(slackId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }

  const m = lookup.member;
  const name = m.realName || m.displayName || undefined;
  const email = (m.email ?? "").trim() || undefined;
  /** Always prefer `users.profile:read` / `users.profile.get` for hire/org date (often absent on `users.info`). */
  const fromProfileGet = (await fetchSlackJoinDateFromProfileGet(m.id)).trim();
  const fromMember = (m.joinDate ?? "").trim();
  const joinDate = fromProfileGet || fromMember;

  logSlackJoinDate("refreshPersonFromSlack merge", {
    personId,
    slackUserId: m.id,
    fromProfileGet: fromProfileGet || "(empty)",
    fromMemberFallback: fromMember || "(empty)",
    finalJoinDate: joinDate || "(empty)",
    willSetJoinDate: Boolean(joinDate),
  });

  const updates: Partial<Person> = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (joinDate) updates.joinDate = joinDate;

  let avatarWarning: string | undefined;
  const avatarUrl = (m.avatarUrl ?? "").trim();
  if (avatarUrl && process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    const saved = await savePersonProfileFromRemoteUrl({
      personId,
      imageUrl: avatarUrl,
    });
    if (saved.ok) {
      const people = await getPeople();
      const existing = people.find((p) => p.id === personId);
      const prev = existing?.profilePicturePath;
      updates.profilePicturePath = saved.webPath;
      if (prev && prev !== saved.webPath) {
        try {
          await deleteFileIfInUploads(prev);
        } catch {
          /* best-effort cleanup */
        }
      }
    } else {
      avatarWarning = saved.error;
    }
  } else if (avatarUrl && !process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    avatarWarning =
      "Profile photo not updated — BLOB_READ_WRITE_TOKEN is not set.";
  }

  /**
   * Message-based enrichment — only reaches out to Slack `search.messages` when at least
   * one of the inferred fields (role/department, join date) is actually missing on the
   * roster row *after* profile data was applied. Empty role AND a join date we just set
   * still skips the AI call, which keeps refresh latency reasonable for "everything is
   * already filled in" rows.
   */
  const peopleBefore = await getPeople();
  const existingPerson = peopleBefore.find((p) => p.id === personId);
  const currentRole = (existingPerson?.role ?? "").trim();
  /** Effective join date after profile data — empty means we STILL need a fallback. */
  const effectiveJoinDate = (
    updates.joinDate ??
    existingPerson?.joinDate ??
    ""
  ).trim();
  const wantRoleDept = currentRole === "";
  const wantJoinDate = effectiveJoinDate === "";

  if (wantRoleDept || wantJoinDate) {
    const knownDepartments = collectKnownDepartments(peopleBefore, personId);
    const enrichment = await buildSlackMessageEnrichmentForUser({
      slackUserId: m.id,
      skipRoleAndDepartment: !wantRoleDept,
      skipJoinDate: !wantJoinDate,
      knownDepartments,
    });

    logSlackJoinDate("refreshPersonFromSlack message-enrichment", {
      personId,
      slackUserId: m.id,
      messageCount: enrichment.messageCount,
      joinDateFromOldestMessage:
        enrichment.joinDateFromOldestMessage || "(empty)",
      roleGuess: enrichment.role ?? "(none)",
      departmentGuess: enrichment.department ?? "(none)",
      note: enrichment.note ?? "(ok)",
    });

    if (wantRoleDept && enrichment.role) {
      updates.role = enrichment.role;
    }
    if (
      wantRoleDept &&
      enrichment.department &&
      (existingPerson?.department ?? "").trim() === ""
    ) {
      updates.department = enrichment.department;
    }
    if (wantJoinDate && enrichment.joinDateFromOldestMessage) {
      updates.joinDate = enrichment.joinDateFromOldestMessage;
    }
  }

  if (Object.keys(updates).length === 0 && !avatarWarning) {
    return { ok: false, error: SLACK_REFRESH_NO_NEW_DATA_MESSAGE };
  }

  const person =
    Object.keys(updates).length > 0
      ? await updatePerson(personId, updates)
      : (await getPeople()).find((p) => p.id === personId)!;

  return { ok: true, person, avatarWarning };
}

export type RefreshAllFromSlackResult =
  | {
      ok: true;
      /** People with a non-empty Slack user ID. */
      withSlack: number;
      updated: number;
      unchanged: number;
      failed: number;
      failures: { name: string; error: string }[];
      avatarWarnings: string[];
    }
  | { ok: false; error: string };

/**
 * Sequentially runs the same refresh as **Refresh from Slack** for every roster row with a
 * `slackHandle`. Intended for bulk sync; may take a while on large teams.
 */
export async function refreshAllFromSlack(): Promise<RefreshAllFromSlackResult> {
  const people = await getPeople();
  const targets = people.filter((p) => (p.slackHandle ?? "").trim() !== "");
  if (targets.length === 0) {
    return {
      ok: true,
      withSlack: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      failures: [],
      avatarWarnings: [],
    };
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const failures: { name: string; error: string }[] = [];
  const avatarWarnings: string[] = [];

  for (const p of targets) {
    const handle = p.slackHandle!.trim();
    const r = await refreshPersonFromSlack(p.id, handle);
    if (r.ok) {
      updated += 1;
      if (r.avatarWarning) {
        avatarWarnings.push(`${p.name}: ${r.avatarWarning}`);
      }
    } else if (r.error === SLACK_REFRESH_NO_NEW_DATA_MESSAGE) {
      unchanged += 1;
    } else {
      failed += 1;
      failures.push({ name: p.name, error: r.error });
    }
  }

  return {
    ok: true,
    withSlack: targets.length,
    updated,
    unchanged,
    failed,
    failures,
    avatarWarnings,
  };
}
