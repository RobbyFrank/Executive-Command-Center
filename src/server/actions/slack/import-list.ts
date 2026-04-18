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
