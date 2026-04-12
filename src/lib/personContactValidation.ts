import { z } from "zod";

/** After trim; empty is allowed. */
export function isValidPersonEmail(trimmed: string): boolean {
  return trimmed === "" || z.string().email().safeParse(trimmed).success;
}

/** After trim; empty is allowed. Uses digit count 7–15 (E.164-style upper bound). */
export function isValidPersonPhone(trimmed: string): boolean {
  if (trimmed === "") return true;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function personEmailValidationError(draft: string): string | undefined {
  const t = draft.trim();
  if (isValidPersonEmail(t)) return undefined;
  return "Enter a valid email address.";
}

export function personPhoneValidationError(draft: string): string | undefined {
  const t = draft.trim();
  if (isValidPersonPhone(t)) return undefined;
  return "Phone must include 7–15 digits.";
}
