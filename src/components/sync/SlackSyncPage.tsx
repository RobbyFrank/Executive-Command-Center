"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pin,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Person } from "@/lib/types/tracker";
import {
  listPendingForReviewDashboard,
  bulkApproveForCompany,
  type PendingWithCompanyName,
} from "@/server/actions/slackSuggestions";
import { SlackSuggestionRow } from "@/components/tracker/SlackSuggestionRow";
import { SlackLogo } from "@/components/tracker/SlackLogo";
import {
  matchesSuggestionFilter,
  type SuggestionFilterId,
} from "@/lib/slackSuggestionFilters";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  SlackScanAllPlanCompany,
  SlackScanAllStage,
  SlackScanAllStreamPayload,
  SlackScanCompanyStats,
} from "@/lib/slack-scrape-stream-types";

const STAGE_LABELS: Record<SlackScanAllStage, string> = {
  starting: "Starting",
  history: "Reading Slack history",
  analyzing: "Analyzing transcript",
  reconciling: "Reconciling with roadmap",
  writing: "Saving suggestions",
};

/** Fallback per-company ETA before the plan event arrives (or for runs with no channels). */
const SECONDS_PER_COMPANY_ESTIMATE = 45;
/** Average per-unit ETA (one channel fetch or one AI call). */
const SECONDS_PER_UNIT_ESTIMATE = 1.5;

const FILTER_LABELS: { id: SuggestionFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New goals & projects" },
  { id: "edits", label: "Edits" },
  { id: "status", label: "Status changes" },
  { id: "dates", label: "Date changes" },
  { id: "owner", label: "Owner / assignee" },
];

type SyncResult = {
  companyId: string;
  companyName: string;
  ok: boolean;
  pendingCount?: number;
  error?: string;
  stats?: SlackScanCompanyStats;
};

type SyncCompanyEntry = {
  id: string;
  name: string;
  logoPath?: string;
  /** Filled in once the server emits its `plan` event. */
  channelCount?: number;
};

type SyncProgress = {
  total: number;
  completed: number;
  okCount: number;
  failCount: number;
  /** Total work units (channels to fetch + AI call per company). Set by the plan event. */
  totalUnits?: number;
  /** Work units finished so far. Streamed from the server. */
  unitsDone?: number;
  /** Total channels across all companies in this run. */
  totalChannels?: number;
  currentCompanyId?: string;
  currentCompanyName?: string;
  currentStage?: SlackScanAllStage;
  channels?: { total: number; done: number; failed: number; current?: string };
  results: SyncResult[];
  /** Companies in this run, in the order the server processes them. Used to show a per-company list. */
  scopedCompanies?: SyncCompanyEntry[];
  /** When set, the current run is scoped to a single company (label only). */
  scopeLabel?: string;
  /** When the run finished. */
  finishedAt?: number;
};

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s`;
  const m = Math.round(seconds / 60);
  return `~${m}m`;
}

type CompanyRowStatus = "queued" | "in_progress" | "done" | "failed";

type CompanyProgressRow = {
  entry: SyncCompanyEntry;
  status: CompanyRowStatus;
  result?: SyncResult;
};

/**
 * Order: completed (in stream order), then in-progress, then queued.
 * Falls back to a name-only stub when results reference companies not in the
 * scoped list (shouldn't happen but defends against client/server drift).
 */
function buildCompanyProgressRows(progress: SyncProgress): CompanyProgressRow[] {
  const scoped = progress.scopedCompanies ?? [];
  const scopedById = new Map(scoped.map((c) => [c.id, c]));
  const seenInResults = new Set<string>();
  const rows: CompanyProgressRow[] = [];

  for (const r of progress.results) {
    seenInResults.add(r.companyId);
    rows.push({
      entry: scopedById.get(r.companyId) ?? {
        id: r.companyId,
        name: r.companyName,
      },
      status: r.ok ? "done" : "failed",
      result: r,
    });
  }

  if (
    progress.currentCompanyId &&
    !seenInResults.has(progress.currentCompanyId)
  ) {
    rows.push({
      entry: scopedById.get(progress.currentCompanyId) ?? {
        id: progress.currentCompanyId,
        name: progress.currentCompanyName ?? progress.currentCompanyId,
      },
      status: "in_progress",
    });
  }

  for (const c of scoped) {
    if (seenInResults.has(c.id)) continue;
    if (c.id === progress.currentCompanyId) continue;
    rows.push({ entry: c, status: "queued" });
  }

  return rows;
}

function formatChars(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * One-line summary of why a successful run produced 0 new pending suggestions.
 * Goes through possible causes in priority order so the UI is honest about which one.
 */
function explainZeroNew(stats: SlackScanCompanyStats): string {
  if (stats.channelsScanned === 0) return "No matching Slack channels";
  if (stats.totalMessages === 0) return "No new Slack messages in window";
  if (stats.modelOutputChars === 0) return "Model returned no text";
  if (stats.parsedItemCount === 0) {
    return `Claude found nothing in ${stats.totalMessages} msgs`;
  }
  if (stats.freshCount === 0) {
    return `${stats.parsedItemCount} found · all rejected (validation)`;
  }
  if (stats.pendingCount === 0 && stats.freshCount > 0) {
    return `${stats.freshCount} found · all already known`;
  }
  return "No new";
}

function buildStatsTooltip(stats: SlackScanCompanyStats): string {
  const lines: string[] = [];
  lines.push(
    `Channels: ${stats.channelsWithMessages}/${stats.channelsScanned} with messages (${stats.totalMessages} msgs)`
  );
  lines.push(
    `Transcript: ${formatChars(stats.transcriptChars)} chars${
      stats.transcriptChars === stats.maxTranscriptChars &&
      stats.maxTranscriptChars > 0
        ? ` (capped at ${formatChars(stats.maxTranscriptChars)})`
        : ""
    }`
  );
  lines.push(`Model output: ${formatChars(stats.modelOutputChars)} chars`);
  lines.push(
    `Parsed: ${stats.parsedItemCount} · validation rejects: ${stats.schemaRejectedOrInvalidCount}`
  );
  const dedupDrop = Math.max(0, stats.freshCount - stats.pendingCount);
  lines.push(
    `Accepted: ${stats.freshCount} · pending after dedup: ${stats.pendingCount}${
      dedupDrop > 0 ? ` (${dedupDrop} dedup'd)` : ""
    }`
  );
  return lines.join("\n");
}

function CompanyProgressRowItem({
  row,
  stage,
  channels,
}: {
  row: CompanyProgressRow;
  stage?: SlackScanAllStage;
  channels?: SyncProgress["channels"];
}) {
  const { entry, status, result } = row;
  let icon: React.ReactNode;
  let detail: React.ReactNode;
  let tooltip: string | undefined;
  switch (status) {
    case "in_progress": {
      icon = (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300"
          aria-hidden
        />
      );
      const label = STAGE_LABELS[stage ?? "starting"];
      const channelHint =
        stage === "history" && channels
          ? ` (${channels.done}/${channels.total})`
          : "";
      detail = (
        <span className="truncate text-zinc-300">
          {label}
          {channelHint}
        </span>
      );
      break;
    }
    case "done": {
      icon = (
        <CheckCircle2
          className="h-3.5 w-3.5 shrink-0 text-emerald-300"
          aria-hidden
        />
      );
      const n = result?.pendingCount ?? 0;
      const stats = result?.stats;
      if (stats) tooltip = buildStatsTooltip(stats);
      if (n > 0) {
        detail = <span className="text-emerald-300">{n} new</span>;
      } else if (stats) {
        detail = (
          <span className="text-zinc-500">{explainZeroNew(stats)}</span>
        );
      } else {
        detail = <span className="text-zinc-500">No new</span>;
      }
      break;
    }
    case "failed": {
      icon = (
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0 text-rose-300"
          aria-hidden
        />
      );
      detail = (
        <span className="truncate text-rose-300/85" title={result?.error}>
          {result?.error ?? "Failed"}
        </span>
      );
      break;
    }
    default: {
      icon = (
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600"
          aria-hidden
        />
      );
      const n = entry.channelCount;
      detail = (
        <span className="text-zinc-500">
          {typeof n === "number"
            ? n === 0
              ? "Queued · no channels"
              : `Queued · ${n} ${n === 1 ? "channel" : "channels"}`
            : "Queued"}
        </span>
      );
    }
  }

  return (
    <li
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-900/50"
      title={tooltip}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <CompanyLogo logoPath={entry.logoPath} name={entry.name} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium",
          status === "in_progress"
            ? "text-zinc-100"
            : status === "queued"
              ? "text-zinc-400"
              : "text-zinc-200"
        )}
      >
        {entry.name}
      </span>
      <span className="ml-auto min-w-0 max-w-[60%] truncate text-right text-[11px]">
        {detail}
      </span>
    </li>
  );
}

function SyncProgressPanel({
  syncing,
  progress,
}: {
  syncing: boolean;
  progress: SyncProgress;
}) {
  const total = progress.total || 0;
  const completed = progress.completed || 0;
  const totalUnits = progress.totalUnits ?? 0;
  const unitsDone = progress.unitsDone ?? 0;
  /** Prefer unit-based fraction (smooth per channel + AI step) once the plan event has arrived. */
  const fraction =
    totalUnits > 0
      ? unitsDone / totalUnits
      : total > 0
        ? completed / total
        : 0;
  const unitsRemaining = Math.max(0, totalUnits - unitsDone);
  const companiesRemaining = Math.max(0, total - completed);
  const etaSeconds =
    totalUnits > 0
      ? unitsRemaining * SECONDS_PER_UNIT_ESTIMATE
      : companiesRemaining * SECONDS_PER_COMPANY_ESTIMATE;
  const companyRows = useMemo(
    () => buildCompanyProgressRows(progress),
    [progress]
  );

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-100">
          {syncing ? "Syncing" : "Last sync"}
          {progress.scopeLabel ? (
            <>
              {" "}
              <span className="text-zinc-400">({progress.scopeLabel})</span>
            </>
          ) : null}
        </span>
        <span className="tabular-nums text-zinc-400">
          {totalUnits > 0 ? (
            <>
              {unitsDone}/{totalUnits}{" "}
              <span className="text-zinc-500">units</span>{" "}
              <span className="text-zinc-600">
                ({completed}/{total} co)
              </span>
            </>
          ) : (
            <>
              {completed}/{total}
            </>
          )}
          {syncing && etaSeconds > 0 ? (
            <>
              {" · "}
              <span className="text-zinc-500">
                {formatEta(etaSeconds)} left
              </span>
            </>
          ) : null}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none",
            progress.failCount > 0
              ? "bg-gradient-to-r from-cyan-500 via-cyan-400 to-rose-400"
              : "bg-gradient-to-r from-cyan-500 to-emerald-400"
          )}
          style={{
            width: `${Math.max(2, Math.round(fraction * 100))}%`,
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1 text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          <span className="tabular-nums">{progress.okCount} ok</span>
        </span>
        {progress.failCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">{progress.failCount} failed</span>
          </span>
        ) : null}
        {!syncing && progress.results.length > 0 ? (
          <span className="text-zinc-500">
            {progress.results.reduce(
              (sum, r) => sum + (r.pendingCount ?? 0),
              0
            )}{" "}
            new pending
          </span>
        ) : null}
        {syncing &&
        progress.currentStage === "history" &&
        progress.channels?.current ? (
          <span className="ml-auto truncate text-zinc-500">
            #{progress.channels.current}
            {progress.channels.failed > 0 ? (
              <span className="ml-1 text-amber-400/80">
                · {progress.channels.failed} ch failed
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {companyRows.length > 0 ? (
        <ul className="space-y-0.5 border-t border-zinc-800/80 pt-2">
          {companyRows.map((row) => (
            <CompanyProgressRowItem
              key={row.entry.id}
              row={row}
              stage={progress.currentStage}
              channels={progress.channels}
            />
          ))}
        </ul>
      ) : null}
      {syncing ? (
        <p className="border-t border-zinc-800/80 pt-2 text-[11px] leading-snug text-amber-200/80">
          Keep this tab open. Closing or refreshing cancels the sync.
        </p>
      ) : null}
    </div>
  );
}

function SyncAllConfirmModal({
  open,
  onCancel,
  onConfirm,
  companyCount,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  companyCount: number;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const estSeconds = Math.max(60, companyCount * SECONDS_PER_COMPANY_ESTIMATE);
  const etaLabel = formatEta(estSeconds);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm Sync all"
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-[min(420px,100%)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="space-y-2 px-5 pt-5 pb-3 text-xs leading-relaxed text-zinc-400">
          <h3 className="text-sm font-semibold text-zinc-100">
            Sync Slack for all {companyCount} companies?
          </h3>
          <p>
            Reads the last 2 days of Slack per company and refreshes the review
            queue with new suggestions.{" "}
            <span className="text-zinc-200">~{etaLabel.replace(/^~/, "")}.</span>
          </p>
          <p>
            The work runs on our server, but progress is streamed to this tab —
            <span className="text-zinc-300">
              {" "}
              refreshing the page cancels the run
            </span>
            . The same job runs automatically every night, so this is just a
            manual refresh.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-950/80 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Start sync
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CancelSyncConfirmModal({
  open,
  onKeepRunning,
  onConfirm,
  progress,
}: {
  open: boolean;
  onKeepRunning: () => void;
  onConfirm: () => void;
  progress: SyncProgress | null;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onKeepRunning();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeepRunning]);

  if (!open) return null;

  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  const remaining = Math.max(0, total - completed);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cancel Slack sync"
    >
      <button
        type="button"
        onClick={onKeepRunning}
        aria-label="Keep running"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-[min(420px,100%)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="space-y-2 px-5 pt-5 pb-3 text-xs leading-relaxed text-zinc-400">
          <h3 className="text-sm font-semibold text-zinc-100">Cancel sync?</h3>
          <p>
            {total > 0 ? (
              <>
                <span className="text-zinc-200">
                  {completed}/{total}
                </span>{" "}
                done
                {remaining > 0 ? (
                  <>
                    {" — "}
                    <span className="text-zinc-300">
                      {remaining}{" "}
                      {remaining === 1 ? "company" : "companies"} left
                    </span>
                  </>
                ) : null}
                . Already-finished companies stay in the queue.
              </>
            ) : (
              "Stop the in-progress sync. Anything completed so far stays in the queue."
            )}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-950/80 px-5 py-3">
          <button
            type="button"
            onClick={onKeepRunning}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            Keep running
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/25"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Cancel sync
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CompanyLogo({
  logoPath,
  name,
}: {
  logoPath?: string;
  name: string;
}) {
  const src = (logoPath ?? "").trim();
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local /uploads + remote blob URLs (same as CompanySection)
      <img
        src={src}
        alt=""
        className="h-5 w-5 shrink-0 rounded-sm object-cover ring-1 ring-zinc-800"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-zinc-900 ring-1 ring-zinc-800"
      aria-hidden
      title={name}
    >
      <Building2 className="h-3 w-3 text-zinc-500" />
    </span>
  );
}

type PageCompany = {
  id: string;
  name: string;
  /** Same source as Roadmap header logos (`/uploads/...` or remote URL). */
  logoPath?: string;
  pinned?: boolean;
};

export function SlackSyncPage({
  people,
  companies = [],
  slackPendingByCompany = {},
}: {
  people: Person[];
  /** All companies in Roadmap display order — pinned first, then revenue desc. */
  companies?: PageCompany[];
  /** Pending count per company (badge in the Sync dropdown). */
  slackPendingByCompany?: Record<string, number>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PendingWithCompanyName[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SuggestionFilterId>("all");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const syncStartRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPendingForReviewDashboard();
      setItems(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      syncAbortRef.current?.abort();
    };
  }, []);

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  // Close the filter dropdown on outside click / Escape.
  useEffect(() => {
    if (!filterMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!filterMenuRef.current) return;
      if (!filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFilterMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterMenuOpen]);

  const runSync = useCallback(
    async (opts: { companyIds?: string[]; scopeLabel?: string } = {}) => {
      if (syncing) return;
      setSyncing(true);
      syncStartRef.current = Date.now();
      const filterSet = opts.companyIds ? new Set(opts.companyIds) : null;
      const scopedCompanies: SyncCompanyEntry[] = companies
        .filter((c) => (filterSet ? filterSet.has(c.id) : true))
        .map((c) => ({ id: c.id, name: c.name, logoPath: c.logoPath }));
      setSyncProgress({
        total: scopedCompanies.length,
        completed: 0,
        okCount: 0,
        failCount: 0,
        results: [],
        scopedCompanies,
        scopeLabel: opts.scopeLabel,
      });
      const ac = new AbortController();
      syncAbortRef.current = ac;
      try {
        const res = await fetch("/api/companies/scrape-slack/run-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyIds: opts.companyIds ?? null,
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Sync failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        // Refresh the visible queue every time another company finishes,
        // so suggestions appear progressively instead of only at the end.
        let lastResultsLen = 0;

        const handleEvent = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let evt: SlackScanAllStreamPayload | null = null;
          try {
            evt = JSON.parse(trimmed) as SlackScanAllStreamPayload;
          } catch {
            return;
          }
          if (evt.type === "plan") {
            const e = evt;
            setSyncProgress((prev) => {
              const channelCountById = new Map<string, number>(
                e.companies.map((p: SlackScanAllPlanCompany) => [
                  p.companyId,
                  p.channelCount,
                ])
              );
              const merged = (prev?.scopedCompanies ?? []).map((c) => ({
                ...c,
                channelCount: channelCountById.get(c.id) ?? c.channelCount,
              }));
              return {
                total: prev?.total ?? e.companies.length,
                completed: prev?.completed ?? 0,
                okCount: prev?.okCount ?? 0,
                failCount: prev?.failCount ?? 0,
                totalUnits: e.totalUnits,
                unitsDone: prev?.unitsDone ?? 0,
                totalChannels: e.totalChannels,
                results: prev?.results ?? [],
                scopedCompanies: merged,
                scopeLabel: prev?.scopeLabel,
              };
            });
          } else if (evt.type === "progress" && evt.phase === "company") {
            const e = evt;
            setSyncProgress((prev) => ({
              total: e.total,
              completed: e.completed,
              okCount: e.okCount,
              failCount: e.failCount,
              totalUnits: e.totalUnits ?? prev?.totalUnits,
              unitsDone: e.unitsDone ?? prev?.unitsDone,
              totalChannels: prev?.totalChannels,
              currentCompanyId: e.currentCompanyId,
              currentCompanyName: e.currentCompanyName,
              currentStage: e.currentStage,
              channels: e.channels,
              results: e.results,
              scopedCompanies: prev?.scopedCompanies,
              scopeLabel: prev?.scopeLabel,
            }));
            if (e.results.length > lastResultsLen) {
              lastResultsLen = e.results.length;
              void load();
            }
          } else if (evt.type === "done") {
            const e = evt;
            setSyncProgress((prev) => ({
              total: e.total,
              completed: e.total,
              okCount: e.okCount,
              failCount: e.failCount,
              totalUnits: e.totalUnits ?? prev?.totalUnits,
              unitsDone: e.unitsDone ?? prev?.unitsDone,
              totalChannels: prev?.totalChannels,
              results: e.results,
              scopedCompanies: prev?.scopedCompanies,
              scopeLabel: prev?.scopeLabel,
              finishedAt: Date.now(),
            }));
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          let idx = buffered.indexOf("\n");
          while (idx >= 0) {
            handleEvent(buffered.slice(0, idx));
            buffered = buffered.slice(idx + 1);
            idx = buffered.indexOf("\n");
          }
        }
        if (buffered.trim()) handleEvent(buffered);

        toast.success(
          opts.scopeLabel
            ? `Slack sync complete — ${opts.scopeLabel}`
            : "Slack sync complete"
        );
        await load();
        router.refresh();
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") {
          toast.message("Sync cancelled.");
          return;
        }
        toast.error(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncing(false);
        syncAbortRef.current = null;
        syncStartRef.current = null;
      }
    },
    [companies, syncing, load, router]
  );

  const cancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  const filtered = useMemo(
    () => items.filter((r) => matchesSuggestionFilter(r, filter)),
    [items, filter]
  );

  const byCompany = useMemo(() => {
    const m = new Map<string, PendingWithCompanyName[]>();
    for (const r of filtered) {
      const k = r.companyId;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [filtered]);

  const chipCounts = useMemo(() => {
    const out: Record<SuggestionFilterId, number> = {
      all: items.length,
      new: 0,
      edits: 0,
      status: 0,
      dates: 0,
      owner: 0,
    };
    for (const r of items) {
      for (const { id } of FILTER_LABELS) {
        if (id === "all") continue;
        if (matchesSuggestionFilter(r, id)) out[id] += 1;
      }
    }
    return out;
  }, [items]);

  const pendingTotal = items.length;

  return (
    <div className="pb-10">
      <div className="sticky top-0 z-30 -mx-6 mb-6 border-b border-zinc-800/80 bg-zinc-950/90 px-6 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3">
          <h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-zinc-100">
            <SlackLogo
              className="h-4 w-4 opacity-80 grayscale"
              alt=""
            />
            Slack Sync
          </h1>
          <p className="hidden min-w-0 flex-1 truncate text-xs text-zinc-400 lg:block">
            <span className="mr-1.5 text-zinc-600">·</span>
            {pendingTotal} pending across the portfolio
          </p>
          <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
            <div ref={pickerRef} className="relative inline-flex items-stretch">
              <button
                type="button"
                onClick={() => {
                  if (syncing) {
                    setConfirmCancelOpen(true);
                    return;
                  }
                  setConfirmAllOpen(true);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-l-md border px-3 text-xs font-medium transition-colors",
                  syncing
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                    : "border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                )}
                title={
                  syncing
                    ? "Cancel the in-progress sync"
                    : "Sync Slack roadmap for every company (same pipeline as the daily cron)"
                }
              >
                {syncing ? (
                  <X className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                {syncing ? "Cancel sync" : "Sync all companies"}
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                disabled={syncing || companies.length === 0}
                aria-haspopup="menu"
                aria-expanded={pickerOpen}
                title="Sync a specific company"
                className={cn(
                  "inline-flex h-8 items-center justify-center rounded-r-md border border-l-0 border-cyan-500/30 bg-cyan-500/10 px-2 text-cyan-100 transition-colors hover:bg-cyan-500/20",
                  "disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              {pickerOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-10 mt-1.5 max-h-[60vh] w-72 overflow-y-auto overscroll-contain rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl ring-1 ring-black/30"
                >
                  <div className="sticky top-0 border-b border-zinc-800 bg-zinc-950/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur">
                    Sync a specific company
                  </div>
                  <ul className="py-1">
                    {companies.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-zinc-500">
                        No companies.
                      </li>
                    ) : (
                      companies.map((c) => {
                        const n = slackPendingByCompany[c.id] ?? 0;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setPickerOpen(false);
                                void runSync({
                                  companyIds: [c.id],
                                  scopeLabel: c.name,
                                });
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
                            >
                              <CompanyLogo
                                logoPath={c.logoPath}
                                name={c.name}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {c.name}
                              </span>
                              {c.pinned ? (
                                <Pin
                                  className="h-3 w-3 shrink-0 text-amber-400/85"
                                  aria-label="Pinned"
                                />
                              ) : null}
                              {n > 0 ? (
                                <span className="shrink-0 tabular-nums rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200 ring-1 ring-cyan-500/30">
                                  {n > 9 ? "9+" : n}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-6">
        {(syncing || syncProgress) && syncProgress ? (
          <SyncProgressPanel syncing={syncing} progress={syncProgress} />
        ) : null}

        <div ref={filterMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setFilterMenuOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={filterMenuOpen}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-900",
              filterMenuOpen && "border-zinc-700 bg-zinc-900"
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Filter
              </span>
              <span className="truncate text-zinc-100">
                {FILTER_LABELS.find((f) => f.id === filter)?.label ?? "All"}
              </span>
              <span className="tabular-nums text-zinc-500">
                ({chipCounts[filter]})
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-150",
                filterMenuOpen && "rotate-180"
              )}
              aria-hidden
            />
          </button>
          {filterMenuOpen ? (
            <div
              role="listbox"
              className="absolute left-0 right-0 z-10 mt-1.5 max-h-[60vh] overflow-y-auto overscroll-contain rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl ring-1 ring-black/30"
            >
              <ul className="py-1">
                {FILTER_LABELS.map(({ id, label }) => {
                  const selected = id === filter;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setFilter(id);
                          setFilterMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                          selected
                            ? "bg-violet-600/15 text-violet-100"
                            : "text-zinc-200 hover:bg-zinc-900"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Check
                            className={cn(
                              "h-3 w-3 shrink-0",
                              selected
                                ? "text-violet-300"
                                : "text-transparent"
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{label}</span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums text-[10px]",
                            selected ? "text-violet-200" : "text-zinc-500"
                          )}
                        >
                          {chipCounts[id]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-400">
            Nothing in this filter.
          </p>
        ) : (
          <div className="space-y-8">
            {[...byCompany.entries()].map(([cid, rows]) => (
              <section key={cid}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    {rows[0]?.companyName ?? cid}
                    <span className="ml-2 tabular-nums text-zinc-600">
                      ({rows.length})
                    </span>
                  </h3>
                  <button
                    type="button"
                    className="text-[11px] text-violet-400 hover:underline"
                    onClick={async () => {
                      const r = await bulkApproveForCompany(cid);
                      if (r.errors.length) {
                        toast.error(r.errors.slice(0, 2).join("; "));
                      } else {
                        toast.success(`Approved ${r.count} for company`);
                      }
                      await load();
                      router.refresh();
                    }}
                  >
                    Approve all here
                  </button>
                </div>
                <div className="space-y-2">
                  {rows.map((rec) => (
                    <SlackSuggestionRow
                      key={rec.id}
                      rec={rec}
                      people={people}
                      compact
                      onResolved={load}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <SyncAllConfirmModal
        open={confirmAllOpen}
        companyCount={companies.length}
        onCancel={() => setConfirmAllOpen(false)}
        onConfirm={() => {
          setConfirmAllOpen(false);
          void runSync();
        }}
      />
      <CancelSyncConfirmModal
        open={confirmCancelOpen}
        progress={syncProgress}
        onKeepRunning={() => setConfirmCancelOpen(false)}
        onConfirm={() => {
          setConfirmCancelOpen(false);
          cancelSync();
        }}
      />
    </div>
  );
}
