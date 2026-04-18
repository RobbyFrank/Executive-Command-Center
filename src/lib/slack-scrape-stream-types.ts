import type { SlackScrapeSuggestion } from "@/lib/schemas/tracker";

export type SlackChannelHistoryEntryStatus =
  | "queued"
  | "running"
  | "done"
  | "failed";

/** NDJSON lines from `POST /api/companies/scrape-slack/run` when the body is streamed. */
export type SlackScanStreamPayload =
  | {
      type: "progress";
      phase: "history";
      entries: Array<{
        id: string;
        name: string;
        status: SlackChannelHistoryEntryStatus;
        detail?: string;
        messageCount?: number;
      }>;
      completed: number;
      total: number;
    }
  | { type: "progress"; phase: "model"; message: string }
  | { type: "done"; suggestions: SlackScrapeSuggestion[]; rejected: number }
  | { type: "error"; message: string };
