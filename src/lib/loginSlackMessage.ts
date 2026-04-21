/** URL sent in the Slack invite so recipients know where to sign in. */
export const PORTFOLIO_OS_LOGIN_URL = "https://admin.mlabs.vc";

/**
 * Shown only in the in-app Slack preview — the real password is generated on send
 * (`GENERATED_PASSWORD_LEN` in auth-admin).
 */
export const LOGIN_SLACK_MESSAGE_PREVIEW_PASSWORD =
  "••••••••••••••••••••••••";

export function trimSlackUserId(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

export function buildLoginSlackMessage(options: {
  /** Slack user id for `<@…>` so the recipient is @-mentioned and notified. */
  targetSlackUserId: string;
  email: string;
  password: string;
  isResend: boolean;
}): string {
  const { targetSlackUserId, email, password, isResend } = options;
  const mention = `<@${trimSlackUserId(targetSlackUserId)}>`;
  const headline = isResend
    ? `Hey ${mention}, here's a fresh password for our Portfolio OS system.`
    : `Hey ${mention}, I've given you access to our Portfolio OS system.`;
  const instruction = isResend
    ? `Use the new password below to sign in at ${PORTFOLIO_OS_LOGIN_URL}.`
    : `Please sign in at ${PORTFOLIO_OS_LOGIN_URL} with your work email and the password below.`;
  return [
    headline,
    "",
    instruction,
    "",
    `Email: ${email}`,
    `Password: \`${password}\``,
    "",
    "Let me or Nadav know once you're in.",
  ].join("\n");
}
