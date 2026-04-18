"use client";

import { useEffect, useMemo, useState } from "react";
import { parseSlackThreadUrl } from "@/lib/slack";
import {
  formatSlackChannelHash,
  slackStoredChannelNameLooksLikeChannelId,
} from "@/lib/slackDisplay";
import { resolveSlackChannelLabelFromId } from "@/server/actions/slack";

/**
 * Header label for Slack dialogs: prefers the goal’s channel **name**, and resolves the
 * channel id via Slack API when the stored value is missing or looks like a raw `C…` / `G…` id.
 */
export function useResolvedSlackChannelLabel(
  open: boolean,
  channelName: string,
  channelId: string,
  slackUrl?: string
): string {
  const effectiveChannelId = useMemo(() => {
    const fromProps = channelId.trim();
    if (fromProps) return fromProps;
    const su = slackUrl?.trim();
    if (su) {
      const p = parseSlackThreadUrl(su);
      return p?.channelId?.trim() ?? "";
    }
    return "";
  }, [channelId, slackUrl]);

  const rawName = channelName.trim();

  const [resolvedName, setResolvedName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResolvedName(null);
      return;
    }

    const needApi =
      Boolean(effectiveChannelId) &&
      (!rawName || slackStoredChannelNameLooksLikeChannelId(rawName));

    if (!needApi) {
      setResolvedName(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const r = await resolveSlackChannelLabelFromId(effectiveChannelId);
      if (!cancelled && r.ok) setResolvedName(r.name);
      else if (!cancelled) setResolvedName(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, effectiveChannelId, rawName]);

  const displayName = useMemo(() => {
    if (rawName && !slackStoredChannelNameLooksLikeChannelId(rawName)) {
      return rawName;
    }
    if (resolvedName?.trim()) return resolvedName.trim();
    return rawName;
  }, [rawName, resolvedName]);

  return formatSlackChannelHash(displayName || effectiveChannelId);
}
