/** Mirrors Slack billing UI for import: full members vs guests. */
export type SlackBillingLabel = "Active" | "Active guest";

export type SlackMember = {
  id: string;
  realName: string;
  displayName: string;
  email: string;
  /** Best available profile image URL (typically image_192). */
  avatarUrl: string;
  /** `YYYY-MM-DD` from `profile.start_date` when Slack provides it (e.g. Slack Atlas). */
  joinDate: string;
  /** Multi-channel or single-channel guest (`is_restricted` / `is_ultra_restricted`). */
  isGuest: boolean;
  /** For Import dialog: Fair Billing active member vs active guest. */
  billingLabel: SlackBillingLabel;
  isBot: boolean;
  deleted: boolean;
};

export type SlackProfile = {
  real_name?: string;
  display_name?: string;
  email?: string;
  /** Org join date when Slack Atlas (or equivalent) exposes it. */
  start_date?: string;
  /** Custom profile fields (may include ISO hire dates). */
  fields?: Record<string, { value?: string; alt?: string }>;
  image_192?: string;
  image_512?: string;
  image_72?: string;
};
