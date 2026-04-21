import type { SlackChannel } from "@/lib/slack";
import { SLACK_CHANNELS_LIST_CACHE_TTL_MS } from "@/lib/slackChannelsCacheConstants";

export { SLACK_CHANNELS_LIST_CACHE_TTL_MS };

type SlackChannelsCacheEntry = {
  fetchedAt: number;
  channels: SlackChannel[];
  notice: string | null;
};

let cache: SlackChannelsCacheEntry | null = null;

/** Last successful `fetchSlackChannelsList` result if still within TTL; otherwise `null`. */
export function getFreshSlackChannelsListCache(): SlackChannelsCacheEntry | null {
  const c = cache;
  if (!c || Date.now() - c.fetchedAt >= SLACK_CHANNELS_LIST_CACHE_TTL_MS) {
    return null;
  }
  return c;
}

/** Store a successful channel list (same as SlackChannelPicker after fetch). */
export function putSlackChannelsListCache(
  channels: SlackChannel[],
  notice: string | null
): void {
  cache = { fetchedAt: Date.now(), channels, notice };
}

/**
 * Prepend a freshly-created channel onto the cache so the next picker open shows it
 * without another `conversations.list` round-trip. No-op when the cache is empty (the
 * next open will fetch normally and include the new channel).
 */
export function prependChannelToSlackChannelsListCache(
  channel: SlackChannel
): void {
  const c = cache;
  if (!c) return;
  if (c.channels.some((x) => x.id === channel.id)) return;
  cache = { ...c, channels: [channel, ...c.channels] };
}
