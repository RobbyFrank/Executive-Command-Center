/**
 * NDJSON stream events for `/api/unreplied-asks/scan` and optional `onProgress` on
 * {@link runUnrepliedAsksScan} (server only for the runner).
 */
export type UnrepliedScanProgressEvent =
  | { type: "init"; lookbackDays: number }
  | { type: "founders"; count: number; names: string[] }
  | {
      type: "slack_search_start";
      founderIndex: number;
      founderTotal: number;
      founderName: string;
    }
  | {
      type: "slack_search_done";
      founderIndex: number;
      founderTotal: number;
      founderName: string;
      newMessagesThisFounder: number;
      candidatesTotal: number;
    }
  | { type: "classify_start"; total: number }
  | { type: "classify_progress"; done: number; total: number }
  | { type: "threads_start"; total: number }
  | { type: "threads_progress"; done: number; total: number }
  | { type: "persist_start" }
  | { type: "persist_done" }
  | {
      type: "complete";
      newClassified: number;
      threadRefreshes: number;
      /** How many thread refreshes hit a Slack error (surfaced in the final banner when > 0). */
      threadErrors: number;
      founderCount: number;
    }
  | { type: "error"; message: string };

export type ScanPanelPhase =
  | "idle"
  | "init"
  | "founders"
  | "search"
  | "classify"
  | "threads"
  | "persist"
  | "complete"
  | "error";

export type UnrepliedScanPanelState = {
  open: boolean;
  phase: ScanPanelPhase;
  lookbackDays?: number;
  founderNames: string[];
  search: {
    founderIndex: number;
    founderTotal: number;
    founderName: string;
    candidatesTotal: number;
  } | null;
  classify: { done: number; total: number } | null;
  threads: { done: number; total: number } | null;
  persist: boolean;
  error: string | null;
  complete: {
    newClassified: number;
    threadRefreshes: number;
    threadErrors: number;
  } | null;
};
