"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const HOVER_CLOSE_MS = 120;

/** Hover/focus panel showing which project blocks this row (used for dependency-blocked status). */
export function BlockedByProjectHover({
  blockedByProjectName,
  children,
  className,
}: {
  blockedByProjectName: string;
  children: ReactNode;
  className?: string;
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
    }, HOVER_CLOSE_MS);
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
    const panelW = 260;
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
            className="fixed z-[110] max-w-[min(280px,calc(100vw-1rem)))] rounded-md border border-zinc-700 bg-zinc-900 p-2.5 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={handlePointerEnter}
            onMouseLeave={scheduleClose}
          >
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Blocked by
            </p>
            <p className="text-[11px] leading-snug text-zinc-200">
              {blockedByProjectName}
            </p>
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
        aria-label={`Blocked by ${blockedByProjectName}`}
        title={`Blocked by ${blockedByProjectName}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={handlePointerEnter}
        onMouseLeave={scheduleClose}
        onFocus={handlePointerEnter}
        onBlur={scheduleClose}
        className={cn(
          "inline-flex min-w-0 max-w-full cursor-help border-0 bg-transparent p-0 text-left",
          className
        )}
      >
        {children}
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
