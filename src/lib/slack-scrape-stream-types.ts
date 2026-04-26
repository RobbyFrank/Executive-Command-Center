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

/** NDJSON lines from `POST /api/companies/scrape-slack/run-all` (global "Sync all" from the review queue). */
export type SlackScanAllStreamPayload =
  | {
      type: "progress";
      phase: "company";
      total: number;
      completed: number;
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
      results: Array<{
        companyId: string;
        companyName: string;
        ok: boolean;
        pendingCount?: number;
        error?: string;
      }>;
    }
  | {
      type: "done";
      total: number;
      okCount: number;
      failCount: number;
      results: Array<{
        companyId: string;
        companyName: string;
        ok: boolean;
        pendingCount?: number;
        error?: string;
      }>;
    }
  | { type: "error"; message: string };
