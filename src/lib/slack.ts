/**
 * Slack Web API helpers (server-side).
 * - SLACK_BOT_USER_OAUTH_TOKEN: users.list, users.info, users.profile.get (bot token xoxb-).
 *   Add Bot scope **users.profile:read** so join dates resolve: `users.list` often omits
 *   `profile.start_date`; `users.profile.get` returns the full profile (incl. Slack Atlas).
 * - SLACK_BILLING_USER_TOKEN: team.billableInfo only — must be a user token (xoxp-), not the bot; see billableInfoUserTokenHelp().
 * @see https://api.slack.com/methods/users.list
 * @see https://api.slack.com/methods/users.profile.get
 * @see https://api.slack.com/methods/team.billableInfo
 */

/**
 * Set `SLACK_JOIN_DATE_DEBUG=1` in `.env.local` to print join-date resolution to the **Node /
 * Next.js server terminal** (where `npm run dev` runs) — not the browser DevTools console.
 */
function slackJoinDateDebugEnabled(): boolean {
  const v = process.env.SLACK_JOIN_DATE_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** @internal Exported for `refreshPersonFromSlack` in server actions. */
export function logSlackJoinDate(
  step: string,
  payload: Record<string, unknown>
): void {
  if (!slackJoinDateDebugEnabled()) return;
  console.log(`[slack:joinDate] ${step}`, payload);
}

/** Mirrors Slack billing UI for import: full members vs guests. */
export type SlackBillingLabel = "Active" | "Active guest";

export type SlackMember = {
  id: string;
  realName: string;
  displayName: string;
  email: string;
  /** Best available profile image URL (typically image_192). */
  avatarUrl: string;
  /** `YYYY-MM-DD` from `profile.start_date` when Slack provides it (e.g. Slack Atlas). */
  joinDate: string;
  /** Multi-channel or single-channel guest (`is_restricted` / `is_ultra_restricted`). */
  isGuest: boolean;
  /** For Import dialog: Fair Billing active member vs active guest. */
  billingLabel: SlackBillingLabel;
  isBot: boolean;
  deleted: boolean;
};

type SlackProfile = {
  real_name?: string;
  display_name?: string;
  email?: string;
  /** Org join date when Slack Atlas (or equivalent) exposes it. */
  start_date?: string;
  /** Custom profile fields (may include ISO hire dates). */
  fields?: Record<string, { value?: string; alt?: string }>;
  image_192?: string;
  image_512?: string;
  image_72?: string;
};

/** Parses Slack date strings to roster `joinDate` (`YYYY-MM-DD`). */
function parseSlackJoinDateInput(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const prefix = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return prefix;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Maps Slack profile data to roster `joinDate` (`YYYY-MM-DD`).
 * Uses `start_date` (Slack Atlas), then ISO `YYYY-MM-DD` values in custom `fields`.
 */
export function joinDateFromSlackProfile(profile: SlackProfile): string {
  const fromStart = parseSlackJoinDateInput(profile.start_date ?? "");
  if (fromStart) return fromStart;

  const fields = profile.fields;
  if (!fields || typeof fields !== "object") return "";

  const keys = Object.keys(fields).sort();
  for (const k of keys) {
    const val = (fields[k]?.value ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  }
  return "";
}

type UsersProfileGetResponse = {
  ok?: boolean;
  error?: string;
  profile?: SlackProfile;
};

type ProfileJoinDateResult = { date: string; missingScope?: boolean };

async function fetchSlackJoinDateFromProfileGetDetailed(
  slackUserId: string
): Promise<ProfileJoinDateResult> {
  const token = slackToken();
  if (!token) return { date: "" };

  const params = new URLSearchParams();
  params.set("user", slackUserId.trim());

  const res = await fetch(
    `https://slack.com/api/users.profile.get?${params.toString()}`,
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
    logSlackJoinDate("users.profile.get HTTP error", {
      slackUserId,
      status: res.status,
    });
    return { date: "" };
  }

  const data = (await res.json()) as UsersProfileGetResponse;

  if (!data.ok) {
    if (data.error === "missing_scope") {
      logSlackJoinDate("users.profile.get missing_scope", {
        slackUserId,
        hint: "Add Bot scope users.profile:read and reinstall the app",
      });
      return { date: "", missingScope: true };
    }
    logSlackJoinDate("users.profile.get not ok", {
      slackUserId,
      error: data.error ?? "(no error string)",
    });
    return { date: "" };
  }

  const prof = data.profile ?? {};
  const parsed = joinDateFromSlackProfile(prof);
  const fieldKeys = prof.fields ? Object.keys(prof.fields).length : 0;
  logSlackJoinDate("users.profile.get parsed", {
    slackUserId,
    start_date_raw: prof.start_date?.trim() || "(absent)",
    customFieldCount: fieldKeys,
    joinDate: parsed || "(empty)",
  });

  return { date: parsed };
}

/**
 * Loads join date via `users.profile.get` when `users.list` did not include enough profile
 * data. Requires bot scope **users.profile:read**.
 */
export async function fetchSlackJoinDateFromProfileGet(
  slackUserId: string
): Promise<string> {
  const r = await fetchSlackJoinDateFromProfileGetDetailed(slackUserId);
  return r.date;
}

const PROFILE_JOIN_ENRICH_CONCURRENCY = 10;

async function enrichSlackMembersJoinDatesFromProfileGet(
  members: SlackMember[]
): Promise<void> {
  const need = members.filter((m) => !(m.joinDate ?? "").trim());
  if (need.length === 0) return;

  for (let i = 0; i < need.length; i += PROFILE_JOIN_ENRICH_CONCURRENCY) {
    const slice = need.slice(i, i + PROFILE_JOIN_ENRICH_CONCURRENCY);
    const results = await Promise.all(
      slice.map((m) => fetchSlackJoinDateFromProfileGetDetailed(m.id))
    );
    for (let j = 0; j < slice.length; j++) {
      const r = results[j];
      if (r.missingScope) return;
      if (r.date) slice[j].joinDate = r.date;
    }
  }
}

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

type TeamBillableInfoResponse = {
  ok?: boolean;
  error?: string;
  /** Slack may add fields over time; we read `billing_active`. */
  billable_info?: Record<string, { billing_active?: boolean; [k: string]: unknown }>;
  response_metadata?: { next_cursor?: string };
};

function slackToken(): string | undefined {
  const t = process.env.SLACK_BOT_USER_OAUTH_TOKEN?.trim();
  return t || undefined;
}

/** Explains why team.billableInfo needs a separate user token; bot + team.billing:read are not enough. */
function billableInfoUserTokenHelp(): string {
  return (
    "Slack’s team.billableInfo method (per-member billing_active) does not accept bot tokens — you will get not_allowed_token_type if you use xoxb-. " +
    "It requires a user OAuth token with the admin user scope. The bot scope team.billing:read only applies to team.billing.info (workspace plan), not team.billableInfo. " +
    "In https://api.slack.com/apps → your app → OAuth & Permissions → User Token Scopes, add admin, reinstall the app to the workspace, run the OAuth redirect once as a workspace admin/owner, then put the user token (starts with xoxp-) in SLACK_BILLING_USER_TOKEN. " +
    "Keep using SLACK_BOT_USER_OAUTH_TOKEN for users.list."
  );
}

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

// ---------------------------------------------------------------------------
// Single user lookup (users.info)
// ---------------------------------------------------------------------------

type UsersInfoResponse = {
  ok?: boolean;
  error?: string;
  user?: SlackApiUser;
};

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

function billableInfoErrorMessage(code: string | undefined): string {
  if (code === "not_allowed_token_type") {
    return billableInfoUserTokenHelp();
  }
  if (code === "missing_scope" || code === "no_permission") {
    return (
      "Cannot read billing status (team.billableInfo). " + billableInfoUserTokenHelp()
    );
  }
  return code ? `Slack billing API error: ${code}` : "Slack billing API returned an error.";
}

/**
 * User IDs with billing_active === true from team.billableInfo (paginated).
 */
async function fetchBillingActiveUserIds(
  token: string
): Promise<{ ok: true; ids: Set<string> } | { ok: false; error: string }> {
  const ids = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/team.billableInfo?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return {
        ok: false,
        error: `Slack billing API request failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as TeamBillableInfoResponse;

    if (!data.ok) {
      return { ok: false, error: billableInfoErrorMessage(data.error) };
    }

    for (const [userId, meta] of Object.entries(data.billable_info ?? {})) {
      if (meta?.billing_active === true) {
        ids.add(userId.toUpperCase());
      }
    }

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  return { ok: true, ids };
}

// ---------------------------------------------------------------------------
// Channels (conversations.list)
// ---------------------------------------------------------------------------

export type SlackChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
  /** Number of members in the channel; -1 when unavailable. */
  memberCount: number;
  topic: string;
  purpose: string;
};

type SlackApiChannel = {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
};

type ConversationsListResponse = {
  ok?: boolean;
  error?: string;
  channels?: SlackApiChannel[];
  response_metadata?: { next_cursor?: string };
};

function mapChannel(c: SlackApiChannel): SlackChannel | null {
  if (c.is_archived) return null;
  if (c.is_im || c.is_mpim) return null;
  return {
    id: c.id,
    name: (c.name ?? "").trim(),
    isPrivate: Boolean(c.is_private || c.is_group),
    memberCount: typeof c.num_members === "number" ? c.num_members : -1,
    topic: (c.topic?.value ?? "").trim(),
    purpose: (c.purpose?.value ?? "").trim(),
  };
}

function conversationsListErrorMessage(error: string | undefined): string {
  if (error === "missing_scope") {
    return "Slack token is missing a required scope (channels:read, groups:read).";
  }
  return error ? `Slack API error: ${error}` : "Slack API returned an error.";
}

/**
 * Paginates `conversations.list` for a single conversation type (public or private).
 */
async function fetchConversationsListByType(
  token: string,
  types: "public_channel" | "private_channel"
): Promise<
  | { ok: true; channels: SlackApiChannel[] }
  | { ok: false; error: string }
> {
  const collected: SlackApiChannel[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("types", types);
    params.set("exclude_archived", "true");
    params.set("limit", "200");
    params.set("include_num_members", "true");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.list?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return {
        ok: false,
        error: `Slack API request failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as ConversationsListResponse;

    if (!data.ok) {
      return { ok: false, error: conversationsListErrorMessage(data.error) };
    }

    collected.push(...(data.channels ?? []));

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  return { ok: true, channels: collected };
}

/**
 * Fetches public and private channels the bot can access via `conversations.list`.
 * Requests each type in its own paginated run, then merges by channel id (Roadmap goal picker).
 * Requires scopes: channels:read, groups:read on the bot token.
 */
export async function fetchSlackChannels(): Promise<
  | { ok: true; channels: SlackChannel[] }
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

  const publicResult = await fetchConversationsListByType(
    token,
    "public_channel"
  );
  if (!publicResult.ok) return publicResult;

  const privateResult = await fetchConversationsListByType(
    token,
    "private_channel"
  );
  if (!privateResult.ok) return privateResult;

  const byId = new Map<string, SlackChannel>();
  for (const raw of [...publicResult.channels, ...privateResult.channels]) {
    const ch = mapChannel(raw);
    if (ch) byId.set(ch.id, ch);
  }

  const collected = [...byId.values()];
  collected.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, channels: collected };
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
