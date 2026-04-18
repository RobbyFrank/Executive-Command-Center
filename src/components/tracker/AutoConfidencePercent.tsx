"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type ConfidenceExplanation,
  confidenceScoreToPercent,
} from "@/lib/confidenceScore";
import { cn } from "@/lib/utils";
import { useCompanySectionOverlayOptional } from "./company-section-overlay-context";

const CLOSE_DELAY_MS = 200;

interface AutoConfidencePercentProps {
  score: number;
  explanation: ConfidenceExplanation;
  className?: string;
}

/** Total segments in the Confidence meter (one per 20%: 0, 20, 40, 60, 80, 100). */
const CONFIDENCE_SEGMENTS = 5;

/**
 * Lit-segment fill. A calm, single tone is used across all partial states — the *count*
 * of lit segments is the signal, color is not. Full (100%) gets a quiet emerald reward so
 * "done" still reads as a small positive cue without the rainbow.
 */
function litSegmentFillClass(pct: number): string {
  return pct >= 100 ? "bg-emerald-500/90" : "bg-zinc-300";
}

/**
 * Confidence readout for the Roadmap: a 5-segment meter with the percentage alongside.
 * Intentionally low-key — a single calm tone across partial states (count of lit segments
 * is the signal), with a quiet emerald reward only at 100%. Structured details live in the
 * hover panel. Visually distinct from the adjacent `ProgressBar` (continuous pill fill) so
 * the two roadmap columns don't collide.
 */
export function AutoConfidencePercent({
  score,
  explanation,
  className,
}: AutoConfidencePercentProps) {
  const panelId = useId();
  const pct = confidenceScoreToPercent(score);
  /** Score is a 0–5 band (see `confidenceScoreToPercent`); segments light up 1 per 20%. */
  const litSegments = Math.round(pct / 20);
  const litFillClass = litSegmentFillClass(pct);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(
    null
  );

  const { incrementOverlay, decrementOverlay } =
    useCompanySectionOverlayOptional() ?? {};

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const refreshPlacement = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 6;
    const maxW = 320;
    let left = r.left;
    const top = r.bottom + margin;
    if (left + maxW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - maxW);
    }
    setPlacement({ top, left });
  }, []);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    refreshPlacement();
    setPanelOpen(true);
  }, [clearCloseTimer, refreshPlacement]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setPanelOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const cancelClose = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!panelOpen) return;
    refreshPlacement();
  }, [panelOpen, refreshPlacement, explanation]);

  useEffect(() => {
    if (!panelOpen) return;
    const onScroll = () => {
      setPanelOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onResize = () => refreshPlacement();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panelOpen, refreshPlacement]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen || !incrementOverlay || !decrementOverlay) return;
    incrementOverlay();
    return () => decrementOverlay();
  }, [panelOpen, incrementOverlay, decrementOverlay]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "w-full min-w-0 rounded-md border-0 bg-transparent px-0.5 py-0.5 text-left font-inherit outline-none transition-colors hover:bg-zinc-800/50 focus-visible:ring-2 focus-visible:ring-sky-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          className
        )}
        aria-label={explanation.ariaLabel}
        aria-expanded={panelOpen}
        aria-describedby={panelOpen ? panelId : undefined}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        onFocus={openPanel}
        onBlur={scheduleClose}
      >
        <div
          className="flex h-4 w-full min-w-0 items-center justify-start gap-1.5"
          aria-hidden
        >
          <div className="flex items-center gap-0.5">
            {Array.from({ length: CONFIDENCE_SEGMENTS }, (_, i) => {
              const isLit = i < litSegments;
              return (
                <span
                  key={i}
                  className={cn(
                    "h-3 w-1.5 rounded-[2px] transition-colors",
                    isLit
                      ? litFillClass
                      : "bg-zinc-800 ring-1 ring-inset ring-zinc-700/60"
                  )}
                />
              );
            })}
          </div>
          <span className="shrink-0 text-[10px] font-semibold tabular-nums leading-none text-zinc-400">
            {pct}%
          </span>
        </div>
      </button>
      {panelOpen &&
        placement &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={panelId}
            role="tooltip"
            className="fixed z-[200] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-zinc-600/90 bg-zinc-900 px-3 py-2.5 shadow-xl pointer-events-auto"
            style={{ top: placement.top, left: placement.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <p className="text-xs font-semibold tracking-tight text-zinc-100">
              {explanation.headline}
            </p>
            {explanation.paragraphs.length > 0 ? (
              <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
                {explanation.paragraphs.map((p, i) => (
                  <p
                    key={i}
                    className="text-[11px] leading-relaxed text-zinc-300"
                  >
                    {p}
                  </p>
                ))}
              </div>
            ) : null}
            {explanation.bullets && explanation.bullets.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 border-t border-zinc-800 pt-2 pl-4 text-[11px] leading-snug text-zinc-300 marker:text-zinc-600">
                {explanation.bullets.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>,
          document.body
        )}
    </>
  );
}
