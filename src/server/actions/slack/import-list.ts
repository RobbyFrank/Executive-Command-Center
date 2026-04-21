"use server";

import type { Person } from "@/lib/types/tracker";
import {
  fetchSlackChannels as fetchSlackChannelsLib,
  fetchSlackJoinDateFromProfileGet,
  fetchSlackWorkspaceMembers,
} from "@/lib/slack";
import {
  createPerson,
  getPeople,
  updatePerson,
} from "@/server/actions/tracker";
import {
  savePersonProfileFromRemoteUrl,
} from "@/server/imageFiles";
import { buildSlackMessageEnrichmentForUser } from "./roster-enrich-from-messages";

export async function fetchSlackMembers() {
  return fetchSlackWorkspaceMembers();
}

export async function fetchSlackChannelsList() {
  return fetchSlackChannelsLib();
}

export type { FetchSlackChannelsResult } from "@/lib/slack";

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

  /**
   * Department labels already in use on the roster — passed to the AI so it snaps new
   * members into existing buckets (Sales/Marketing/etc.) instead of minting near-duplicates.
   */
  const knownDepartmentsAtStart = [
    ...new Set(
      roster
        .map((p) => p.department?.trim())
        .filter((d): d is string => Boolean(d))
    ),
  ];

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
      autonomyScore: 0,
      slackHandle: slackId,
      profilePicturePath: "",
      joinDate,
      welcomeSlackUrl: "",
      welcomeSlackChannelId: "",
      email: (m.email ?? "").trim(),
      phone: "",
      estimatedMonthlySalary: 0,
      employment: "inhouse_salaried",
    });

    /**
     * Newly imported rows always start with role="" + department="". We also may be
     * missing a joinDate when the workspace profile doesn't expose start_date. Pull the
     * person's `search.messages` history once to backfill all three at once (AI-inferred
     * role/dept + oldest-message join date). Best-effort: a missing `search:read` scope
     * silently falls through without aborting the whole import.
     */
    const postCreateUpdates: Partial<Person> = {};
    const enrichment = await buildSlackMessageEnrichmentForUser({
      slackUserId: slackId,
      skipRoleAndDepartment: false,
      skipJoinDate: Boolean(joinDate),
      knownDepartments: knownDepartmentsAtStart,
    });
    if (enrichment.role) {
      postCreateUpdates.role = enrichment.role;
    }
    if (enrichment.department) {
      postCreateUpdates.department = enrichment.department;
    }
    if (!joinDate && enrichment.joinDateFromOldestMessage) {
      postCreateUpdates.joinDate = enrichment.joinDateFromOldestMessage;
    }

    const url = (m.avatarUrl ?? "").trim();
    if (url) {
      const saved = await savePersonProfileFromRemoteUrl({
        personId: person.id,
        imageUrl: url,
      });
      if (saved.ok) {
        postCreateUpdates.profilePicturePath = saved.webPath;
      } else {
        avatarWarnings.push(`${label}: ${saved.error}`);
      }
    }

    if (Object.keys(postCreateUpdates).length > 0) {
      const updated = await updatePerson(person.id, postCreateUpdates);
      imported.push(updated);
      /** Newly guessed department label feeds the next row's AI call in the same import. */
      if (updated.department && !knownDepartmentsAtStart.includes(updated.department)) {
        knownDepartmentsAtStart.push(updated.department);
      }
    } else {
      imported.push(person);
    }
  }

  return { ok: true, imported, avatarWarnings };
}
