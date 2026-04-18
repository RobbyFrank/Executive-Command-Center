import { fetchBillingActiveUserIds } from "./billing";
import {
  enrichSlackMembersJoinDatesFromProfileGet,
  fetchSlackJoinDateFromProfileGet,
  joinDateFromSlackProfile,
  logSlackJoinDate,
} from "./profile-join-date";
import { billableInfoUserTokenHelp, slackToken } from "./tokens";
import type { SlackMember, SlackProfile } from "./types";

type SlackApiUser = {
  id: string;
  name?: string;
  /** When true, the user has been deactivated. */
  deleted?: boolean;
  is_bot?: boolean;
  /** Invited but not yet signed in — not shown as Active / Active guest. */
  is_invited_user?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  profile?: SlackProfile;
};

type UsersListResponse = {
  ok?: boolean;
  error?: string;
  members?: SlackApiUser[];
  response_metadata?: { next_cursor?: string };
};

type UsersInfoResponse = {
  ok?: boolean;
  error?: string;
  user?: SlackApiUser;
};

function mapUser(u: SlackApiUser): SlackMember | null {
  if (u.is_bot) return null;
  if (u.deleted) return null;
  if (u.is_invited_user) return null;
  if ((u.name ?? "").toLowerCase() === "slackbot") return null;

  const profile = u.profile ?? {};
  const realName = (profile.real_name ?? "").trim();
  const displayName = (profile.display_name ?? "").trim();
  const email = (profile.email ?? "").trim();
  const avatarUrl =
    profile.image_192?.trim() ||
    profile.image_512?.trim() ||
    profile.image_72?.trim() ||
    "";

  const isGuest = Boolean(u.is_restricted || u.is_ultra_restricted);

  return {
    id: u.id,
    realName,
    displayName,
    email,
    avatarUrl,
    joinDate: joinDateFromSlackProfile(profile),
    isGuest,
    /** Filled in fetchSlackWorkspaceMembers once billing is known. */
    billingLabel: "Active",
    isBot: Boolean(u.is_bot),
    deleted: Boolean(u.deleted),
  };
}

/**
 * Fetches a single Slack user by ID via `users.info`.
 * Returns the mapped SlackMember or an error.
 */
export async function fetchSlackUserById(
  slackUserId: string
): Promise<{ ok: true; member: SlackMember } | { ok: false; error: string }> {
  const token = slackToken();
  if (!token) {
    return {
      ok: false,
      error: "Slack is not configured. Set SLACK_BOT_USER_OAUTH_TOKEN.",
    };
  }

  const params = new URLSearchParams();
  params.set("user", slackUserId.trim());

  const res = await fetch(
    `https://slack.com/api/users.info?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as UsersInfoResponse;

  if (!data.ok) {
    if (data.error === "user_not_found") {
      return { ok: false, error: "Slack user not found." };
    }
    return {
      ok: false,
      error: data.error
        ? `Slack API error: ${data.error}`
        : "Slack API returned an error.",
    };
  }

  if (!data.user) {
    return { ok: false, error: "Slack returned no user data." };
  }

  const profile = data.user.profile ?? {};
  const realName = (profile.real_name ?? "").trim();
  const displayName = (profile.display_name ?? "").trim();
  const email = (profile.email ?? "").trim();
  const avatarUrl =
    profile.image_192?.trim() ||
    profile.image_512?.trim() ||
    profile.image_72?.trim() ||
    "";

  const isGuest = Boolean(
    data.user.is_restricted || data.user.is_ultra_restricted
  );

  let joinDate = joinDateFromSlackProfile(profile);
  logSlackJoinDate("users.info profile", {
    slackUserId: data.user.id,
    start_date_raw: profile.start_date?.trim() || "(absent)",
    joinDateFromInfoOnly: joinDate || "(empty)",
  });
  if (!joinDate.trim()) {
    joinDate = await fetchSlackJoinDateFromProfileGet(data.user.id);
  }
  logSlackJoinDate("fetchSlackUserById joinDate final", {
    slackUserId: data.user.id,
    joinDate: joinDate || "(empty)",
  });

  return {
    ok: true,
    member: {
      id: data.user.id,
      realName,
      displayName,
      email,
      avatarUrl,
      joinDate,
      isGuest,
      billingLabel: isGuest ? "Active guest" : "Active",
      isBot: Boolean(data.user.is_bot),
      deleted: Boolean(data.user.deleted),
    },
  };
}

/**
 * Lists human workspace members shown as **Active** or **Active guest** in Slack billing:
 * `billing_active` from `team.billableInfo`, **or** signed-in workspace guests (`is_restricted` /
 * `is_ultra_restricted`, excluding pending invites via `is_invited_user`).
 * Excludes bots, Slackbot, and deactivated users (`deleted`) before applying the filter.
 */
export async function fetchSlackWorkspaceMembers(): Promise<
  | { ok: true; members: SlackMember[] }
  | { ok: false; error: string }
> {
  const token = slackToken();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack is not configured. Set SLACK_BOT_USER_OAUTH_TOKEN in the server environment.",
    };
  }

  const collected: SlackMember[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/users.list?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return {
        ok: false,
        error: `Slack API request failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as UsersListResponse;

    if (!data.ok) {
      return {
        ok: false,
        error:
          data.error === "missing_scope"
            ? "Slack token is missing a required scope (e.g. users:read)."
            : data.error
              ? `Slack API error: ${data.error}`
              : "Slack API returned an error.",
      };
    }

    for (const raw of data.members ?? []) {
      const m = mapUser(raw);
      if (m) collected.push(m);
    }

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  const billingUserToken = process.env.SLACK_BILLING_USER_TOKEN?.trim();
  if (!billingUserToken) {
    return {
      ok: false,
      error:
        "Set SLACK_BILLING_USER_TOKEN in the server environment to filter by billing_active. " +
        billableInfoUserTokenHelp(),
    };
  }

  if (billingUserToken.startsWith("xoxb-")) {
    return {
      ok: false,
      error:
        "SLACK_BILLING_USER_TOKEN must be a user OAuth token (xoxp-), not the bot token (xoxb-). " +
        billableInfoUserTokenHelp(),
    };
  }

  const billing = await fetchBillingActiveUserIds(billingUserToken);
  if (!billing.ok) {
    return { ok: false, error: billing.error };
  }

  const withActiveBilling = collected
    .filter((m) => {
      const id = m.id.toUpperCase();
      return billing.ids.has(id) || m.isGuest;
    })
    .map((m) => ({
      ...m,
      billingLabel: m.isGuest ? ("Active guest" as const) : ("Active" as const),
    }));

  await enrichSlackMembersJoinDatesFromProfileGet(withActiveBilling);

  withActiveBilling.sort((a, b) => {
    const an = (a.realName || a.displayName || a.id).toLowerCase();
    const bn = (b.realName || b.displayName || b.id).toLowerCase();
    return an.localeCompare(bn);
  });

  return { ok: true, members: withActiveBilling };
}
