"use client";

import {
  Check,
  Database,
  Loader2,
  MessageSquareWarning,
  MessagesSquare,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  ScanPanelPhase,
  UnrepliedScanPanelState,
} from "@/lib/unrepliedAsksScanTypes";
import { cn } from "@/lib/utils";

export type { ScanPanelPhase, UnrepliedScanPanelState };

function StepRow({
  label,
  active,
  done,
  children,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  done: boolean;
  children?: React.ReactNode;
  icon: typeof Search;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-all duration-300",
        done
          ? "border-emerald-500/25 bg-emerald-950/20"
          : active
            ? "border-violet-500/40 bg-violet-950/25 shadow-[0_0_20px_-8px_rgba(139,92,246,0.45)]"
            : "border-zinc-800/80 bg-zinc-950/40 opacity-60"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors duration-300",
            done
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
              : active
                ? "border-violet-500/45 bg-violet-500/15 text-violet-200"
                : "border-zinc-700 text-zinc-500"
          )}
        >
          {done ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden />
          )}
        </span>
        <span
          className={cn(
            "text-xs font-medium transition-colors duration-300",
            active || done ? "text-zinc-100" : "text-zinc-500"
          )}
        >
          {label}
        </span>
      </div>
      {children ? (
        <div className="mt-2.5 space-y-2 border-t border-zinc-800/60 pt-2.5 pl-9">{children}</div>
      ) : null}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] tabular-nums text-zinc-500">
        <span>
          {done} / {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-600 to-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function UnrepliedScanProgressPanel({
  state,
}: {
  state: UnrepliedScanPanelState;
}) {
  if (!state.open) return null;

  const phase = state.phase;
  const searchDone =
    phase !== "init" &&
    phase !== "founders" &&
    phase !== "search" &&
    phase !== "idle";
  const classifyDone =
    phase === "threads" ||
    phase === "persist" ||
    phase === "complete" ||
    phase === "error";
  const threadsDone =
    phase === "persist" || phase === "complete" || phase === "error";
  const persistDone = phase === "complete" || phase === "error";

  const searchActive = phase === "search" || phase === "founders" || phase === "init";
  const classifyActive = phase === "classify";
  const threadsActive = phase === "threads";
  const persistActive = phase === "persist";

  return (
    <>
      <div
        className="fixed inset-0 z-[240] animate-[unrepliedBackdropIn_0.25s_ease-out_both] bg-black/55 backdrop-blur-[2px] motion-reduce:animate-none"
        aria-hidden
      />
      <div
        className="fixed inset-x-4 bottom-4 z-[250] mx-auto max-w-lg animate-[unrepliedPanelIn_0.35s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2"
        role="dialog"
        aria-labelledby="unreplied-scan-title"
        aria-busy={phase !== "complete" && phase !== "error"}
      >
        <div className="overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900/98 shadow-2xl shadow-black/60 ring-1 ring-white/[0.06]">
          <div className="border-b border-zinc-800/90 bg-zinc-950/80 px-4 py-3">
            <h2
              id="unreplied-scan-title"
              className="flex items-center gap-2 text-sm font-semibold text-zinc-100"
            >
              <MessageSquareWarning
                className="h-4 w-4 shrink-0 text-amber-400/90"
                aria-hidden
              />
              Scanning Slack
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {state.lookbackDays != null
                ? `Looking back ${state.lookbackDays} days · founders’ channels & group DMs`
                : "Pulling founder messages and checking threads…"}
            </p>
          </div>

          <div
            className="max-h-[min(70vh,28rem)] space-y-2 overflow-y-auto px-3 py-3"
            aria-live="polite"
            aria-atomic="false"
          >
            {phase === "error" && state.error ? (
              <p className="rounded-lg border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-200/95">
                {state.error}
              </p>
            ) : null}

            {phase === "complete" && state.complete ? (
              <p
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs animate-[unrepliedFade_0.4s_ease-out_both]",
                  state.complete.threadErrors > 0
                    ? "border-amber-500/30 bg-amber-950/25 text-amber-100/95"
                    : "border-emerald-500/25 bg-emerald-950/25 text-emerald-100/95"
                )}
              >
                Done. Classified{" "}
                <span className="tabular-nums font-semibold">
                  {state.complete.newClassified}
                </span>{" "}
                new messages, refreshed{" "}
                <span className="tabular-nums font-semibold">
                  {state.complete.threadRefreshes}
                </span>{" "}
                threads
                {state.complete.threadErrors > 0 ? (
                  <>
                    {" "}
                    (
                    <span className="tabular-nums font-semibold">
                      {state.complete.threadErrors}
                    </span>{" "}
                    error{state.complete.threadErrors === 1 ? "" : "s"})
                  </>
                ) : null}
                .
              </p>
            ) : null}

            <StepRow
              label="Search Slack (per founder)"
              icon={Search}
              active={searchActive}
              done={searchDone}
            >
              {state.search && phase !== "complete" && phase !== "error" ? (
                <p className="text-[11px] leading-snug text-zinc-400">
                  <span className="text-zinc-300">{state.search.founderName}</span>
                  <span className="text-zinc-600">
                    {" "}
                    ({state.search.founderIndex}/{state.search.founderTotal})
                  </span>
                  {state.search.candidatesTotal > 0 ? (
                    <>
                      <br />
                      <span className="text-zinc-500">
                        {state.search.candidatesTotal} new message
                        {state.search.candidatesTotal === 1 ? "" : "s"} queued for
                        AI
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
              {state.founderNames.length > 0 && phase !== "error" ? (
                <p className="text-[10px] text-zinc-600">
                  Founders: {state.founderNames.join(", ")}
                </p>
              ) : null}
            </StepRow>

            <StepRow
              label="Classify with AI (asks vs noise)"
              icon={Sparkles}
              active={classifyActive}
              done={classifyDone}
            >
              {state.classify && state.classify.total > 0 ? (
                <ProgressBar done={state.classify.done} total={state.classify.total} />
              ) : state.classify && state.classify.total === 0 && searchDone ? (
                <p className="text-[11px] text-zinc-500">Nothing new to classify.</p>
              ) : null}
            </StepRow>

            <StepRow
              label="Load thread replies"
              icon={MessagesSquare}
              active={threadsActive}
              done={threadsDone}
            >
              {state.threads && state.threads.total > 0 ? (
                <ProgressBar done={state.threads.done} total={state.threads.total} />
              ) : state.threads && state.threads.total === 0 && classifyDone ? (
                <p className="text-[11px] text-zinc-500">No open asks to refresh.</p>
              ) : null}
            </StepRow>

            <StepRow
              label="Save to database"
              icon={Database}
              active={persistActive}
              done={persistDone}
            >
              {persistActive ? (
                <div className="space-y-2">
                  <p className="text-[11px] leading-snug text-zinc-400">
                    Merging new classifications, refreshing open threads, and updating
                    the snapshot in Redis…
                  </p>
                  <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full w-full rounded-full bg-gradient-to-r from-violet-600/90 via-emerald-500/80 to-violet-600/90 bg-[length:200%_100%] animate-[unrepliedShimmer_1.25s_ease-in-out_infinite] motion-reduce:animate-none" />
                  </div>
                </div>
              ) : null}
            </StepRow>
          </div>
        </div>
      </div>
    </>
  );
}
