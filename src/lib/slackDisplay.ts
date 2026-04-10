/** Normalize a Slack channel name for display (leading #, trimmed). */
export function formatSlackChannelHash(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}
