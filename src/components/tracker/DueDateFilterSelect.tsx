"use client";

import { useCallback, useId, useMemo, useState } from "react";
import type { CompanyWithGoals } from "@/lib/types/tracker";
import {
  type DueDateFilterId,
  DUE_DATE_FILTER_OPTIONS,
  countProjectsByDueDateBucket,
} from "@/lib/tracker-search-filter";
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  CircleDashed,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<DueDateFilterId, LucideIcon> = {
  overdue: AlertTriangle,
  next_7d: Clock,
  next_2w: CalendarClock,
  next_month: CalendarDays,
  next_3m: CalendarRange,
  later: Calendar,
  no_date: CircleDashed,
};

const ICON_COLOR: Record<DueDateFilterId, string> = {
  overdue: "text-red-400",
  next_7d: "text-amber-400",
  next_2w: "text-yellow-400/80",
  next_month: "text-zinc-400",
  next_3m: "text-zinc-400",
  later: "text-zinc-500",
  no_date: "text-zinc-600",
};

interface DueDateFilterSelectProps {
  /** Hierarchy after other filters but before the due-date filter. */
  hierarchy: CompanyWithGoals[];
  selectedIds: DueDateFilterId[];
  onChange: (ids: DueDateFilterId[]) => void;
}

export function DueDateFilterSelect({
  hierarchy,
  selectedIds,
  onChange,
}: DueDateFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const counts = useMemo(
    () => countProjectsByDueDateBucket(hierarchy),
    [hierarchy]
  );

  const toggle = useCallback(
    (id: DueDateFilterId) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    },
    [selectedIds, onChange]
  );

  const clear = useCallback(() => onChange([]), [onChange]);

  const singleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const singleSelectedLabel =
    singleSelectedId != null
      ? (DUE_DATE_FILTER_OPTIONS.find((o) => o.id === singleSelectedId)?.label ??
        singleSelectedId)
      : null;
  const SingleIcon =
    singleSelectedId != null ? ICON_MAP[singleSelectedId] : null;

  const buttonSummary =
    selectedIds.length === 0 ? (
      <>
        <CalendarDays
          className="h-3.5 w-3.5 text-zinc-500 shrink-0"
          aria-hidden
        />
        <span className="truncate">All dates</span>
      </>
    ) : SingleIcon != null && singleSelectedId != null ? (
      <>
        <SingleIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            ICON_COLOR[singleSelectedId]
          )}
          aria-hidden
        />
        <span className="truncate min-w-0">{singleSelectedLabel}</span>
      </>
    ) : (
      <>
        <CalendarDays
          className="h-3.5 w-3.5 text-zinc-400 shrink-0"
          aria-hidden
        />
        <span className="truncate">{selectedIds.length} date filters</span>
      </>
    );

  return (
    <div className="relative min-w-[10rem] w-full max-w-full overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        Filter projects by due date proximity
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${listId}-label`}
        aria-controls={`${listId}-panel`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 py-1.5 pl-2 pr-2 text-left text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {buttonSummary}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            id={`${listId}-panel`}
            role="group"
            aria-label="Due date filters"
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Project target date
            </p>
            <div className="px-1 pb-1">
              {DUE_DATE_FILTER_OPTIONS.map(({ id, label }) => {
                const selected = selectedSet.has(id);
                const Icon = ICON_MAP[id];
                const count = counts[id];
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                      selected
                        ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                        : "text-zinc-200 hover:bg-zinc-800/60"
                    )}
                  >
                    <Icon
                      className={cn("h-3.5 w-3.5 shrink-0", ICON_COLOR[id])}
                      aria-hidden
                    />
                    <span className="flex-1">{label}</span>
                    <span
                      className={cn(
                        "ml-2 min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-medium leading-none",
                        count > 0
                          ? "bg-zinc-800 text-zinc-300"
                          : "bg-zinc-800/50 text-zinc-600"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedIds.length > 0 ? (
              <div className="border-t border-zinc-800 px-2 py-1.5 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    setOpen(false);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Clear selection
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
