"use client";

import { toast } from "sonner";
import {
  refreshPersonFromSlack,
  type RefreshPersonResult,
} from "@/server/actions/slack";

export type SlackProfileRefreshHooks = {
  onStart?: () => void;
  /** Called with the server result before route refresh (use to merge local roster state). */
  onResult?: (result: RefreshPersonResult) => void;
};

/**
 * Fetches Slack profile (name, email, avatar) in the background and calls `refreshRoute` when done.
 * Does not block the caller — safe to call from save handlers and menu actions.
 */
export function scheduleSlackProfileRefresh(
  personId: string,
  slackHandle: string,
  refreshRoute: () => void,
  hooks?: SlackProfileRefreshHooks
): void {
  const h = slackHandle.trim();
  if (!h) return;

  void (async () => {
    hooks?.onStart?.();
    const r = await refreshPersonFromSlack(personId, h);
    hooks?.onResult?.(r);
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
