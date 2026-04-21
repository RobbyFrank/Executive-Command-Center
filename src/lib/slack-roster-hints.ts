import type { Person } from "@/lib/types/tracker";
import type { SlackMemberRosterHint } from "@/server/actions/slack";

/** Roster hints for Slack AI drafts (names + avatars for display resolution). */
export function slackRosterHintsFromPeople(
  people: Person[]
): SlackMemberRosterHint[] {
  return people
    .filter((p) => p.slackHandle.trim() !== "")
    .map((p) => ({
      slackUserId: p.slackHandle,
      name: p.name,
      profilePicturePath: p.profilePicturePath.trim() || undefined,
    }));
}
