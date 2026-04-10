/**
 * First whitespace-delimited segment of a full name — for compact Roadmap / filter UI.
 * Team roster and stored `Person.name` remain the full name.
 */
export function firstNameFromFullName(fullName: string): string {
  const t = fullName.trim();
  if (!t) return "";
  return t.split(/\s+/)[0] ?? "";
}
