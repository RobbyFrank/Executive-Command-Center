"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { TrackerWarning } from "@/lib/tracker-project-warnings";

const WARNINGS_HOVER_CLOSE_MS = 120;

export function WarningsBadge({
  warnings,
}: {
  warnings: TrackerWarning[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, WARNINGS_HOVER_CLOSE_MS);
  }, [cancelScheduledClose]);

  const handlePointerEnter = useCallback(() => {
    cancelScheduledClose();
    setOpen(true);
  }, [cancelScheduledClose]);

  const reposition = useCallback(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const panelW = 200;
    const vw = window.innerWidth;
    const margin = 8;
    let left = rect.right - panelW;
    left = Math.max(margin, Math.min(left, vw - panelW - margin));
    setPos({ top: rect.bottom + 4, left });
  }, [open]);

  useLayoutEffect(() => reposition(), [reposition]);

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  const overlay =
    mounted && open ? (
      <>
        {pos && (
          <div
            className="fixed z-[110] min-w-[180px] rounded-md border border-zinc-700 bg-zinc-900 p-1.5 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={handlePointerEnter}
            onMouseLeave={scheduleClose}
          >
            {warnings.map((w, i) => (
              <p
                key={`${i}-${w.label}`}
                className="flex items-center gap-2 whitespace-nowrap px-2 py-1 text-[11px] text-zinc-300"
                title={w.title}
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400/80" />
                {w.label}
              </p>
            ))}
          </div>
        )}
      </>
    ) : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-expanded={open}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={handlePointerEnter}
        onMouseLeave={scheduleClose}
        onFocus={handlePointerEnter}
        onBlur={scheduleClose}
        className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95 cursor-help"
      >
        {warnings.length} warnings
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
