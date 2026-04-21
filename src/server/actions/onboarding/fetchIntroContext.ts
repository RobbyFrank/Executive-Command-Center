import type { Person } from "@/lib/types/tracker";
import { buildPersonLabelMap } from "@/server/actions/executiveDigest/prompt";
import { redactIntroContext } from "@/lib/redactIntroContext";
import {
  fetchConversationMembers,
  fetchDmHistory,
  fetchUserIms,
  fetchUserMpims,
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

/** Run async work in fixed-size batches to parallelize Slack calls without huge bursts. */
async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const part = await Promise.all(
      batch.map((item, j) => fn(item, i + j))
    );
    out.push(...part);
  }
  return out;
}

export type FetchIntroContextOptions = {
  maxMessages?: number;
  /** Short status lines for streaming UIs (pilot recommender, etc.). */
  onProgress?: (message: string) => void;
  /** Display name for progress copy, e.g. roster `Person.name`. */
  newHireName?: string;
};

/**
 * Collects up to `maxMessages` most recent top-level DM/MPIM messages with the new hire,
 * merged across all IMs and MPIMs the Slack user token is in that include them.
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

  const channelIds: string[] = [];

  onProgress?.("Slack: listing group DMs (MPIMs)…");
  const mpims = await fetchUserMpims();
  if (!mpims.ok) {
    onProgress?.(`Slack: could not list MPIMs (${mpims.error}). Continuing without group-DM scan.`);
  } else {
    const mpimChannels = mpims.channels.filter((ch) => ch.id);
    onProgress?.(
      `Slack: ${mpimChannels.length} group DM(s) — checking which include ${name}…`
    );
    const memberResults = await mapInBatches(
      mpimChannels,
      8,
      async (ch, idx) => {
        if (idx % 16 === 0 && idx > 0) {
          onProgress?.(
            `Slack: scanned ${idx}/${mpimChannels.length} group DMs for ${name}…`
          );
        }
        const mem = await fetchConversationMembers(ch.id!);
        return { chId: ch.id!, mem };
      }
    );
    let mpimHits = 0;
    for (const { chId, mem } of memberResults) {
      if (mem.ok && mem.memberIds.includes(hid)) {
        channelIds.push(chId);
        mpimHits++;
      }
    }
    if (mpimHits > 0) {
      onProgress?.(
        `Slack: ${name} is in ${mpimHits} group DM channel(s).`
      );
    }
  }

  onProgress?.("Slack: listing 1:1 DMs…");
  const ims = await fetchUserIms();
  if (!ims.ok) {
    onProgress?.(`Slack: could not list IMs (${ims.error}).`);
  } else {
    const imChannels = ims.channels.filter((ch) => ch.id);
    onProgress?.(
      `Slack: ${imChannels.length} 1:1 DM(s) — checking which are with ${name}…`
    );
    const imMemberResults = await mapInBatches(
      imChannels,
      8,
      async (ch, idx) => {
        if (idx % 16 === 0 && idx > 0) {
          onProgress?.(
            `Slack: scanned ${idx}/${imChannels.length} 1:1 DMs…`
          );
        }
        const mem = await fetchConversationMembers(ch.id!);
        return { chId: ch.id!, mem };
      }
    );
    let imHits = 0;
    for (const { chId, mem } of imMemberResults) {
      if (mem.ok && mem.memberIds.includes(hid)) {
        channelIds.push(chId);
        imHits++;
      }
    }
    if (imHits > 0) {
      onProgress?.(`Slack: ${imHits} direct DM channel(s) with ${name}.`);
    }
  }

  const unique = [...new Set(channelIds)];
  if (unique.length === 0) {
    onProgress?.(
      `Slack: no shared DM/MPIM with ${name} (or token missing scopes). DM context empty.`
    );
    return { transcript: "", hadDmContext: false };
  }

  onProgress?.(
    `Slack: loading message history from ${unique.length} conversation(s) (up to ${maxMessages + 20} each)…`
  );

  const merged: SlackChannelHistoryMessage[] = [];
  await mapInBatches(unique, 4, async (cid, i) => {
    onProgress?.(
      `Slack: fetching messages ${i + 1}/${unique.length} (channel ${cid.slice(0, 8)}…)…`
    );
    const hist = await fetchDmHistory(cid, { maxMessages: maxMessages + 20 });
    if (hist.ok) merged.push(...hist.messages);
  });

  const sorted = sortByTsAsc(merged);
  const tail = sorted.slice(-maxMessages);

  onProgress?.(
    `Slack: merged ${merged.length} raw messages → ${tail.length} for the prompt.`
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
