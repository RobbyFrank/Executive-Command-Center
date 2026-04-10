/**
 * Slack member (user) IDs are uppercase `U` + 10 alphanumeric characters.
 * @see https://api.slack.com/reference/block-kit/blocks#slack_user_ids
 */
export const SLACK_USER_ID_RE = /^U[A-Z0-9]{10}$/i;

export const SLACK_USER_ID_PLACEHOLDER = "U09684T0D0X";

export function slackUserIdValidationError(): string {
  return "Use a Slack user ID (U + 10 characters, e.g. U09684T0D0X) or leave empty.";
}

/** Empty string, or a normalized Slack user ID, or null if invalid. */
export function parseSlackUserIdInput(raw: string): "" | string | null {
  const t = raw.trim();
  if (t === "") return "";
  if (!SLACK_USER_ID_RE.test(t)) return null;
  return t.toUpperCase();
}
