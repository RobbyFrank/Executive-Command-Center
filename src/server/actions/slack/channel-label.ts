"use server";

import { fetchSlackChannelNameById } from "@/lib/slack";

export async function resolveSlackChannelLabelFromId(
  channelId: string
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  return fetchSlackChannelNameById(channelId);
}
