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

export type {
  FetchSlackChannelsResult,
  SlackChannel,
} from "./channels";
export { fetchSlackChannels } from "./channels";
export {
  fetchSlackJoinDateFromProfileGet,
  joinDateFromSlackProfile,
  logSlackJoinDate,
} from "./profile-join-date";
export { fetchSlackUserById, fetchSlackWorkspaceMembers } from "./members";
export { slackUserTokenForThreads } from "./tokens";
export type { SlackBillingLabel, SlackMember } from "./types";
export {
  fetchSlackChannelHistory,
  fetchSlackThreadReplies,
  fetchSlackUserLabelForToken,
  getSlackMessagePermalink,
  parseSlackThreadUrl,
  postSlackChannelMessage,
  postSlackThreadReply,
  slackTsFromArchivesPDigits,
} from "./threads";
export type {
  ParsedSlackThreadUrl,
  SlackChannelHistoryMessage,
  SlackThreadApiMessage,
} from "./threads";
export {
  fetchSlackUserMessageHistory,
  slackTsToYmdUtc,
  type SlackUserMessageMatch,
  type SlackUserMessageKind,
} from "./user-messages";
export {
  fetchUserChannelMemberships,
  inviteUserToSlackChannel,
  type InviteErrorCode,
  type InviteOutcome,
  type UserChannelMembership,
} from "./memberships";
