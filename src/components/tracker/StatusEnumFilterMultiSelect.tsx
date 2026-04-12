"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { GoalStatusEnum, ProjectStatusEnum } from "@/lib/schemas/tracker";
import { ChevronDown, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUSES = Array.from(
  new Set([...GoalStatusEnum.options, ...ProjectStatusEnum.options])
).sort((a, b) => a.localeCompare(b));

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
    () => new Map<string, string>(STATUSES.map((s) => [s, s])),
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

  return (
    <div className="relative min-w-[10rem] w-full max-w-full overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        Filter by goal or project delivery status
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
            aria-label="Delivery status filters"
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[min(100vw-2rem,22rem)] max-h-[min(70vh,24rem)] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Show rows matching any of
            </p>
            <div className="px-1 pb-1">
              {STATUSES.map((s) => {
                const selected = selectedSet.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(s)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                      selected
                        ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                        : "text-zinc-200 hover:bg-zinc-800/60"
                    )}
                  >
                    <span className="min-w-0 break-words">{s}</span>
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
