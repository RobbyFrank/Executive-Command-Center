/**
 * Token helpers for Slack Web API (server-side).
 * @see module doc in `src/lib/slack/index.ts`
 */

export function slackToken(): string | undefined {
  const t = process.env.SLACK_BOT_USER_OAUTH_TOKEN?.trim();
  return t || undefined;
}

/**
 * Token for `conversations.list` (channel picker). User tokens list channels **that user**
 * can see; the bot token only lists private channels the **bot** has joined.
 * Precedence: dedicated var → billing user token (same xoxp- often works) → bot.
 */
export function slackTokenForConversationsList(): string | undefined {
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
export function billableInfoUserTokenHelp(): string {
  return (
    "Slack’s team.billableInfo method (per-member billing_active) does not accept bot tokens — you will get not_allowed_token_type if you use xoxb-. " +
    "It requires a user OAuth token with the admin user scope. The bot scope team.billing:read only applies to team.billing.info (workspace plan), not team.billableInfo. " +
    "In https://api.slack.com/apps → your app → OAuth & Permissions → User Token Scopes, add admin, reinstall the app to the workspace, run the OAuth redirect once as a workspace admin/owner, then put the user token (starts with xoxp-) in SLACK_BILLING_USER_TOKEN. " +
    "Keep using SLACK_BOT_USER_OAUTH_TOKEN for users.list."
  );
}
