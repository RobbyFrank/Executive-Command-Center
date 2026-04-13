/** Normalize a Slack channel name for display (leading #, trimmed). */
export function formatSlackChannelHash(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}

/**
 * Build a Slack deep-link for a channel. Uses the universal redirect
 * endpoint so it works in desktop, mobile, and browser.
 */
export function slackChannelUrl(channelId: string): string {
  const id = channelId.trim();
  if (!id) return "";
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(id)}`;
}
