/**
 * Workspace policy: channels whose Slack **name** contains "executive" must not be offered
 * for onboarding invites or appear in channel picker dropdowns.
 */
export function isExecutiveSlackChannelName(name: string): boolean {
  return name.trim().toLowerCase().includes("executive");
}
