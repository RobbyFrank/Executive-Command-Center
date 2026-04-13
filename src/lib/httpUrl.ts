/** True when `raw` is a parseable http(s) URL (same rules as roadmap link cells). */
export function isValidHttpUrl(raw: string): boolean {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
