"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Company, Goal } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";

const HOVER_CLOSE_MS = 120;

function formatGoalLine(
  goal: Goal | undefined,
  companyById: Map<string, Company>
): string {
  if (!goal) return "(Unknown goal)";
  const c = companyById.get(goal.companyId);
  const prefix = c?.shortName ?? "?";
  return `${prefix}: ${goal.description}`;
}

export function SharedBadge({
  isMirror,
  primaryGoalId,
  mirroredGoalIds,
  currentGoalId,
  goals,
  companies,
}: {
  isMirror: boolean;
  primaryGoalId: string;
  mirroredGoalIds: string[];
  currentGoalId: string;
  goals: Goal[];
  companies: Company[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies]
  );
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  const showBadge =
    isMirror || (mirroredGoalIds?.length ?? 0) > 0;

  const primaryGoal = goalById.get(primaryGoalId);
  const allAppearanceIds = useMemo(() => {
    const s = new Set<string>([primaryGoalId, ...(mirroredGoalIds ?? [])]);
    return [...s];
  }, [primaryGoalId, mirroredGoalIds]);
  /** Every goal where this project appears except primary and the goal row we're on. */
  const alsoGoalIds = useMemo(
    () =>
      allAppearanceIds.filter(
        (id) => id !== primaryGoalId && id !== currentGoalId
      ),
    [allAppearanceIds, primaryGoalId, currentGoalId]
  );

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

  if (!showBadge) return null;

  const label = isMirror ? "Mirror" : "Shared";

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
              Primary goal
            </p>
            <p className="text-[11px] leading-snug text-zinc-200">
              {formatGoalLine(primaryGoal, companyById)}
            </p>
            {alsoGoalIds.length > 0 && (
              <>
                <p className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Also appears under
                </p>
                <ul className="space-y-1">
                  {alsoGoalIds.map((gid) => (
                    <li
                      key={gid}
                      className="text-[11px] leading-snug text-zinc-300"
                    >
                      {formatGoalLine(goalById.get(gid), companyById)}
                    </li>
                  ))}
                </ul>
              </>
            )}
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
        className={cn(
          "whitespace-nowrap rounded-md border border-purple-400/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300/90 cursor-help"
        )}
      >
        {label}
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
