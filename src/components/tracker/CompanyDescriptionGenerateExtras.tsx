"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { CellHoverTooltipEditExtrasContext } from "./CellHoverTooltip";
import { Check, Circle, Globe, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { consumeNdjsonStream } from "@/lib/ndjsonConsumeStream";
import { cn } from "@/lib/utils";

type UrlScrapeStatus = "queued" | "running" | "done" | "failed";

type StreamPayload =
  | {
      type: "progress";
      phase: "scraping" | "summarizing";
      entries: { url: string; status: UrlScrapeStatus }[];
      completed: number;
      total: number;
      message?: string;
    }
  | { type: "done"; description: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

function EntryStatusIcon({ status }: { status: UrlScrapeStatus }) {
  switch (status) {
    case "queued":
      return (
        <Circle
          className="h-3.5 w-3.5 shrink-0 text-zinc-600"
          aria-hidden
        />
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
        <Check
          className="h-3.5 w-3.5 shrink-0 text-emerald-500"
          aria-hidden
        />
      );
    case "failed":
      return (
        <XCircle
          className="h-3.5 w-3.5 shrink-0 text-amber-600"
          aria-hidden
        />
      );
    default:
      return null;
  }
}

type CompanyDescriptionGenerateExtrasProps = {
  ctx: CellHoverTooltipEditExtrasContext;
  defaultWebsiteUrl: string;
};

export function CompanyDescriptionGenerateExtras({
  ctx,
  defaultWebsiteUrl,
}: CompanyDescriptionGenerateExtrasProps) {
  const { suspendBlurCommit, setDraft } = ctx;
  const [modalOpen, setModalOpen] = useState(false);
  const [startUrl, setStartUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<
    { url: string; status: UrlScrapeStatus }[]
  >([]);
  const [phaseMessage, setPhaseMessage] = useState("");
  const [barFraction, setBarFraction] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!modalOpen) return;
    return suspendBlurCommit();
  }, [modalOpen, suspendBlurCommit]);

  useEffect(() => {
    if (modalOpen) {
      setStartUrl(defaultWebsiteUrl.trim() ? defaultWebsiteUrl : "");
    }
  }, [modalOpen, defaultWebsiteUrl]);

  const resetProgress = useCallback(() => {
    setEntries([]);
    setPhaseMessage("");
    setBarFraction(0);
  }, []);

  const closeModal = useCallback(() => {
    if (running) return;
    setModalOpen(false);
    resetProgress();
  }, [running, resetProgress]);

  const abortRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runGenerate = async () => {
    const url = startUrl.trim();
    if (!url) {
      toast.error("Enter a website URL.");
      return;
    }

    let cancelToastShown = false;
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setRunning(true);
    resetProgress();
    setPhaseMessage("Starting…");
    setBarFraction(0.02);

    try {
      const res = await fetch("/api/companies/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal,
      });

      if (!res.ok) {
        toast.error("Could not start generation.");
        return;
      }

      let terminal = false;
      await consumeNdjsonStream<StreamPayload>(
        res,
        (p) => {
          if (p.type === "progress") {
            setEntries(p.entries);
            if (p.message) setPhaseMessage(p.message);
            else if (p.phase === "scraping")
              setPhaseMessage("Scraping pages in parallel…");
            else setPhaseMessage("");

            if (p.total > 0) {
              setBarFraction(
                p.phase === "summarizing"
                  ? 0.92
                  : Math.min(0.9, 0.05 + (p.completed / p.total) * 0.85)
              );
            }
          } else if (p.type === "error") {
            terminal = true;
            toast.error(p.message || "Generation failed.");
          } else if (p.type === "cancelled") {
            terminal = true;
            if (!cancelToastShown) {
              cancelToastShown = true;
              toast.message("Cancelled.");
            }
          } else if (p.type === "done") {
            terminal = true;
            setDraft(p.description);
            setBarFraction(1);
            toast.success("Description updated — review and save.");
            setModalOpen(false);
            resetProgress();
          }
        },
        signal
      );

      if (!terminal && !signal.aborted) {
        toast.error("Generation ended without a result.");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        if (!cancelToastShown) {
          cancelToastShown = true;
          toast.message("Cancelled.");
        }
      } else {
        toast.error(e instanceof Error ? e.message : "Generation failed.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      setPhaseMessage("");
      setBarFraction(0);
    }
  };

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setModalOpen(true)}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-600/80 bg-zinc-800/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 cursor-pointer",
          "transition-colors hover:bg-zinc-800 hover:text-zinc-50",
          "focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
        )}
      >
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Generate from website…
      </button>

      {modalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-desc-gen-title"
          >
            <button
              type="button"
              className={cn(
                "absolute inset-0 bg-black/70",
                running ? "cursor-not-allowed" : "cursor-default"
              )}
              aria-label="Close dialog backdrop"
              disabled={running}
              onClick={closeModal}
            />
            <div
              className="relative z-[401] w-full max-w-lg rounded-lg border border-zinc-600 bg-zinc-900 p-4 shadow-2xl max-h-[min(90vh,40rem)] flex flex-col"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2
                id="company-desc-gen-title"
                className="text-sm font-semibold text-zinc-100"
              >
                Generate description from website
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Enter the company site. Up to ten pages are scraped in
                parallel (homepage plus linked same-origin pages), then Claude
                writes the description. This can take ~30–60s — use Stop to
                cancel.
              </p>

              <label className="mt-3 block text-xs font-medium text-zinc-400">
                Starting URL
                <input
                  type="url"
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  disabled={running}
                  placeholder="https://example.com"
                  className={cn(
                    "mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2.5 py-2",
                    "text-sm text-zinc-100 placeholder:text-zinc-600",
                    "focus:outline-none focus:ring-2 focus:ring-emerald-600/70",
                    running && "opacity-60"
                  )}
                />
              </label>

              {running && entries.length > 0 ? (
                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
                  <div className="h-2 w-full shrink-0 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                      style={{ width: `${Math.round(barFraction * 100)}%` }}
                    />
                  </div>
                  {phaseMessage ? (
                    <p className="text-xs text-zinc-400">{phaseMessage}</p>
                  ) : null}
                  <ul
                    className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-950/50 py-1 text-xs"
                    aria-live="polite"
                  >
                    {entries.map((e) => (
                      <li
                        key={e.url}
                        className="flex items-start gap-2 px-2 py-1.5 text-zinc-300"
                      >
                        <span className="mt-0.5">
                          <EntryStatusIcon status={e.status} />
                        </span>
                        <span
                          className="min-w-0 flex-1 break-all leading-snug"
                          title={e.url}
                        >
                          {e.url}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : running ? (
                <div className="mt-3 space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-[width] duration-200"
                      style={{ width: `${Math.round(barFraction * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400">{phaseMessage}</p>
                </div>
              ) : null}

              <div className="mt-4 flex justify-end gap-2 shrink-0">
                {running ? (
                  <button
                    type="button"
                    onClick={abortRun}
                    className="rounded-md border border-red-900/80 bg-red-950/50 px-3 py-1.5 text-xs font-medium text-red-200 cursor-pointer hover:bg-red-950"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  disabled={running}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runGenerate()}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white cursor-pointer",
                    "hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {running ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Working…
                    </>
                  ) : (
                    "Generate"
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
