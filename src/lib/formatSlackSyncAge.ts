/**
 * Short relative label for “last Slack sync” hints (sidebar, etc.).
 * Returns empty when unknown or unparseable.
 */
export function formatSlackSyncAge(
  iso: string | null | undefined,
  now = new Date()
): string {
  if (!iso?.trim()) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const sec = Math.floor((now.getTime() - t.getTime()) / 1000);
  if (sec < 0) return "just now";
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
