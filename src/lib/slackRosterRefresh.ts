"use client";

import { toast } from "sonner";
import { refreshPersonFromSlack } from "@/server/actions/slack";

/**
 * Fetches Slack profile (name, email, avatar) in the background and calls `refreshRoute` when done.
 * Does not block the caller — safe to call from save handlers and menu actions.
 */
export function scheduleSlackProfileRefresh(
  personId: string,
  slackHandle: string,
  refreshRoute: () => void
): void {
  const h = slackHandle.trim();
  if (!h) return;

  void (async () => {
    const r = await refreshPersonFromSlack(personId, h);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    if (r.avatarWarning) {
      toast.warning(`${r.person.name}: profile photo not updated`, {
        description: r.avatarWarning,
      });
    }
    toast.success(`Updated ${r.person.name} from Slack`);
    refreshRoute();
  })();
}
