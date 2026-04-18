import { billableInfoUserTokenHelp } from "./tokens";

type TeamBillableInfoResponse = {
  ok?: boolean;
  error?: string;
  /** Slack may add fields over time; we read `billing_active`. */
  billable_info?: Record<string, { billing_active?: boolean; [k: string]: unknown }>;
  response_metadata?: { next_cursor?: string };
};

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
export async function fetchBillingActiveUserIds(
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
