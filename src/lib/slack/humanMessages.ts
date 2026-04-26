import type { SlackChannelHistoryMessage } from "@/lib/slack";

/**
 * True for messages authored by a real Slack user (not bot-only webhooks).
 * Used by Slack roadmap sync so automated billing/alerts don't drive new goals.
 */
export function isHumanTeamSlackMessage(
  m: Pick<SlackChannelHistoryMessage, "user" | "subtype">
): boolean {
  const u = (m.user ?? "").trim();
  if (!u) return false;
  if (m.subtype === "bot_message") return false;
  return true;
}
