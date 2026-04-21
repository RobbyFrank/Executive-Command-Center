"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  type LucideIcon,
  BarChart2,
  Check,
  ChevronDown,
  FolderTree,
  Gauge,
} from "lucide-react";
import type { TeamRosterSortMode } from "@/lib/autonomyRoster";
import { filterSelectTriggerButtonClass } from "./filter-select-trigger";
import { cn } from "@/lib/utils";

type OptionDef = {
  value: TeamRosterSortMode;
  label: string;
  title: string;
  Icon: LucideIcon;
};

const OPTIONS: OptionDef[] = [
  {
    value: "autonomy",
    label: "By autonomy",
    title:
      "Founders first, then groups by ownership level (5 = full ownership down to 0)",
    Icon: Gauge,
  },
  {
    value: "department",
    label: "By department",
    title:
      "Founders first, then one section per department (including “No Department”)",
    Icon: FolderTree,
  },
  {
    value: "workload",
    label: "By workload",
    title:
      "Groups by active project load (idle → light → moderate → heavy); founders are included in these tiers",
    Icon: BarChart2,
  },
];

function optionForMode(mode: TeamRosterSortMode): OptionDef {
  return OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0]!;
}

interface TeamRosterGroupingSelectProps {
  value: TeamRosterSortMode;
  onChange: (value: TeamRosterSortMode) => void;
  /** When true, grouping cannot be changed (e.g. during bulk Slack sync). */
  disabled?: boolean;
}

/**
 * Roster grouping control for the Team page — same interaction pattern as
 * {@link CompaniesGroupingSelect} and {@link RoadmapExpandModeSelect}.
 */
export function TeamRosterGroupingSelect({
  value,
  onChange,
  disabled = false,
}: TeamRosterGroupingSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = useMemo(() => optionForMode(value), [value]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = useCallback(
    (mode: TeamRosterSortMode) => {
      onChange(mode);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div className="relative inline-block max-w-full shrink-0">
      <span id={`${listId}-label`} className="sr-only">
        How to group the team roster
      </span>
      <button
        type="button"
        id="team-roster-grouping-mode"
        aria-labelledby={`${listId}-label`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${listId}-listbox`}
        title={
          disabled
            ? "Grouping is locked while Slack sync runs"
            : current.title
        }
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        className={cn(
          filterSelectTriggerButtonClass(open, false),
          "inline-flex max-w-full min-h-[2.25rem] w-max items-center py-1.5 pl-2.5 pr-2 font-medium transition-colors",
          !disabled && "hover:border-zinc-600 hover:bg-zinc-800",
          "text-zinc-100",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <current.Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="whitespace-nowrap text-left">{current.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            id={`${listId}-listbox`}
            role="listbox"
            aria-labelledby={`${listId}-label`}
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[min(100vw-2rem,20rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            {OPTIONS.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={opt.title}
                  onClick={() => pick(opt.value)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                    selected
                      ? "bg-zinc-800/90 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
                  )}
                >
                  <opt.Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      selected ? "text-zinc-200" : "text-zinc-500"
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">{opt.label}</span>
                  {selected ? (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-emerald-500/90"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
