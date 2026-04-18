"use server";

import { slackUserTokenForThreads } from "@/lib/slack";
import { rosterMapFromHints, type SlackMemberRosterHint } from "./thread-ai-shared";

export type SlackMentionPreviewDisplay = {
  name: string;
  avatarSrc: string | null;
};

type UsersInfoProfile = {
  real_name?: string;
  display_name?: string;
  image_72?: string;
  image_48?: string;
};

/**
 * Resolves Slack user IDs in draft text for the in-app preview: display name and avatar
 * (Team roster photos when set, otherwise Slack CDN URLs via users.info).
 */
export async function resolveSlackMentionPreviewDisplays(
  userIds: string[],
  rosterHints?: SlackMemberRosterHint[]
): Promise<Record<string, SlackMentionPreviewDisplay>> {
  const normalized = [
    ...new Set(userIds.map((id) => id.trim().toUpperCase()).filter(Boolean)),
  ];
  if (normalized.length === 0) return {};

  const rosterById = rosterMapFromHints(rosterHints);
  const token = slackUserTokenForThreads();

  const out: Record<string, SlackMentionPreviewDisplay> = {};

  await Promise.all(
    normalized.map(async (uid) => {
      const roster = rosterById.get(uid);
      const rosterPath = roster?.profilePicturePath?.trim();
      const rosterName = roster?.name?.trim();

      if (rosterPath && rosterName) {
        out[uid] = { name: rosterName, avatarSrc: rosterPath };
        return;
      }

      if (token) {
        try {
          const params = new URLSearchParams();
          params.set("user", uid);
          const res = await fetch(
            `https://slack.com/api/users.info?${params.toString()}`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            }
          );
          if (res.ok) {
            const data = (await res.json()) as {
              ok?: boolean;
              user?: { profile?: UsersInfoProfile };
            };
            if (data.ok && data.user?.profile) {
              const profile = data.user.profile;
              const real = (profile.real_name ?? "").trim();
              const disp = (profile.display_name ?? "").trim();
              const name = real || disp || rosterName || uid;
              const avatarSrc =
                profile.image_72?.trim() ||
                profile.image_48?.trim() ||
                rosterPath ||
                null;
              out[uid] = { name, avatarSrc };
              return;
            }
          }
        } catch {
          /* fall through */
        }
      }

      out[uid] = {
        name: rosterName || uid,
        avatarSrc: rosterPath || null,
      };
    })
  );

  return out;
}
