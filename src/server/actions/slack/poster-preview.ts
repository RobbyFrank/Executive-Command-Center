"use server";

import {
  fetchSlackUserLabelForToken,
  slackUserTokenForThreads,
} from "@/lib/slack";
import { getRepository } from "@/server/repository";

export type SlackThreadPosterPreviewIdentity = {
  displayName: string;
  /** Local `/uploads/...` path or `https://` Slack CDN avatar URL */
  avatarSrc: string | null;
};

/**
 * Resolves who will appear as the message author when posting with the thread
 * user token: Team roster match on `slackHandle`, else Slack `users.info` label + avatar.
 */
export async function getSlackThreadPosterPreviewIdentity(): Promise<SlackThreadPosterPreviewIdentity> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return { displayName: "You", avatarSrc: null };
  }

  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const authData = (await authRes.json()) as {
      ok?: boolean;
      user_id?: string;
    };
    if (!authData.ok || !authData.user_id) {
      return { displayName: "You", avatarSrc: null };
    }

    const uid = authData.user_id.trim().toUpperCase();
    const repo = getRepository();
    const tracker = await repo.load();
    const person = tracker.people.find(
      (p) => (p.slackHandle ?? "").trim().toUpperCase() === uid
    );

    if (person) {
      const path = person.profilePicturePath?.trim();
      return {
        displayName: person.name,
        avatarSrc: path && path.length > 0 ? path : null,
      };
    }

    const displayName = await fetchSlackUserLabelForToken(token, uid);

    const infoRes = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(uid)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const infoData = (await infoRes.json()) as {
      ok?: boolean;
      user?: { profile?: { image_72?: string; image_48?: string } };
    };
    const url =
      infoData.user?.profile?.image_72?.trim() ||
      infoData.user?.profile?.image_48?.trim() ||
      null;

    return { displayName, avatarSrc: url };
  } catch {
    return { displayName: "You", avatarSrc: null };
  }
}
