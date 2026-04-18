import type { SlackMember, SlackProfile } from "./types";
import { slackToken } from "./tokens";

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

export async function enrichSlackMembersJoinDatesFromProfileGet(
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
