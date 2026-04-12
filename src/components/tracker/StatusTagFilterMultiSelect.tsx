"use client";

import { useCallback, useId, useMemo, useState } from "react";
import type { TrackerStatusTagId } from "@/lib/tracker-search-filter";
import {
  AlertCircle,
  ChevronDown,
  Eye,
  Flag,
  Ghost,
  Hourglass,
  Sparkles,
  Tags,
  TrendingDown,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS: {
  id: TrackerStatusTagId;
  label: string;
  hint: string;
  Icon: LucideIcon;
}[] = [
  {
    id: "at_risk",
    label: "At risk",
    hint: "Needs attention — goal or project marked at risk",
    Icon: Flag,
  },
  {
    id: "spotlight",
    label: "Spotlight",
    hint: "Positive signal — win, momentum, or exec highlight",
    Icon: Sparkles,
  },
  {
    id: "unassigned",
    label: "Unassigned",
    hint: "No DRI on the goal or owner on the project",
    Icon: UserRound,
  },
  {
    id: "need_review",
    label: "Need review",
    hint: "Stale last-reviewed — window depends on owner autonomy",
    Icon: AlertCircle,
  },
  {
    id: "close_watch",
    label: "Close watch",
    hint: "P0/P1 project owned by someone with autonomy 1–2",
    Icon: Eye,
  },
  {
    id: "zombie",
    label: "Zombie",
    hint: "In progress, no milestone done, review stale 21+ days",
    Icon: Ghost,
  },
  {
    id: "high_leverage",
    label: "High leverage",
    hint: "P0 or P1 goal with low-complexity project (1–2)",
    Icon: TrendingUp,
  },
  {
    id: "low_leverage",
    label: "Low leverage",
    hint: "P3 goal with high-complexity project (4–5)",
    Icon: TrendingDown,
  },
  {
    id: "time_sensitive",
    label: "Time-sensitive",
    hint: "High cost of delay but goal not In Progress",
    Icon: Hourglass,
  },
];

interface StatusTagFilterMultiSelectProps {
  selectedIds: TrackerStatusTagId[];
  onChange: (ids: TrackerStatusTagId[]) => void;
}

export function StatusTagFilterMultiSelect({
  selectedIds,
  onChange,
}: StatusTagFilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = useCallback(
    (id: TrackerStatusTagId) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    },
    [selectedIds, onChange]
  );

  const clear = useCallback(() => onChange([]), [onChange]);

  const labelById = useMemo(
    () => new Map(OPTIONS.map((o) => [o.id, o.label])),
    []
  );

  const buttonSummary =
    selectedIds.length === 0 ? (
      <>
        <Tags className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden />
        <span className="truncate">All signals</span>
      </>
    ) : selectedIds.length === 1 ? (
      <>
        {(() => {
          const opt = OPTIONS.find((o) => o.id === selectedIds[0]);
          const Icon = opt?.Icon ?? Tags;
          return <Icon className="h-3.5 w-3.5 text-zinc-400 shrink-0" aria-hidden />;
        })()}
        <span className="truncate min-w-0">
          {labelById.get(selectedIds[0]) ?? selectedIds[0]}
        </span>
      </>
    ) : (
      <>
        <Tags className="h-3.5 w-3.5 text-zinc-400 shrink-0" aria-hidden />
        <span className="truncate">{selectedIds.length} signals</span>
      </>
    );

  return (
    <div className="relative min-w-[10rem] w-full max-w-full overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        Filter goals and projects by signals: at risk, spotlight, leverage, zombie,
        time-sensitive, and more
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
            aria-label="Status filters"
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Show rows matching any of
            </p>
            <div className="px-1 pb-1">
              {OPTIONS.map(({ id, label, hint, Icon }) => {
                const selected = selectedSet.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    title={hint}
                    onClick={() => toggle(id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                      selected
                        ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                        : "text-zinc-200 hover:bg-zinc-800/60"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                    <span>{label}</span>
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
