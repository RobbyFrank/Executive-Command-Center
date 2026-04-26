import {
  fetchSlackThreadReplies,
  type SlackChannelHistoryMessage,
} from "@/lib/slack/threads";
import { mergeMessageAuthorsForChannel } from "@/lib/slackScrapeEnrich";

const DEFAULT_MAX_THREADS = 200;
const DEFAULT_CONCURRENCY = 4;

type ThreadTask = { channelId: string; channelName: string; rootTs: string };

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Appends `↳` thread lines under each root message, up to `maxThreads` fetches
 * and `concurrency` parallel Slack API calls.
 */
export async function buildTranscriptWithThreads(
  channelName: string,
  channelId: string,
  rootMessages: SlackChannelHistoryMessage[],
  options: { maxThreads?: number; concurrency?: number } = {}
): Promise<{
  extraLines: string;
  messageAuthors: Map<string, string>;
}> {
  const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const messageAuthors = new Map<string, string>();
  const tasks: ThreadTask[] = [];

  const roots = rootMessages
    .filter((m) => m.ts)
    .slice()
    .sort((a, b) => b.ts.localeCompare(a.ts));

  for (const m of roots) {
    if (tasks.length >= maxThreads) break;
    const rc = m.reply_count;
    if (rc === 0) continue;
    if (rc === undefined || rc > 0) {
      tasks.push({ channelId, channelName, rootTs: m.ts });
    }
  }

  if (tasks.length === 0) {
    return { extraLines: "", messageAuthors };
  }

  const threadResults = await runPool(
    tasks,
    concurrency,
    async (t) => fetchSlackThreadReplies(t.channelId, t.rootTs)
  );

  const lines: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const tr = threadResults[i]!;
    if (!tr || !tr.ok) continue;
    const forMerge: SlackChannelHistoryMessage[] = tr.messages
      .filter((x) => x.ts)
      .map((x) => ({
        ts: x.ts,
        user: x.user,
        text: x.text,
        bot_id: x.bot_id,
        thread_ts: t.rootTs,
      }));
    mergeMessageAuthorsForChannel(messageAuthors, t.channelName, forMerge);
    for (const m of tr.messages) {
      if (!m.ts) continue;
      if (m.ts === t.rootTs) continue;
      const text = (m.text ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const who = m.user ?? m.bot_id ?? "?";
      lines.push(
        `  ↳ [${m.ts}] user_or_bot=${who} (thread ${t.rootTs}) ${text}`
      );
    }
  }

  if (lines.length > 0) {
    return {
      extraLines: `\n--- thread replies in #${channelName} ---\n${lines.join(
        "\n"
      )}\n`,
      messageAuthors,
    };
  }
  return { extraLines: "", messageAuthors };
}
