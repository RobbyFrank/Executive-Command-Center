/**
 * Slack Web API helpers (server-side).
 * - SLACK_BOT_USER_OAUTH_TOKEN: users.list, users.info, users.profile.get (bot token xoxb-).
 *   Add Bot scope **users.profile:read** so join dates resolve: `users.list` often omits
 *   `profile.start_date`; `users.profile.get` returns the full profile (incl. Slack Atlas).
 * - SLACK_BILLING_USER_TOKEN: team.billableInfo only — must be a user token (xoxp-), not the bot; see billableInfoUserTokenHelp().
 * - SLACK_CHANNEL_LIST_USER_TOKEN (optional): user token (xoxp-) for `conversations.list` only. When set, the Roadmap channel picker lists channels **this user** can access (including private channels they’re in). If unset, `SLACK_BILLING_USER_TOKEN` is used for listing when present, else the bot token (private channels only if the bot was invited).
 * - Milestone Slack threads (`conversations.replies`, `chat.postMessage`): use **user token** via slackUserTokenForThreads() — add User Token Scopes `channels:history`, `groups:history`, `chat:write` so you can read/post in channels you’re in without inviting the bot; messages post as the OAuth user.
 * @see https://api.slack.com/methods/users.list
 * @see https://api.slack.com/methods/users.profile.get
 * @see https://api.slack.com/methods/team.billableInfo
 */

import { SLACK_CHANNELS_LIST_CACHE_TTL_MS } from "@/lib/slackChannelsCacheConstants";
import { isExecutiveSlackChannelName } from "@/lib/slack/channelNamePolicy";

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

/**
 * Token for `conversations.list` (channel picker). User tokens list channels **that user**
 * can see; the bot token only lists private channels the **bot** has joined.
 * Precedence: dedicated var → billing user token (same xoxp- often works) → bot.
 */
function slackTokenForConversationsList(): string | undefined {
  const dedicated = process.env.SLACK_CHANNEL_LIST_USER_TOKEN?.trim();
  if (dedicated) return dedicated;
  const billing = process.env.SLACK_BILLING_USER_TOKEN?.trim();
  if (billing) return billing;
  return slackToken();
}

/**
 * User OAuth token for reading/posting milestone Slack threads. No bot fallback — thread
 * history and replies must run as a workspace member (see `.env.example` scopes).
 */
export function slackUserTokenForThreads(): string | undefined {
  const dedicated = process.env.SLACK_CHANNEL_LIST_USER_TOKEN?.trim();
  if (dedicated) return dedicated;
  const billing = process.env.SLACK_BILLING_USER_TOKEN?.trim();
  if (billing && !billing.startsWith("xoxb-")) return billing;
  return undefined;
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
 * Paginates `conversations.list` for one or more comma-separated `types` values
 * (e.g. `public_channel`, `private_channel`, or `public_channel,private_channel`).
 */
async function fetchConversationsListByTypesParam(
  token: string,
  typesParam: string
): Promise<
  | { ok: true; channels: SlackApiChannel[] }
  | { ok: false; error: string }
> {
  const collected: SlackApiChannel[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("types", typesParam);
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

function mergeMappedSlackChannels(raws: SlackApiChannel[]): SlackChannel[] {
  const byId = new Map<string, SlackChannel>();
  for (const raw of raws) {
    const ch = mapChannel(raw);
    if (!ch) continue;
    if (isExecutiveSlackChannelName(ch.name)) continue;
    byId.set(ch.id, ch);
  }
  const collected = [...byId.values()];
  collected.sort((a, b) => a.name.localeCompare(b.name));
  return collected;
}

export type FetchSlackChannelsResult =
  | { ok: true; channels: SlackChannel[]; notice?: string }
  | { ok: false; error: string };

type SlackChannelsServerCache = {
  expiresAt: number;
  result: FetchSlackChannelsResult;
};

let slackChannelsServerCache: SlackChannelsServerCache | null = null;

/**
 * Fetches public and private channels the bot can access via `conversations.list`.
 * Prefer a single paginated run with `types=public_channel,private_channel`; falls back
 * to separate runs, then merges by channel id. If the private list cannot be loaded
 * (e.g. missing `groups:read`), still returns public channels with an optional `notice`.
 * With a **bot** token, the bot must be **in** a private channel for Slack to return it.
 * With a **user** token (`SLACK_CHANNEL_LIST_USER_TOKEN` or `SLACK_BILLING_USER_TOKEN`),
 * Slack returns channels that **user** can access (typical for an admin workspace token).
 * Requires `channels:read` and `groups:read` on whichever token is used (bot or user scopes).
 *
 * Successful responses are memoized in-process for {@link SLACK_CHANNELS_LIST_CACHE_TTL_MS} ms
 * (same window as the Roadmap channel picker / scraper client cache).
 */
export async function fetchSlackChannels(): Promise<FetchSlackChannelsResult> {
  const now = Date.now();
  if (slackChannelsServerCache && now < slackChannelsServerCache.expiresAt) {
    return slackChannelsServerCache.result;
  }

  const result = await fetchSlackChannelsFromApi();

  if (result.ok) {
    slackChannelsServerCache = {
      expiresAt: now + SLACK_CHANNELS_LIST_CACHE_TTL_MS,
      result,
    };
  }

  return result;
}

async function fetchSlackChannelsFromApi(): Promise<FetchSlackChannelsResult> {
  const token = slackTokenForConversationsList();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack is not configured. Set SLACK_BOT_USER_OAUTH_TOKEN, or a user token (SLACK_CHANNEL_LIST_USER_TOKEN or SLACK_BILLING_USER_TOKEN) for channel listing.",
    };
  }

  const combined = await fetchConversationsListByTypesParam(
    token,
    "public_channel,private_channel"
  );
  if (combined.ok) {
    return {
      ok: true,
      channels: mergeMappedSlackChannels(combined.channels),
    };
  }

  const publicResult = await fetchConversationsListByTypesParam(
    token,
    "public_channel"
  );
  if (!publicResult.ok) return publicResult;

  const privateResult = await fetchConversationsListByTypesParam(
    token,
    "private_channel"
  );

  if (privateResult.ok) {
    return {
      ok: true,
      channels: mergeMappedSlackChannels([
        ...publicResult.channels,
        ...privateResult.channels,
      ]),
    };
  }

  const notice =
    privateResult.error.includes("missing_scope") ||
    privateResult.error.includes("groups:read")
      ? "Private channels are not listed: add the groups:read scope to the Slack app and reinstall it to the workspace."
      : `Private channels could not be listed (${privateResult.error}). Public channels are shown below.`;

  return {
    ok: true,
    channels: mergeMappedSlackChannels(publicResult.channels),
    notice,
  };
}

/**
 * Resolves a channel id to its workspace name via `conversations.info` (requires `channels:read`
 * on the same token used for {@link fetchSlackChannels}).
 */
export async function fetchSlackChannelNameById(
  channelId: string
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const token = slackTokenForConversationsList();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack is not configured. Set SLACK_BOT_USER_OAUTH_TOKEN, or a user token (SLACK_CHANNEL_LIST_USER_TOKEN or SLACK_BILLING_USER_TOKEN).",
    };
  }
  const id = channelId.trim();
  if (!id) {
    return { ok: false, error: "Channel id is empty." };
  }

  const params = new URLSearchParams();
  params.set("channel", id);

  const res = await fetch(
    `https://slack.com/api/conversations.info?${params.toString()}`,
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

  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { name?: string };
  };

  if (!data.ok) {
    return {
      ok: false,
      error: data.error
        ? `Slack API error: ${data.error}`
        : "Slack API returned an error.",
    };
  }

  const name = (data.channel?.name ?? "").trim();
  if (!name) {
    return { ok: false, error: "Channel has no name in Slack response." };
  }

  return { ok: true, name };
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

// ---------------------------------------------------------------------------
// Milestone Slack thread URLs + conversations.replies + chat.postMessage
// ---------------------------------------------------------------------------

/** Parsed Slack thread permalink: channel + message/thread `ts`. */
export type ParsedSlackThreadUrl = { channelId: string; threadTs: string };

/**
 * Converts `p` + digits from an archives permalink to Slack message `ts` (`seconds.micro`).
 * @see https://api.slack.com/messaging/retrieving#individual_messages
 */
export function slackTsFromArchivesPDigits(pDigits: string): string | null {
  const d = pDigits.replace(/\D/g, "");
  if (d.length < 7) return null;
  return `${d.slice(0, -6)}.${d.slice(-6)}`;
}

/** Slack message `ts` as used in query params (`thread_ts`): `seconds.microseconds`. */
function slackMessageTsFromQueryParam(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+\.\d+$/.test(s)) return null;
  return s;
}

/**
 * Parses a Slack thread or message URL into `channelId` + `threadTs` for Web API calls.
 * Supports `…/archives/C…/p…` and `app.slack.com/.../thread/C…-ts` styles.
 * For archive links to a **reply inside a thread**, Slack adds `?thread_ts=…` with the **parent**
 * message ts; when present, that value is used so `conversations.replies` receives the thread root.
 */
export function parseSlackThreadUrl(raw: string): ParsedSlackThreadUrl | null {
  const t = raw.trim();
  if (!t) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const path = url.pathname;

  const threadSeg = path.match(/\/thread\/([CDG][A-Z0-9]+)-(\d+\.\d+)\/?$/i);
  if (threadSeg) {
    return { channelId: threadSeg[1], threadTs: threadSeg[2] };
  }

  const archives = path.match(
    /\/archives\/([CDG][A-Z0-9]+)\/p(\d+)\/?$/i
  );
  if (archives) {
    const ts = slackTsFromArchivesPDigits(archives[2]);
    if (!ts) return null;
    const rootFromQuery = slackMessageTsFromQueryParam(
      url.searchParams.get("thread_ts")
    );
    return { channelId: archives[1], threadTs: rootFromQuery ?? ts };
  }

  return null;
}

export type SlackThreadApiMessage = {
  ts: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
};

type ConversationsRepliesResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackThreadApiMessage[];
  response_metadata?: { next_cursor?: string };
};

function compareSlackTs(a: string, b: string): number {
  const da = parseFloat(a);
  const db = parseFloat(b);
  if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
  return a.localeCompare(b);
}

/**
 * Loads all messages in a thread via `conversations.replies` (paginated) using the user token.
 */
export async function fetchSlackThreadReplies(
  channelId: string,
  threadTs: string
): Promise<
  | {
      ok: true;
      messages: SlackThreadApiMessage[];
      /** Latest `ts` among all messages in the thread. */
      latestTs: string;
      /** Oldest `ts` in the thread (parent message) — use as `thread_ts` when posting. */
      rootTs: string;
      latestDate: Date;
    }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured for threads. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scopes channels:history, groups:history, and chat:write.",
    };
  }

  const collected: SlackThreadApiMessage[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("channel", channelId.trim());
    params.set("ts", threadTs.trim());
    params.set("limit", "200");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.replies?${params.toString()}`,
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

    const data = (await res.json()) as ConversationsRepliesResponse;

    if (!data.ok) {
      const err = data.error ?? "unknown_error";
      if (err === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack token is missing a required scope (channels:history or groups:history). Add User Token Scopes and reinstall the app.",
        };
      }
      if (err === "channel_not_found") {
        return {
          ok: false,
          error:
            "Channel not found or you’re not a member — check the Slack URL and your workspace access.",
        };
      }
      if (err === "not_in_channel") {
        return {
          ok: false,
          error:
            "You’re not in this channel — join the channel in Slack or use a thread URL from a channel you can access.",
        };
      }
      return {
        ok: false,
        error: `Slack API error: ${err}`,
      };
    }

    collected.push(...(data.messages ?? []));

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  if (collected.length === 0) {
    return {
      ok: false,
      error: "No messages returned for this thread.",
    };
  }

  let latestTs = collected[0]!.ts;
  let rootTs = collected[0]!.ts;
  for (const m of collected) {
    if (compareSlackTs(m.ts, latestTs) > 0) latestTs = m.ts;
    if (compareSlackTs(m.ts, rootTs) < 0) rootTs = m.ts;
  }

  const sec = parseFloat(latestTs);
  const latestDate = Number.isFinite(sec)
    ? new Date(Math.floor(sec * 1000))
    : new Date();

  return {
    ok: true,
    messages: collected,
    latestTs,
    /** Parent / root message `ts` — use as `thread_ts` when posting replies. */
    rootTs,
    latestDate,
  };
}

/** Top-level channel message from `conversations.history` (thread replies excluded). */
export type SlackChannelHistoryMessage = {
  ts: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  /** Present on thread replies; parent has `thread_ts === ts`. */
  thread_ts?: string;
};

type ConversationsHistoryResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackChannelHistoryMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
};

/**
 * Fetches top-level channel messages via `conversations.history` (paginated) using the user token.
 * Thread replies are not included (only messages in the channel timeline).
 * Pass `oldestTs` to only include messages at or after that Slack `ts` (e.g. window start).
 */
export async function fetchSlackChannelHistory(
  channelId: string,
  options: {
    oldestTs?: string;
    /** Per request; Slack max is 1000. Default 200. */
    limitPerPage?: number;
    /** Stop after this many messages (across pages). Default 500. */
    maxMessages?: number;
  } = {}
): Promise<
  | { ok: true; messages: SlackChannelHistoryMessage[] }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured for history. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scopes channels:history and groups:history.",
    };
  }

  const limitPerPage = Math.min(
    Math.max(1, options.limitPerPage ?? 200),
    1000
  );
  const maxMessages = Math.max(1, options.maxMessages ?? 500);

  const collected: SlackChannelHistoryMessage[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("channel", channelId.trim());
    params.set("limit", String(limitPerPage));
    if (cursor) params.set("cursor", cursor);
    const oldest = options.oldestTs?.trim();
    if (oldest) params.set("oldest", oldest);

    const res = await fetch(
      `https://slack.com/api/conversations.history?${params.toString()}`,
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

    const data = (await res.json()) as ConversationsHistoryResponse;

    if (!data.ok) {
      const err = data.error ?? "unknown_error";
      if (err === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack token is missing a required scope (channels:history or groups:history). Add User Token Scopes and reinstall the app.",
        };
      }
      if (err === "channel_not_found") {
        return {
          ok: false,
          error:
            "Channel not found or you’re not a member — check the channel and your workspace access.",
        };
      }
      if (err === "not_in_channel") {
        return {
          ok: false,
          error:
            "You’re not in this channel — join it in Slack or pick another channel.",
        };
      }
      return {
        ok: false,
        error: `Slack API error: ${err}`,
      };
    }

    const page = data.messages ?? [];
    for (const m of page) {
      if (!m?.ts) continue;
      if (m.thread_ts && m.thread_ts !== m.ts) continue;
      collected.push(m);
      if (collected.length >= maxMessages) break;
    }

    if (collected.length >= maxMessages) break;

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  collected.sort((a, b) => compareSlackTs(a.ts, b.ts));

  return { ok: true, messages: collected };
}

type ChatPostMessageResponse = {
  ok?: boolean;
  error?: string;
  ts?: string;
  channel?: string;
};

/**
 * Posts a new top-level channel message (starts a thread when others reply) as the Slack user.
 */
export async function postSlackChannelMessage(
  channelId: string,
  text: string
): Promise<
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scope chat:write.",
    };
  }

  const body = new URLSearchParams();
  body.set("channel", channelId.trim());
  body.set("text", text);

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ChatPostMessageResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token is missing chat:write (User Token Scope). Add it and reinstall the app.",
      };
    }
    if (err === "not_in_channel") {
      return {
        ok: false,
        error:
          "Cannot post — you’re not in this channel. Join it in Slack or pick another channel.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  const ts = (data.ts ?? "").trim();
  const ch = (data.channel ?? channelId).trim();
  if (!ts) {
    return { ok: false, error: "Slack did not return a message timestamp." };
  }

  return { ok: true, ts, channel: ch };
}

type ChatGetPermalinkResponse = {
  ok?: boolean;
  error?: string;
  permalink?: string;
};

/**
 * Returns a permalink URL for a message (`chat.getPermalink`).
 */
export async function getSlackMessagePermalink(
  channelId: string,
  messageTs: string
): Promise<{ ok: true; permalink: string } | { ok: false; error: string }> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-).",
    };
  }

  const params = new URLSearchParams();
  params.set("channel", channelId.trim());
  params.set("message_ts", messageTs.trim());

  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ChatGetPermalinkResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token cannot read permalinks. Ensure the user token has access to this channel.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  const permalink = (data.permalink ?? "").trim();
  if (!permalink) {
    return { ok: false, error: "Slack returned no permalink." };
  }

  return { ok: true, permalink };
}

/**
 * Posts a reply in a thread as the Slack user (user token `chat:write`).
 */
export async function postSlackThreadReply(
  channelId: string,
  threadTs: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scope chat:write.",
    };
  }

  const body = new URLSearchParams();
  body.set("channel", channelId.trim());
  body.set("thread_ts", threadTs.trim());
  body.set("text", text);

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ChatPostMessageResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token is missing chat:write (User Token Scope). Add it and reinstall the app.",
      };
    }
    if (err === "not_in_channel") {
      return {
        ok: false,
        error:
          "Cannot post — you’re not in this channel or the thread is inaccessible.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  return { ok: true };
}

type UsersInfoShortResponse = {
  ok?: boolean;
  error?: string;
  user?: { id?: string; name?: string; profile?: { real_name?: string; display_name?: string } };
};

/**
 * Resolves a Slack user id to a short display label (for thread previews). Uses the same
 * user token as thread APIs when provided.
 */
export async function fetchSlackUserLabelForToken(
  token: string,
  slackUserId: string
): Promise<string> {
  const id = slackUserId.trim();
  if (!id) return "Unknown";

  const params = new URLSearchParams();
  params.set("user", id);

  const res = await fetch(`https://slack.com/api/users.info?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) return id;

  const data = (await res.json()) as UsersInfoShortResponse;
  if (!data.ok || !data.user) return id;

  const profile = data.user.profile ?? {};
  const real = (profile.real_name ?? "").trim();
  const disp = (profile.display_name ?? "").trim();
  const name = (data.user.name ?? "").trim();
  return real || disp || name || id;
}

// ---------------------------------------------------------------------------
// MPIM / DM helpers (onboarding detector, recommender intro context)
// ---------------------------------------------------------------------------

type ConversationsMembersResponse = {
  ok?: boolean;
  error?: string;
  members?: string[];
  response_metadata?: { next_cursor?: string };
};

/**
 * Paginates `conversations.members` for a channel, IM, or MPIM.
 */
export async function fetchConversationMembers(
  channelId: string
): Promise<{ ok: true; memberIds: string[] } | { ok: false; error: string }> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scopes channels:read, groups:read, im:read, mpim:read.",
    };
  }

  const collected: string[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("channel", channelId.trim());
    params.set("limit", "200");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.members?${params.toString()}`,
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

    const data = (await res.json()) as ConversationsMembersResponse;

    if (!data.ok) {
      const err = data.error ?? "unknown_error";
      if (err === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack token is missing conversations.members scope (often needs im:read, mpim:read, or channels:read).",
        };
      }
      return { ok: false, error: `Slack API error: ${err}` };
    }

    for (const id of data.members ?? []) {
      if (id) collected.push(id.trim().toUpperCase());
    }

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  return { ok: true, memberIds: [...new Set(collected)] };
}

type ConversationsOpenResponse = {
  ok?: boolean;
  error?: string;
  channel?: { id?: string };
  no_op?: boolean;
  already_open?: boolean;
};

/**
 * Opens (or returns the existing) MPIM/IM with the given Slack user ids.
 * Uses the user OAuth token so the resulting DM is owned by the workspace member,
 * not the bot. Slack DM/MPIM cap is **8** users excluding the caller.
 */
export async function openSlackMpim(
  userIds: string[]
): Promise<
  | { ok: true; channelId: string; alreadyOpen: boolean }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with mpim:write/im:write.",
    };
  }
  const ids = [
    ...new Set(
      userIds
        .map((u) => u.trim().toUpperCase())
        .filter((u) => u.length > 0)
    ),
  ];
  if (ids.length === 0) {
    return { ok: false, error: "No Slack user ids provided." };
  }

  const body = new URLSearchParams();
  body.set("users", ids.join(","));
  body.set("return_im", "true");

  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, error: `Slack API request failed (${res.status}).` };
  }

  const data = (await res.json()) as ConversationsOpenResponse;
  if (!data.ok) {
    const err = data.error ?? "unknown_error";
    if (err === "missing_scope") {
      return {
        ok: false,
        error:
          "Slack token is missing mpim:write or im:write (User Token Scope). Add it and reinstall the app.",
      };
    }
    if (err === "user_not_found" || err === "users_not_found") {
      return {
        ok: false,
        error:
          "One or more Slack user ids are unknown to the workspace. Verify each person's slackHandle.",
      };
    }
    if (
      err === "too_many_users" ||
      err === "method_not_supported_for_channel_type"
    ) {
      return {
        ok: false,
        error:
          "Slack rejected this DM size. Group DMs (MPIMs) cap at 8 users besides yourself.",
      };
    }
    if (err === "not_enough_users" || err === "users_list_not_supplied") {
      return {
        ok: false,
        error: "Need at least one Slack user id to open a DM.",
      };
    }
    if (err === "user_disabled") {
      return {
        ok: false,
        error:
          "One of the Slack users is deactivated. Remove them and try again.",
      };
    }
    return { ok: false, error: `Slack API error: ${err}` };
  }

  const channelId = data.channel?.id?.trim();
  if (!channelId) {
    return { ok: false, error: "Slack did not return a channel id." };
  }
  return {
    ok: true,
    channelId,
    alreadyOpen: Boolean(data.already_open ?? data.no_op),
  };
}

/**
 * Lists `mpim` conversations the Slack user is in (group DMs).
 */
export async function fetchUserMpims(): Promise<
  | { ok: true; channels: SlackApiChannel[] }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with mpim:read.",
    };
  }
  return fetchConversationsListByTypesParam(token, "mpim");
}

/**
 * Lists `im` direct messages the Slack user is in (1:1 DMs).
 */
export async function fetchUserIms(): Promise<
  | { ok: true; channels: SlackApiChannel[] }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with im:read.",
    };
  }
  return fetchConversationsListByTypesParam(token, "im");
}

/**
 * Top-level DM/MPIM history (same semantics as {@link fetchSlackChannelHistory}).
 */
export async function fetchDmHistory(
  channelId: string,
  options: { maxMessages?: number } = {}
): Promise<
  | { ok: true; messages: SlackChannelHistoryMessage[] }
  | { ok: false; error: string }
> {
  return fetchSlackChannelHistory(channelId, {
    maxMessages: options.maxMessages ?? 50,
    limitPerPage: 100,
  });
}

/**
 * Paginates `conversations.history` until the channel is exhausted or `maxTotal` messages
 * (top-level only). Sorted ascending by `ts` (oldest first).
 */
export async function fetchAllSlackChannelMessagesForChannel(
  channelId: string,
  options: { maxTotal?: number } = {}
): Promise<
  | { ok: true; messages: SlackChannelHistoryMessage[] }
  | { ok: false; error: string }
> {
  const token = slackUserTokenForThreads();
  if (!token) {
    return {
      ok: false,
      error:
        "Slack user token is not configured for history. Set SLACK_BILLING_USER_TOKEN or SLACK_CHANNEL_LIST_USER_TOKEN (xoxp-) with User scopes channels:history, groups:history, im:history, mpim:history.",
    };
  }

  const maxTotal = Math.min(Math.max(1, options.maxTotal ?? 2000), 2000);
  const collected: SlackChannelHistoryMessage[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set("channel", channelId.trim());
    params.set("limit", "200");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.history?${params.toString()}`,
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

    const data = (await res.json()) as ConversationsHistoryResponse;

    if (!data.ok) {
      const err = data.error ?? "unknown_error";
      if (err === "missing_scope") {
        return {
          ok: false,
          error:
            "Slack token is missing a required scope (channels:history, groups:history, im:history, or mpim:history).",
        };
      }
      return { ok: false, error: `Slack API error: ${err}` };
    }

    const page = data.messages ?? [];
    for (const m of page) {
      if (!m?.ts) continue;
      if (m.thread_ts && m.thread_ts !== m.ts) continue;
      collected.push(m);
      if (collected.length >= maxTotal) break;
    }

    if (collected.length >= maxTotal) break;

    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }

  collected.sort((a, b) => compareSlackTs(a.ts, b.ts));
  return { ok: true, messages: collected };
}

export type OnboardingMpimMatch = {
  channelId: string;
  memberCount: number;
};

/**
 * Finds a group DM that includes Robby, Nadav, and the new hire. If multiple match,
 * picks the most recently active (latest message `ts`).
 */
export async function findOnboardingMpimForPerson(options: {
  robbySlackId: string;
  nadavSlackId: string;
  newHireSlackId: string;
}): Promise<
  | { ok: true; match: OnboardingMpimMatch | null }
  | { ok: false; error: string }
> {
  const r = options.robbySlackId.trim().toUpperCase();
  const n = options.nadavSlackId.trim().toUpperCase();
  const h = options.newHireSlackId.trim().toUpperCase();
  if (!r || !n || !h) {
    return { ok: true, match: null };
  }

  const mpims = await fetchUserMpims();
  if (!mpims.ok) return mpims;

  const candidates: { channelId: string; memberCount: number; latestTs: string }[] =
    [];

  for (const ch of mpims.channels) {
    if (!ch.id || !ch.is_mpim) continue;
    const members = await fetchConversationMembers(ch.id);
    if (!members.ok) continue;
    const set = new Set(members.memberIds);
    if (!set.has(r) || !set.has(n) || !set.has(h)) continue;
    const hist = await fetchSlackChannelHistory(ch.id, {
      maxMessages: 200,
      limitPerPage: 100,
    });
    const latestTs =
      hist.ok && hist.messages.length > 0
        ? hist.messages[hist.messages.length - 1]!.ts
        : "0";
    candidates.push({
      channelId: ch.id,
      memberCount: members.memberIds.length,
      latestTs,
    });
  }

  if (candidates.length === 0) {
    return { ok: true, match: null };
  }

  candidates.sort((a, b) => compareSlackTs(b.latestTs, a.latestTs));
  const best = candidates[0]!;
  return {
    ok: true,
    match: { channelId: best.channelId, memberCount: best.memberCount },
  };
}

/** Re-export for onboarding code; same as {@link getSlackMessagePermalink}. */
export const getMessagePermalink = getSlackMessagePermalink;

/**
 * Searches a single user's Slack message history via `search.messages` (user OAuth token,
 * `search:read` scope). Used by Team roster enrichment (Import from Slack / Refresh all)
 * to fill in blank **Role / Department** (AI-inferred from recent chatter) and blank
 * **Join Date** (oldest surviving message `ts`).
 */
export {
  fetchSlackUserMessageHistory,
  slackTsToYmdUtc,
  type SlackUserMessageMatch,
  type SlackUserMessageKind,
} from "./slack/user-messages";
