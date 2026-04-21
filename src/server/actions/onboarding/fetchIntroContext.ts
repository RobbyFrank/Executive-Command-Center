import type { Person } from "@/lib/types/tracker";
import { buildPersonLabelMap } from "@/server/actions/executiveDigest/prompt";
import { redactIntroContext } from "@/lib/redactIntroContext";
import {
  fetchConversationMembers,
  fetchDmHistory,
  openSlackMpim,
  parseSlackThreadUrl,
  type SlackChannelHistoryMessage,
} from "@/lib/slack";
import { slackMessageTextForDisplay } from "@/lib/slackDisplay";

function sortByTsAsc(
  messages: SlackChannelHistoryMessage[]
): SlackChannelHistoryMessage[] {
  return [...messages].sort(
    (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
  );
}

function resolveOnboardingChannelIdFromPersonFields(options: {
  welcomeSlackChannelId?: string;
  welcomeSlackUrl?: string;
}): string | null {
  const id = (options.welcomeSlackChannelId ?? "").trim();
  if (id) return id;
  const parsed = parseSlackThreadUrl(options.welcomeSlackUrl ?? "");
  const fromUrl = parsed?.channelId?.trim();
  return fromUrl || null;
}

export type FetchIntroContextOptions = {
  maxMessages?: number;
  /** Short status lines for streaming UIs (pilot recommender, etc.). */
  onProgress?: (message: string) => void;
  /** Display name for progress copy, e.g. roster `Person.name`. */
  newHireName?: string;
  /**
   * Onboarding MPIM from the detector (`detectNewHires`). When set (and the new hire is a
   * member), only this conversation is loaded — no workspace-wide DM listing.
   */
  welcomeSlackChannelId?: string;
  /**
   * Permalink to the welcome message; channel id is parsed when `welcomeSlackChannelId` is empty.
   */
  welcomeSlackUrl?: string;
};

/**
 * Collects up to `maxMessages` most recent top-level messages from the new hire's **onboarding**
 * conversation: saved `welcomeSlackChannelId` / `welcomeSlackUrl` when valid, otherwise the
 * 1:1 DM opened via `conversations.open` (no full `conversations.list` sweep).
 */
export async function fetchIntroContextForNewHire(
  newHireSlackId: string,
  people: Person[],
  options: FetchIntroContextOptions = {}
): Promise<{
  transcript: string;
  hadDmContext: boolean;
}> {
  const maxMessages = options.maxMessages ?? 50;
  const onProgress = options.onProgress;
  const name = (options.newHireName ?? "new hire").trim() || "new hire";

  const hid = newHireSlackId.trim().toUpperCase();
  if (!hid) {
    onProgress?.("Slack: no Slack user ID on roster — skipping DM context.");
    return { transcript: "", hadDmContext: false };
  }

  const labelMap = buildPersonLabelMap(
    people.map((p) => ({ slackHandle: p.slackHandle, name: p.name }))
  );

  const resolvedChannelId = resolveOnboardingChannelIdFromPersonFields({
    welcomeSlackChannelId: options.welcomeSlackChannelId,
    welcomeSlackUrl: options.welcomeSlackUrl,
  });

  let channelId: string | null = null;

  if (resolvedChannelId) {
    onProgress?.("Slack: checking saved onboarding channel…");
    const mem = await fetchConversationMembers(resolvedChannelId);
    if (mem.ok && mem.memberIds.includes(hid)) {
      channelId = resolvedChannelId;
      onProgress?.("Slack: using onboarding channel from roster.");
    } else if (mem.ok) {
      onProgress?.(
        "Slack: saved onboarding channel does not include this person — opening 1:1 DM…"
      );
    } else {
      onProgress?.(
        `Slack: could not read saved onboarding channel (${mem.error}) — opening 1:1 DM…`
      );
    }
  }

  if (!channelId) {
    onProgress?.("Slack: opening direct message with new hire…");
    const opened = await openSlackMpim([hid]);
    if (!opened.ok) {
      onProgress?.(
        `Slack: could not open DM (${opened.error}). No DM transcript.`
      );
      return { transcript: "", hadDmContext: false };
    }
    channelId = opened.channelId;
  }

  onProgress?.(
    `Slack: fetching messages (up to ${maxMessages + 20})…`
  );
  const hist = await fetchDmHistory(channelId, {
    maxMessages: maxMessages + 20,
  });
  if (!hist.ok) {
    onProgress?.(`Slack: could not load history (${hist.error}).`);
    return { transcript: "", hadDmContext: false };
  }

  const sorted = sortByTsAsc(hist.messages);
  const tail = sorted.slice(-maxMessages);

  onProgress?.(
    `Slack: ${hist.messages.length} raw messages → ${tail.length} for the prompt.`
  );

  const lines: string[] = [];
  for (const m of tail) {
    const uid = m.user?.trim().toUpperCase() ?? "";
    const who = uid ? (labelMap.get(uid) ?? uid) : "app/bot";
    const text = slackMessageTextForDisplay(m.text ?? "", 1200, labelMap);
    lines.push(`[${who}]: ${text}`);
  }

  const raw = lines.join("\n\n");
  return {
    transcript: redactIntroContext(raw),
    hadDmContext: true,
  };
}
