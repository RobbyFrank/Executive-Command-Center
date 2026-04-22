import type {
  UnrepliedScanPanelState,
  UnrepliedScanProgressEvent,
} from "@/lib/unrepliedAsksScanTypes";

export const initialScanPanelState: UnrepliedScanPanelState = {
  open: false,
  phase: "idle",
  founderNames: [],
  search: null,
  classify: null,
  threads: null,
  persist: false,
  error: null,
  complete: null,
};

export function openScanPanel(): UnrepliedScanPanelState {
  return {
    ...initialScanPanelState,
    open: true,
    phase: "init",
  };
}

export function applyScanProgressEvent(
  prev: UnrepliedScanPanelState,
  ev: UnrepliedScanProgressEvent
): UnrepliedScanPanelState {
  switch (ev.type) {
    case "init":
      return { ...prev, phase: "init", lookbackDays: ev.lookbackDays };
    case "founders":
      return {
        ...prev,
        phase: "founders",
        founderNames: ev.names,
      };
    case "slack_search_start":
      return {
        ...prev,
        phase: "search",
        search: {
          founderIndex: ev.founderIndex,
          founderTotal: ev.founderTotal,
          founderName: ev.founderName,
          candidatesTotal: prev.search?.candidatesTotal ?? 0,
        },
      };
    case "slack_search_done":
      return {
        ...prev,
        phase: "search",
        search: {
          founderIndex: ev.founderIndex,
          founderTotal: ev.founderTotal,
          founderName: ev.founderName,
          candidatesTotal: ev.candidatesTotal,
        },
      };
    case "classify_start":
      return {
        ...prev,
        phase: "classify",
        classify: { done: 0, total: ev.total },
      };
    case "classify_progress":
      return {
        ...prev,
        phase: "classify",
        classify: { done: ev.done, total: ev.total },
      };
    case "threads_start":
      return {
        ...prev,
        phase: "threads",
        threads: { done: 0, total: ev.total },
      };
    case "threads_progress":
      return {
        ...prev,
        phase: "threads",
        threads: { done: ev.done, total: ev.total },
      };
    case "persist_start":
      return { ...prev, phase: "persist", persist: true };
    case "persist_done":
      return { ...prev, persist: true };
    case "complete":
      return {
        ...prev,
        phase: "complete",
        complete: {
          newClassified: ev.newClassified,
          threadRefreshes: ev.threadRefreshes,
          threadErrors: ev.threadErrors,
        },
      };
    case "error":
      return {
        ...prev,
        phase: "error",
        error: ev.message,
        open: true,
      };
    default:
      return prev;
  }
}
