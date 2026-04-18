"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  Loader2,
  Quote,
  Sparkles,
  Target,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { CompanyWithGoals, Person } from "@/lib/types/tracker";
import type { SlackScrapeSuggestion } from "@/lib/schemas/tracker";
import {
  resolveCompanyScrapeChannels,
  slackScrapeChannelSelectedByDefault,
  type CompanyScrapeChannelRow,
} from "@/lib/scrapeCompanyChannels";
import {
  getFreshSlackChannelsListCache,
  putSlackChannelsListCache,
} from "@/lib/slackChannelsListClientCache";
import { createScrapedItems } from "@/server/actions/tracker";
import { fetchSlackChannelsList } from "@/server/actions/slack";
import { slackChannelUrl } from "@/lib/slackDisplay";
import { consumeNdjsonStream } from "@/lib/ndjsonConsumeStream";
import type {
  SlackChannelHistoryEntryStatus,
  SlackScanStreamPayload,
} from "@/lib/slack-scrape-stream-types";
import { SlackLogo } from "./SlackLogo";
import { cn } from "@/lib/utils";

function PriorityPill({ priority }: { priority: string }) {
  const color =
    priority === "P0"
      ? "border-red-900/60 bg-red-950/50 text-red-200"
      : priority === "P1"
        ? "border-amber-900/60 bg-amber-950/40 text-amber-200"
        : priority === "P2"
          ? "border-sky-900/60 bg-sky-950/40 text-sky-200"
          : "border-zinc-700 bg-zinc-900 text-zinc-300";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold tracking-wide",
        color
      )}
    >
      {priority}
    </span>
  );
}

function ScanEntryStatusIcon({ status }: { status: SlackChannelHistoryEntryStatus }) {
  switch (status) {
    case "queued":
      return (
        <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
      );
    case "running":
      return (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400"
          aria-hidden
        />
      );
    case "done":
      return (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
      );
    case "failed":
      return (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
      );
    default:
      return null;
  }
}

interface CompanyScrapeDialogProps {
  open: boolean;
  onClose: () => void;
  company: CompanyWithGoals;
  people: Person[];
}

export function CompanyScrapeDialog({
  open,
  onClose,
  company,
  people,
}: CompanyScrapeDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<"config" | "review">("config");
  const [days, setDays] = useState(14);
  const [channelRows, setChannelRows] = useState<CompanyScrapeChannelRow[]>([]);
  const [channelsNotice, setChannelsNotice] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(
    new Set()
  );

  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgressEntries, setScanProgressEntries] = useState<
    Array<{
      id: string;
      name: string;
      status: SlackChannelHistoryEntryStatus;
      detail?: string;
      messageCount?: number;
    }>
  >([]);
  const [scanPhaseMessage, setScanPhaseMessage] = useState("");
  const [scanBarFraction, setScanBarFraction] = useState(0);
  const [scanModelText, setScanModelText] = useState("");
  const scanAbortRef = useRef<AbortController | null>(null);
  const modelStreamRef = useRef<HTMLDivElement | null>(null);
  const [suggestions, setSuggestions] = useState<SlackScrapeSuggestion[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);

  const [goalChecked, setGoalChecked] = useState<boolean[]>([]);
  const [projectChecked, setProjectChecked] = useState<boolean[][]>([]);
  const [existingProjChecked, setExistingProjChecked] = useState<boolean[]>(
    []
  );
  const [expandedGoalIdx, setExpandedGoalIdx] = useState<Set<number>>(
    () => new Set()
  );
  const [importing, setImporting] = useState(false);

  const personNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) {
      m.set(p.id, p.name);
    }
    return m;
  }, [people]);

  const newGoalSuggestions = useMemo(
    () =>
      suggestions.filter(
        (s): s is Extract<SlackScrapeSuggestion, { kind: "newGoalWithProjects" }> =>
          s.kind === "newGoalWithProjects"
      ),
    [suggestions]
  );

  const existingProjectSuggestions = useMemo(
    () =>
      suggestions.filter(
        (
          s
        ): s is Extract<
          SlackScrapeSuggestion,
          { kind: "newProjectOnExistingGoal" }
        > => s.kind === "newProjectOnExistingGoal"
      ),
    [suggestions]
  );

  const abortScan = useCallback(() => {
    scanAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const el = modelStreamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scanModelText]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (scanLoading) {
        e.preventDefault();
        abortScan();
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, scanLoading, abortScan]);

  useEffect(() => {
    if (!open) return;

    setStage("config");
    setDays(14);
    setChannelRows([]);
    setChannelsNotice(null);
    setChannelsError(null);
    setScanError(null);
    setScanProgressEntries([]);
    setScanPhaseMessage("");
    setScanBarFraction(0);
    setScanModelText("");
    scanAbortRef.current = null;
    setSuggestions([]);
    setRejectedCount(0);
    setGoalChecked([]);
    setProjectChecked([]);
    setExistingProjChecked([]);
    setExpandedGoalIdx(new Set());

    let cancelled = false;
    setChannelsLoading(true);

    void (async () => {
      const cached = getFreshSlackChannelsListCache();
      let allChannels;
      let notice: string | null;
      if (cached) {
        allChannels = cached.channels;
        notice = cached.notice;
      } else {
        const r = await fetchSlackChannelsList();
        if (cancelled) return;
        if (!r.ok) {
          setChannelsLoading(false);
          setChannelsError(r.error);
          return;
        }
        allChannels = r.channels;
        notice = r.notice ?? null;
        putSlackChannelsListCache(allChannels, notice);
      }

      if (cancelled) return;
      setChannelsLoading(false);

      const rows = resolveCompanyScrapeChannels({
        company,
        goalsForCompany: company.goals,
        allChannels,
      });
      setChannelRows(rows);
      setChannelsNotice(notice);
      setSelectedChannelIds(
        new Set(
          rows.filter(slackScrapeChannelSelectedByDefault).map((c) => c.id)
        )
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [open, company]);

  const toggleChannel = useCallback((id: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllChannels = useCallback(() => {
    setSelectedChannelIds(new Set(channelRows.map((c) => c.id)));
  }, [channelRows]);

  const clearChannels = useCallback(() => {
    setSelectedChannelIds(new Set());
  }, []);

  const runScan = useCallback(async () => {
    if (selectedChannelIds.size === 0) {
      toast.error("Select at least one channel");
      return;
    }

    let cancelToastShown = false;
    scanAbortRef.current = new AbortController();
    const { signal } = scanAbortRef.current;

    setScanLoading(true);
    setScanError(null);
    setScanProgressEntries([]);
    setScanPhaseMessage("Starting…");
    setScanBarFraction(0.02);
    setScanModelText("");

    try {
      const r = await fetch("/api/companies/scrape-slack/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          channelIds: [...selectedChannelIds],
          days,
        }),
        signal,
      });

      const ct = r.headers.get("content-type") ?? "";

      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setScanError(
          typeof data.error === "string" ? data.error : "Scan failed"
        );
        return;
      }

      if (!ct.includes("ndjson")) {
        setScanError("Unexpected response from scan.");
        return;
      }

      let terminal = false;
      await consumeNdjsonStream<SlackScanStreamPayload>(
        r,
        (p) => {
          if (p.type === "progress" && p.phase === "history") {
            setScanProgressEntries(p.entries);
            if (p.total > 0) {
              setScanBarFraction(
                Math.min(0.88, 0.05 + (p.completed / p.total) * 0.83)
              );
            }
            setScanPhaseMessage(
              p.completed < p.total
                ? `Loading Slack history (${p.completed}/${p.total})…`
                : "Finishing…"
            );
          } else if (p.type === "progress" && p.phase === "model") {
            if ("chunk" in p) {
              setScanBarFraction((prev) => Math.min(0.98, Math.max(prev, 0.94)));
              setScanModelText((prev) => prev + p.chunk);
            } else {
              setScanBarFraction(0.92);
              setScanPhaseMessage(p.message);
            }
          } else if (p.type === "done") {
            terminal = true;
            const sug = p.suggestions ?? [];
            setSuggestions(sug);
            setRejectedCount(
              typeof p.rejected === "number" ? p.rejected : 0
            );

            const ng = sug.filter(
              (
                s
              ): s is Extract<
                SlackScrapeSuggestion,
                { kind: "newGoalWithProjects" }
              > => s.kind === "newGoalWithProjects"
            );
            const ex = sug.filter(
              (
                s
              ): s is Extract<
                SlackScrapeSuggestion,
                { kind: "newProjectOnExistingGoal" }
              > => s.kind === "newProjectOnExistingGoal"
            );

            setGoalChecked(ng.map(() => true));
            setProjectChecked(ng.map((g) => g.projects.map(() => true)));
            setExistingProjChecked(ex.map(() => true));
            setExpandedGoalIdx(new Set(ng.map((_, i) => i)));
            setScanBarFraction(1);
            setStage("review");
          } else if (p.type === "error") {
            terminal = true;
            setScanError(p.message || "Scan failed");
          }
        },
        signal
      );

      if (!terminal && !signal.aborted) {
        setScanError("Scan ended without a result.");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        if (!cancelToastShown) {
          cancelToastShown = true;
          toast.message("Cancelled.");
        }
      } else {
        setScanError(
          e instanceof Error ? e.message : "Scan failed unexpectedly."
        );
      }
    } finally {
      setScanLoading(false);
      scanAbortRef.current = null;
      setScanPhaseMessage("");
      setScanBarFraction(0);
      setScanProgressEntries([]);
      setScanModelText("");
    }
  }, [company.id, days, selectedChannelIds]);

  const setGoalCheckAt = useCallback((idx: number, checked: boolean) => {
    setGoalChecked((prev) => {
      const next = [...prev];
      next[idx] = checked;
      return next;
    });
    if (checked) {
      setProjectChecked((prev) => {
        const row = newGoalSuggestions[idx];
        if (!row) return prev;
        const next = [...prev];
        next[idx] = row.projects.map(() => true);
        return next;
      });
    }
  }, [newGoalSuggestions]);

  const setProjectCheckAt = useCallback(
    (goalIdx: number, projIdx: number, checked: boolean) => {
      setProjectChecked((prev) => {
        const next = prev.map((row) => [...row]);
        if (!next[goalIdx]) return prev;
        next[goalIdx][projIdx] = checked;
        return next;
      });
    },
    []
  );

  const toggleGoalExpand = useCallback((idx: number) => {
    setExpandedGoalIdx((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }, []);

  const importPayload = useMemo(() => {
    const bundles: {
      goal: (typeof newGoalSuggestions)[0]["goal"];
      projects: (typeof newGoalSuggestions)[0]["projects"];
    }[] = [];

    for (let i = 0; i < newGoalSuggestions.length; i++) {
      const s = newGoalSuggestions[i];
      const gOn = goalChecked[i] ?? false;
      const pRow = projectChecked[i] ?? [];
      const wantProjects = s.projects.filter((_, j) => pRow[j]);
      if (!gOn && wantProjects.length === 0) continue;
      bundles.push({
        goal: s.goal,
        projects: wantProjects,
      });
    }

    const projectsOnExistingGoals: {
      goalId: string;
      project: (typeof existingProjectSuggestions)[0]["project"];
    }[] = [];
    for (let k = 0; k < existingProjectSuggestions.length; k++) {
      if (!existingProjChecked[k]) continue;
      const s = existingProjectSuggestions[k];
      projectsOnExistingGoals.push({
        goalId: s.existingGoalId,
        project: s.project,
      });
    }

    return { bundles, projectsOnExistingGoals };
  }, [
    newGoalSuggestions,
    existingProjectSuggestions,
    goalChecked,
    projectChecked,
    existingProjChecked,
  ]);

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const b of importPayload.bundles) {
      n += 1 + b.projects.length;
    }
    n += importPayload.projectsOnExistingGoals.length;
    return n;
  }, [importPayload]);

  const onImport = useCallback(async () => {
    if (selectedCount === 0) {
      toast.error("Select at least one goal or project");
      return;
    }
    setImporting(true);
    try {
      const r = await createScrapedItems({
        companyId: company.id,
        bundles: importPayload.bundles,
        projectsOnExistingGoals: importPayload.projectsOnExistingGoals,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        selectedCount === 1
          ? "Added 1 item"
          : `Added ${selectedCount} items`
      );
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not add items"
      );
    } finally {
      setImporting(false);
    }
  }, [
    company.id,
    importPayload.bundles,
    importPayload.projectsOnExistingGoals,
    onClose,
    router,
    selectedCount,
  ]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          if (!scanLoading) onClose();
        }}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Slack scan for ${company.name}`}
        className="relative z-10 flex max-h-[min(92dvh,960px)] min-h-0 w-[min(900px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-6 border-b border-zinc-700/80 px-6 py-5">
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="inline-flex items-center gap-3 text-lg font-semibold tracking-tight text-zinc-100">
              <SlackLogo alt="" className="h-6 w-6 opacity-90" />
              {stage === "config" ? "Scan Slack" : "Review suggestions"}
            </h2>
            <p className="text-sm text-zinc-400">
              {company.name} —{" "}
              {stage === "config"
                ? "Choose channels and how far back to read, then run the scan."
                : "Select goals and projects to add to the roadmap."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {stage === "config" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                "min-h-0 flex-1 px-6 py-5",
                scanLoading
                  ? "flex min-h-0 flex-col overflow-hidden"
                  : "space-y-4 overflow-y-auto overscroll-contain"
              )}
            >
              {!scanLoading ? (
                <>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                      <span className="text-zinc-500">Days of history</span>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={days}
                        onChange={(e) =>
                          setDays(
                            Math.min(
                              90,
                              Math.max(1, Number(e.target.value) || 14)
                            )
                          )
                        }
                        className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={selectAllChannels}
                      className="text-sm text-blue-400 hover:underline"
                    >
                      Select all channels
                    </button>
                    <button
                      type="button"
                      onClick={clearChannels}
                      className="text-sm text-zinc-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                  {channelsNotice ? (
                    <p className="text-xs text-amber-200/90">
                      {channelsNotice}
                    </p>
                  ) : null}
                  {channelsLoading ? (
                    <div className="space-y-2 pr-1">
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading channels…
                      </div>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
                        >
                          <div className="h-4 w-4 shrink-0 rounded border border-zinc-700 bg-zinc-900" />
                          <div
                            className="h-3 animate-pulse rounded bg-zinc-800"
                            style={{ width: `${30 + ((i * 13) % 45)}%` }}
                          />
                          <div className="ml-auto h-3 w-10 animate-pulse rounded bg-zinc-900" />
                        </div>
                      ))}
                    </div>
                  ) : channelsError ? (
                    <p className="text-sm text-red-400">{channelsError}</p>
                  ) : channelRows.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No channels matched this company (name/shortName) and no
                      goals link a Slack channel. Add a Slack channel on a goal
                      or widen naming.
                    </p>
                  ) : (
                    <ul className="space-y-2 pr-1">
                      {channelRows.map((ch) => (
                        <li key={ch.id}>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm hover:bg-zinc-900/80">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600"
                              checked={selectedChannelIds.has(ch.id)}
                              onChange={() => toggleChannel(ch.id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-zinc-200">
                                #{ch.name}
                              </span>
                              <span className="ml-2 text-xs text-zinc-500">
                                {ch.matchedByName ? "Name match" : ""}
                                {ch.linkedToGoalIds.length > 0 ? (
                                  <>
                                    {ch.matchedByName ? " · " : ""}
                                    Linked to {ch.linkedToGoalIds.length} goal
                                    {ch.linkedToGoalIds.length !== 1
                                      ? "s"
                                      : ""}
                                  </>
                                ) : null}
                              </span>
                            </span>
                            <a
                              href={slackChannelUrl(ch.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 text-xs text-blue-400 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Open
                            </a>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
              {scanLoading ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="shrink-0 space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-200">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-400" />
                        <span className="truncate">
                          {scanPhaseMessage || "Working…"}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                        {Math.round(scanBarFraction * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-600 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                        style={{
                          width: `${Math.max(2, Math.round(scanBarFraction * 100))}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-5">
                    {scanProgressEntries.length > 0 ? (
                      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/40 md:col-span-2">
                        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                          <span>Channels</span>
                          <span className="text-zinc-600">
                            {
                              scanProgressEntries.filter(
                                (e) => e.status === "done"
                              ).length
                            }
                            /{scanProgressEntries.length}
                          </span>
                        </div>
                        <ul
                          className="min-h-0 flex-1 overflow-y-auto py-1 text-xs"
                          aria-live="polite"
                        >
                          {scanProgressEntries.map((e) => (
                            <li
                              key={e.id}
                              className="flex items-start gap-2 px-3 py-1.5 text-zinc-300"
                            >
                              <span className="mt-0.5">
                                <ScanEntryStatusIcon status={e.status} />
                              </span>
                              <span className="min-w-0 flex-1 leading-snug">
                                <span className="font-medium text-zinc-200">
                                  #{e.name}
                                </span>
                                {e.status === "done" &&
                                typeof e.messageCount === "number" ? (
                                  <span className="ml-2 text-zinc-500">
                                    {e.messageCount} msg
                                    {e.messageCount !== 1 ? "s" : ""}
                                  </span>
                                ) : null}
                                {e.status === "failed" && e.detail ? (
                                  <span className="mt-0.5 block text-amber-200/90">
                                    {e.detail}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/40",
                        scanProgressEntries.length > 0
                          ? "md:col-span-3"
                          : "md:col-span-5"
                      )}
                    >
                      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                        <span>Analyzing</span>
                      </div>
                      <div
                        ref={modelStreamRef}
                        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400"
                      >
                        {scanModelText ? (
                          <>
                            <span className="whitespace-pre-wrap break-words">
                              {scanModelText}
                            </span>
                            <span
                              className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-sky-400 align-[-1px]"
                              aria-hidden
                            />
                          </>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="h-2 w-5/6 animate-pulse rounded bg-zinc-800" />
                            <div className="h-2 w-2/3 animate-pulse rounded bg-zinc-800" />
                            <div className="h-2 w-4/5 animate-pulse rounded bg-zinc-800" />
                            <div className="h-2 w-1/2 animate-pulse rounded bg-zinc-800" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {scanError ? (
                <p className="shrink-0 text-sm text-red-400">{scanError}</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-4">
              {scanLoading ? (
                <button
                  type="button"
                  onClick={abortScan}
                  className="rounded-lg border border-red-900/80 bg-red-950/50 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-950"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={
                  channelsLoading ||
                  !!channelsError ||
                  channelRows.length === 0 ||
                  selectedChannelIds.size === 0 ||
                  scanLoading
                }
                onClick={() => void runScan()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {scanLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning…
                  </>
                ) : (
                  "Scan"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-5">
              {newGoalSuggestions.length === 0 &&
              existingProjectSuggestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-10 text-center">
                  <Sparkles className="h-6 w-6 text-zinc-600" />
                  <p className="text-sm font-medium text-zinc-300">
                    Nothing new to add
                  </p>
                  <p className="max-w-sm text-xs text-zinc-500">
                    The scan didn&apos;t find goals or projects that
                    aren&apos;t already on the roadmap. Try more channels or a
                    longer time window.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
                  <Sparkles className="h-4 w-4 text-sky-400" />
                  <p className="text-sm text-zinc-300">
                    <span className="font-semibold text-zinc-100">
                      {newGoalSuggestions.length}
                    </span>{" "}
                    new goal{newGoalSuggestions.length === 1 ? "" : "s"}
                    {" · "}
                    <span className="font-semibold text-zinc-100">
                      {existingProjectSuggestions.length}
                    </span>{" "}
                    project
                    {existingProjectSuggestions.length === 1 ? "" : "s"} on
                    existing goals
                  </p>
                  {rejectedCount > 0 ? (
                    <span className="ml-auto text-xs text-zinc-500">
                      {rejectedCount} skipped (invalid)
                    </span>
                  ) : null}
                </div>
              )}

              {newGoalSuggestions.length > 0 ? (
                <section>
                  <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Target className="h-3.5 w-3.5" />
                    New goals
                  </h3>
                  <ul className="space-y-3">
                    {newGoalSuggestions.map((s, i) => {
                      const isSelected = goalChecked[i] ?? false;
                      const projectRow = projectChecked[i] ?? [];
                      const projectsPicked = projectRow.filter(Boolean).length;
                      const isExpanded = expandedGoalIdx.has(i);
                      return (
                        <li
                          key={`ng-${i}`}
                          className={cn(
                            "overflow-hidden rounded-xl border transition-colors",
                            isSelected
                              ? "border-sky-900/60 bg-sky-950/10"
                              : "border-zinc-800 bg-zinc-950/40"
                          )}
                        >
                          <div className="flex items-start gap-3 p-4">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-600"
                              checked={isSelected}
                              onChange={(e) =>
                                setGoalCheckAt(i, e.target.checked)
                              }
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-start gap-2">
                                <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-100">
                                  {s.goal.description}
                                </p>
                                <PriorityPill priority={s.goal.priority} />
                              </div>
                              {s.goal.measurableTarget ? (
                                <p className="text-xs text-zinc-400">
                                  <span className="text-zinc-500">
                                    Target:{" "}
                                  </span>
                                  {s.goal.measurableTarget}
                                </p>
                              ) : null}
                              {s.goal.whyItMatters ? (
                                <p className="text-xs text-zinc-500">
                                  {s.goal.whyItMatters}
                                </p>
                              ) : null}
                              {s.goal.slackChannel || s.goal.ownerPersonId ? (
                                <p className="text-[11px] text-zinc-500">
                                  {s.goal.slackChannel ? (
                                    <span className="text-zinc-400">
                                      #{s.goal.slackChannel}
                                    </span>
                                  ) : null}
                                  {s.goal.slackChannel && s.goal.ownerPersonId ? (
                                    <span className="text-zinc-600"> · </span>
                                  ) : null}
                                  {s.goal.ownerPersonId ? (
                                    <span>
                                      Owner{" "}
                                      <span className="text-zinc-300">
                                        {personNameById.get(s.goal.ownerPersonId) ??
                                          s.goal.ownerPersonId}
                                      </span>
                                    </span>
                                  ) : null}
                                </p>
                              ) : null}
                              {s.evidence[0] ? (
                                <div className="flex items-start gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-3 py-2">
                                  <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs italic leading-snug text-zinc-300">
                                      “{s.evidence[0].quote.slice(0, 180)}
                                      {s.evidence[0].quote.length > 180
                                        ? "…"
                                        : ""}
                                      ”
                                    </p>
                                    <p className="mt-1 text-[11px] text-zinc-500">
                                      #
                                      {s.goal.slackChannel ||
                                        s.evidence[0].channel}
                                    </p>
                                  </div>
                                </div>
                              ) : null}
                              {s.projects.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleGoalExpand(i)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                  {projectsPicked} of {s.projects.length}{" "}
                                  project
                                  {s.projects.length === 1 ? "" : "s"} selected
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {isExpanded && s.projects.length > 0 ? (
                            <ul className="space-y-1.5 border-t border-zinc-800/80 bg-zinc-950/40 px-4 py-3 pl-11">
                              {s.projects.map((p, j) => (
                                <li
                                  key={`${i}-p-${j}`}
                                  className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900/60"
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600"
                                    checked={projectChecked[i]?.[j] ?? false}
                                    onChange={(e) =>
                                      setProjectCheckAt(
                                        i,
                                        j,
                                        e.target.checked
                                      )
                                    }
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                                      <span className="truncate text-sm text-zinc-200">
                                        {p.name}
                                      </span>
                                      <PriorityPill priority={p.priority} />
                                    </div>
                                    {p.description ? (
                                      <p className="mt-0.5 pl-[22px] text-xs text-zinc-500">
                                        {p.description}
                                      </p>
                                    ) : null}
                                    {p.assigneePersonId ? (
                                      <p className="mt-0.5 pl-[22px] text-[11px] text-zinc-500">
                                        Assignee{" "}
                                        <span className="text-zinc-400">
                                          {personNameById.get(p.assigneePersonId) ??
                                            p.assigneePersonId}
                                        </span>
                                      </p>
                                    ) : null}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {existingProjectSuggestions.length > 0 ? (
                <section>
                  <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Folder className="h-3.5 w-3.5" />
                    New projects on existing goals
                  </h3>
                  <ul className="space-y-2">
                    {existingProjectSuggestions.map((s, k) => {
                      const goalLabel =
                        company.goals.find((g) => g.id === s.existingGoalId)
                          ?.description ?? s.existingGoalId;
                      const isSelected = existingProjChecked[k] ?? false;
                      return (
                        <li
                          key={`ex-${k}`}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border p-4 transition-colors",
                            isSelected
                              ? "border-sky-900/60 bg-sky-950/10"
                              : "border-zinc-800 bg-zinc-950/40"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-600"
                            checked={isSelected}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setExistingProjChecked((prev) => {
                                const next = [...prev];
                                next[k] = v;
                                return next;
                              });
                            }}
                          />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                              <Target className="h-3 w-3" />
                              <span className="truncate">{goalLabel}</span>
                            </div>
                            <div className="flex flex-wrap items-start gap-2">
                              <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-100">
                                {s.project.name}
                              </p>
                              <PriorityPill priority={s.project.priority} />
                            </div>
                            {s.project.description ? (
                              <p className="text-xs text-zinc-500">
                                {s.project.description}
                              </p>
                            ) : null}
                            {s.project.assigneePersonId ? (
                              <p className="text-[11px] text-zinc-500">
                                Assignee{" "}
                                <span className="text-zinc-400">
                                  {personNameById.get(s.project.assigneePersonId) ??
                                    s.project.assigneePersonId}
                                </span>
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
              <button
                type="button"
                onClick={() => setStage("config")}
                className="text-sm text-zinc-400 hover:underline"
              >
                ← Back
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={importing || selectedCount === 0}
                  onClick={() => void onImport()}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white",
                    selectedCount === 0
                      ? "bg-zinc-700 opacity-50"
                      : "bg-blue-600 hover:bg-blue-500"
                  )}
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Adding…
                    </>
                  ) : (
                    `Add ${selectedCount} selected`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
