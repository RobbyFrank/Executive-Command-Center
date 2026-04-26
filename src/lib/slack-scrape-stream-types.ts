import type {
  SlackScrapeSuggestion,
  SlackSuggestionRecord,
} from "@/lib/schemas/tracker";

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
  | { type: "progress"; phase: "model"; chunk: string }
  | {
      type: "done";
      suggestions: SlackScrapeSuggestion[];
      rejected: number;
      /** Authoritative queue for this company after merge (reconciliation). */
      pendingForCompany?: SlackSuggestionRecord[];
      reconcileFailed?: boolean;
    }
  | { type: "error"; message: string };

/** Sub-stage of the per-company pipeline (mirrors `SlackSyncStage` server-side). */
export type SlackScanAllStage =
  | "starting"
  | "history"
  | "analyzing"
  | "reconciling"
  | "writing";

export type SlackScanAllChannelStatus = "queued" | "running" | "done" | "failed";

/** Per-company plan emitted once at the start of `run-all` so the UI can size the progress bar by total work units. */
export type SlackScanAllPlanCompany = {
  companyId: string;
  companyName: string;
  /** Pre-resolved channel count for this company (0 when no channels match). */
  channelCount: number;
};

/**
 * Per-company diagnostic counters surfaced to the UI when a sync finishes,
 * so users can verify why a company ended up with "0 new" (e.g. transcript size,
 * model output length, parsed items, validation rejects, dedup drops).
 */
export type SlackScanCompanyStats = {
  channelsScanned: number;
  channelsWithMessages: number;
  totalMessages: number;
  transcriptChars: number;
  maxTranscriptChars: number;
  modelOutputChars: number;
  parsedItemCount: number;
  schemaRejectedOrInvalidCount: number;
  freshCount: number;
  pendingCount: number;
};

export type SlackScanAllResult = {
  companyId: string;
  companyName: string;
  ok: boolean;
  pendingCount?: number;
  error?: string;
  /** Diagnostic counters for this run (only present for successful runs). */
  stats?: SlackScanCompanyStats;
};

/** NDJSON lines from `POST /api/companies/scrape-slack/run-all` (global "Sync all" from the review queue). */
export type SlackScanAllStreamPayload =
  | {
      type: "plan";
      companies: SlackScanAllPlanCompany[];
      /** Sum of all per-company channelCount values. */
      totalChannels: number;
      /** Total work units (`totalChannels` + 1 AI call per company). */
      totalUnits: number;
    }
  | {
      type: "progress";
      phase: "company";
      total: number;
      completed: number;
      /** Total work units (channels + AI calls) for this run. Mirrors the plan event. */
      totalUnits?: number;
      /** Work units finished so far (each fetched channel + each completed AI call). */
      unitsDone?: number;
      currentCompanyId?: string;
      currentCompanyName?: string;
      currentStage?: SlackScanAllStage;
      /** Per-channel progress for the **current** company (cleared when moving to the next). */
      channels?: {
        total: number;
        done: number;
        failed: number;
        current?: string;
      };
      okCount: number;
      failCount: number;
      results: SlackScanAllResult[];
    }
  | {
      type: "done";
      total: number;
      totalUnits?: number;
      unitsDone?: number;
      okCount: number;
      failCount: number;
      results: SlackScanAllResult[];
    }
  | { type: "error"; message: string };
