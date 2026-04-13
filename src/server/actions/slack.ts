"use server";

import type { Person } from "@/lib/types/tracker";
import {
  fetchSlackWorkspaceMembers,
  fetchSlackChannels as fetchSlackChannelsLib,
  fetchSlackUserById,
  fetchSlackJoinDateFromProfileGet,
  logSlackJoinDate,
} from "@/lib/slack";
import {
  savePersonProfileFromRemoteUrl,
  deleteFileIfInUploads,
} from "@/server/imageFiles";
import { createPerson, getPeople, updatePerson } from "@/server/actions/tracker";
import { SLACK_REFRESH_NO_NEW_DATA_MESSAGE } from "@/lib/slack-refresh-messages";

export async function fetchSlackMembers() {
  return fetchSlackWorkspaceMembers();
}

export async function fetchSlackChannelsList() {
  return fetchSlackChannelsLib();
}

export type SlackImportMemberPayload = {
  id: string;
  realName: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  /** YYYY-MM-DD from Slack `profile.start_date` when present. */
  joinDate: string;
};

export type ImportSlackMembersResult =
  | {
      ok: true;
      imported: Person[];
      avatarWarnings: string[];
    }
  | { ok: false; error: string };

/**
 * Creates roster rows for selected Slack members and uploads avatars to Vercel Blob when URLs exist.
 */
export async function importSlackMembers(
  members: SlackImportMemberPayload[]
): Promise<ImportSlackMembersResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return {
      ok: false,
      error:
        "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN to import profile photos from Slack.",
    };
  }

  const roster = await getPeople();
  const takenSlack = new Set(
    roster
      .map((p) => p.slackHandle?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s))
  );

  const imported: Person[] = [];
  const avatarWarnings: string[] = [];

  for (const m of members) {
    const slackId = m.id.trim().toUpperCase();
    if (!slackId) continue;
    if (takenSlack.has(slackId)) continue;
    takenSlack.add(slackId);

    const label =
      m.realName.trim() ||
      m.displayName.trim() ||
      `Team member (${slackId})`;

    let joinDate = (m.joinDate ?? "").trim();
    if (!joinDate) {
      joinDate = (await fetchSlackJoinDateFromProfileGet(m.id)).trim();
    }

    const person = await createPerson({
      name: label,
      role: "",
      department: "",
      autonomyScore: 3,
      slackHandle: slackId,
      profilePicturePath: "",
      joinDate,
      email: (m.email ?? "").trim(),
      phone: "",
      estimatedMonthlySalary: 0,
      employment: "inhouse_salaried",
    });

    const url = (m.avatarUrl ?? "").trim();
    if (url) {
      const saved = await savePersonProfileFromRemoteUrl({
        personId: person.id,
        imageUrl: url,
      });
      if (saved.ok) {
        const updated = await updatePerson(person.id, {
          profilePicturePath: saved.webPath,
        });
        imported.push(updated);
      } else {
        avatarWarnings.push(`${label}: ${saved.error}`);
        imported.push(person);
      }
    } else {
      imported.push(person);
    }
  }

  return { ok: true, imported, avatarWarnings };
}

// ---------------------------------------------------------------------------
// Refresh a single person from Slack (name, email, avatar)
// ---------------------------------------------------------------------------

export type RefreshPersonResult =
  | { ok: true; person: Person; avatarWarning?: string }
  | { ok: false; error: string };

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
