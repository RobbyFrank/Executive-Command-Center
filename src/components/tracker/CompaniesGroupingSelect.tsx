"use client";

import { useCallback, useId, useMemo, useState } from "react";
import {
  type LucideIcon,
  Activity,
  BarChart3,
  Check,
  ChevronDown,
} from "lucide-react";
import { filterSelectTriggerButtonClass } from "./filter-select-trigger";
import { cn } from "@/lib/utils";

export type CompaniesGroupingMode = "mrr_tier" | "momentum";

type OptionDef = {
  value: CompaniesGroupingMode;
  label: string;
  title: string;
  Icon: LucideIcon;
};

const OPTIONS: OptionDef[] = [
  {
    value: "mrr_tier",
    label: "By MRR tier",
    title:
      "Group companies into revenue bands (pinned first, then tier buckets)",
    Icon: BarChart3,
  },
  {
    value: "momentum",
    label: "By momentum",
    title:
      "Single list sorted by portfolio momentum score (active work, spotlight, milestones; at-risk reduces score)",
    Icon: Activity,
  },
];

function optionForMode(mode: CompaniesGroupingMode): OptionDef {
  return OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0]!;
}

interface CompaniesGroupingSelectProps {
  value: CompaniesGroupingMode;
  onChange: (value: CompaniesGroupingMode) => void;
}

/**
 * Grouping control for the Companies directory — same interaction pattern as
 * {@link RoadmapExpandModeSelect} on the Roadmap toolbar.
 */
export function CompaniesGroupingSelect({
  value,
  onChange,
}: CompaniesGroupingSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = useMemo(() => optionForMode(value), [value]);

  const pick = useCallback(
    (mode: CompaniesGroupingMode) => {
      onChange(mode);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div className="relative inline-block max-w-full shrink-0">
      <span id={`${listId}-label`} className="sr-only">
        How to group or sort companies
      </span>
      <button
        type="button"
        id="companies-grouping-mode"
        aria-labelledby={`${listId}-label`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${listId}-listbox`}
        title={current.title}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          filterSelectTriggerButtonClass(open, true),
          "inline-flex max-w-full min-h-[2.25rem] w-max items-center py-1.5 pl-2.5 pr-2 font-medium transition-colors",
          "hover:border-zinc-600 hover:bg-zinc-800",
          "text-zinc-100"
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
