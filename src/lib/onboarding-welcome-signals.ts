/** Loom: Slack communication guidelines (shared in onboarding welcomes). */
export const SLACK_GUIDELINES_LOOM_SHARE_ID =
  "284a2318019d4ee49c7c7774e36d1752";

export const SLACK_GUIDELINES_LOOM_URL =
  `https://www.loom.com/share/${SLACK_GUIDELINES_LOOM_SHARE_ID}`;

/**
 * True when the message is very likely Nadav's onboarding welcome: it asks the new hire
 * to watch the Slack guidelines video (Loom). This is used as a deterministic signal
 * before / instead of Claude classification.
 */
export function looksLikeSlackGuidelinesOnboardingWelcome(text: string): boolean {
  const t = text.toLowerCase();
  /** Direct link to our canonical guidelines recording (always embedded in onboarding welcomes). */
  if (t.includes(SLACK_GUIDELINES_LOOM_SHARE_ID.toLowerCase())) return true;

  const hasGuidelinePhrase =
    t.includes("guideline video") ||
    t.includes("guidelines video") ||
    (t.includes("guideline") && t.includes("video"));
  const workWithSlack =
    t.includes("work with slack") ||
    t.includes("how to work with slack") ||
    t.includes("for how to work with slack");
  /** Same copy Nadav uses when the Loom link unfurls as “Slack” only in the transcript. */
  if (hasGuidelinePhrase && workWithSlack) return true;

  const hasLoom = t.includes("loom.com");
  const mentionsSlack =
    t.includes(" slack") ||
    t.includes("slack ") ||
    t.includes("with slack") ||
    t.includes("work with slack");
  return (
    hasLoom &&
    (t.includes("guideline") || t.includes("guidelines")) &&
    mentionsSlack
  );
}
