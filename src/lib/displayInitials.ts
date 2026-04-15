/** Two-letter initials for avatar placeholders (names or Slack labels). */
export function displayInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`
      .toUpperCase()
      .slice(0, 2);
  }
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}
