/**
 * Best-effort PII scrub before sending DM transcripts to Claude.
 * Conservative: strips common patterns; may redact non-PII in edge cases.
 */
export function redactIntroContext(text: string): string {
  let s = text;
  // Email
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");
  // Phone-like (+digits, or digit groups)
  s = s.replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]");
  // Passport-like (alphanumeric 6+ after "passport" context - skip generic)
  s = s.replace(/\b[A-Z]{1,2}\d{6,9}\b/g, "[id]");
  // Long digit runs (bank account-ish)
  s = s.replace(/\b\d{10,}\b/g, "[digits]");
  return s;
}
