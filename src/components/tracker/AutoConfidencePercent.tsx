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

function barFillClass(pct: number): string {
  if (pct <= 0) return "bg-red-700";
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-sky-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-zinc-500";
}

/**
 * Confidence readout: percentage inside a compact bar; structured details in a hover panel.
 */
export function AutoConfidencePercent({
  score,
  explanation,
  className,
}: AutoConfidencePercentProps) {
  const panelId = useId();
  const pct = confidenceScoreToPercent(score);
  const fillClass = barFillClass(pct);

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
          "w-full min-w-0 rounded-md border-0 bg-transparent px-0.5 py-0.5 text-left font-inherit outline-none transition-colors",
          "hover:bg-zinc-800/50 focus-visible:ring-2 focus-visible:ring-sky-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
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
          className="relative h-4 w-full min-w-0 overflow-hidden rounded-full bg-zinc-800/90"
          aria-hidden
        >
          <div
            className={cn(
              "absolute left-0 top-0 h-full rounded-full transition-[width] duration-200",
              fillClass
            )}
            style={{ width: `${pct}%` }}
          />
          <span className="relative z-10 flex h-full w-full items-center justify-center text-[9px] font-semibold tabular-nums text-zinc-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] pointer-events-none">
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
