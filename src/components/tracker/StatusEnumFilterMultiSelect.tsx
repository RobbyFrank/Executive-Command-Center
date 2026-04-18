"use client";

import { useCallback, useId, useMemo, useState } from "react";
import {
  DELIVERY_STATUS_FILTER_OPTIONS,
  PROJECT_STATUS_ORDER,
} from "@/lib/projectStatus";
import { ProjectStatusPill } from "./ProjectStatusPill";
import { ChevronDown, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FilterSelectSelectionBadge,
  filterSelectTriggerButtonClass,
} from "./filter-select-trigger";

interface StatusEnumFilterMultiSelectProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function StatusEnumFilterMultiSelect({
  selectedIds,
  onChange,
}: StatusEnumFilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    },
    [selectedIds, onChange]
  );

  const clear = useCallback(() => onChange([]), [onChange]);

  const labelByStatus = useMemo(
    () =>
      new Map<string, string>(
        DELIVERY_STATUS_FILTER_OPTIONS.map((s) => [s, s])
      ),
    []
  );

  const buttonSummary =
    selectedIds.length === 0 ? (
      <>
        <CircleDot className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden />
        <span className="truncate">All delivery statuses</span>
      </>
    ) : selectedIds.length === 1 ? (
      <>
        <CircleDot className="h-3.5 w-3.5 text-zinc-400 shrink-0" aria-hidden />
        <span className="truncate min-w-0">
          {labelByStatus.get(selectedIds[0]) ?? selectedIds[0]}
        </span>
      </>
    ) : (
      <>
        <CircleDot className="h-3.5 w-3.5 text-zinc-400 shrink-0" aria-hidden />
        <span className="truncate">{selectedIds.length} statuses</span>
      </>
    );

  const optionButtonClass = (selected: boolean) =>
    cn(
      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
      selected
        ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
        : "text-zinc-200 hover:bg-zinc-800/60"
    );

  return (
    <div className="relative min-w-[10rem] w-full max-w-full overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        Filter by project delivery status
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${listId}-label`}
        aria-controls={`${listId}-panel`}
        onClick={() => setOpen((o) => !o)}
        className={filterSelectTriggerButtonClass(
          open,
          selectedIds.length > 0
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {buttonSummary}
          <FilterSelectSelectionBadge count={selectedIds.length} />
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none",
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
            aria-label="Delivery status filters"
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[min(100vw-2rem,22rem)] max-h-[min(70vh,24rem)] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Show rows matching any of
            </p>
            <div className="px-1 pb-1">
              <p
                className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                title="Same order and styling as the Status column on projects"
              >
                Project status
              </p>
              <div className="space-y-0.5">
                {PROJECT_STATUS_ORDER.map((s) => {
                  const selected = selectedSet.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(s)}
                      className={optionButtonClass(selected)}
                    >
                      <span className="min-w-0 flex-1 [&_.inline-flex]:max-w-none">
                        <ProjectStatusPill status={s} />
                      </span>
                    </button>
                  );
                })}
              </div>
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
