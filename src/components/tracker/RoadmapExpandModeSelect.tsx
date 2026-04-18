"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  type LucideIcon,
  Check,
  ChevronDown,
  GitBranch,
  Layers2,
  ListTree,
  Lock,
  Minimize2,
  SlidersHorizontal,
} from "lucide-react";
import type { TrackerExpandPreset } from "./tracker-expand-context";
import { filterSelectTriggerButtonClass } from "./filter-select-trigger";
import { cn } from "@/lib/utils";

type OptionDef = {
  value: TrackerExpandPreset;
  label: string;
  title: string;
  Icon: LucideIcon;
};

/** Shown on the trigger when the user has diverged from a preset (manual expand/collapse). Not listed as a selectable option. */
const CUSTOM_PRESET_DISPLAY: OptionDef = {
  value: null,
  label: "Custom",
  title:
    "Custom — manual expansion; pick a preset below to apply it, or click rows yourself",
  Icon: SlidersHorizontal,
};

const DROPDOWN_OPTIONS: OptionDef[] = [
  {
    value: "collapse",
    label: "All collapsed",
    title: "Companies, goals, projects, and milestones collapsed",
    Icon: Minimize2,
  },
  {
    value: "goals_only",
    label: "Goals only",
    title:
      "Companies expanded; goal rows visible; project lists stay collapsed",
    Icon: ListTree,
  },
  {
    value: "goals_and_projects",
    label: "Goals + projects",
    title: "Projects expanded; milestone lists stay collapsed",
    Icon: Layers2,
  },
  {
    value: "goals_projects_milestones",
    label: "Full tree",
    title: "Expand goals, projects, and milestone lists",
    Icon: GitBranch,
  },
];

function optionForPreset(preset: TrackerExpandPreset): OptionDef {
  if (preset === null) {
    return CUSTOM_PRESET_DISPLAY;
  }
  const found = DROPDOWN_OPTIONS.find((o) => o.value === preset);
  return found ?? DROPDOWN_OPTIONS[0]!;
}

interface RoadmapExpandModeSelectProps {
  expandPreset: TrackerExpandPreset;
  onChange: (preset: TrackerExpandPreset) => void;
  /** When Focus mode is on, tree view is fixed to Goals only — dropdown is non-interactive. */
  viewLocked?: boolean;
}

export function RoadmapExpandModeSelect({
  expandPreset,
  onChange,
  viewLocked = false,
}: RoadmapExpandModeSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = useMemo(
    () => optionForPreset(expandPreset),
    [expandPreset]
  );

  useEffect(() => {
    if (viewLocked) setOpen(false);
  }, [viewLocked]);

  const pick = useCallback(
    (preset: TrackerExpandPreset) => {
      onChange(preset);
      setOpen(false);
    },
    [onChange]
  );

  const lockedTitle =
    "Goals only while Focus is on. Turn off Focus to change the tree view.";

  return (
    <div className="relative inline-block max-w-full shrink-0">
      <span id={`${listId}-label`} className="sr-only">
        Tree expansion mode
      </span>
      <button
        type="button"
        id="tracker-expand-mode"
        aria-labelledby={`${listId}-label`}
        aria-expanded={viewLocked ? false : open}
        aria-haspopup={viewLocked ? undefined : "listbox"}
        aria-controls={viewLocked ? undefined : `${listId}-listbox`}
        aria-disabled={viewLocked}
        title={viewLocked ? lockedTitle : current.title}
        onClick={() => {
          if (viewLocked) return;
          setOpen((o) => !o);
        }}
        className={cn(
          filterSelectTriggerButtonClass(open, expandPreset !== null),
          "inline-flex max-w-full min-h-[2.25rem] w-max items-center py-1.5 pl-2.5 pr-2 font-medium transition-colors",
          viewLocked
            ? "cursor-default border-zinc-600/90 bg-zinc-900/90 text-zinc-100"
            : "hover:border-zinc-600 hover:bg-zinc-800",
          current.value === null ? "text-zinc-500" : "text-zinc-100"
        )}
      >
        <current.Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="whitespace-nowrap text-left">{current.label}</span>
        {viewLocked ? (
          <Lock
            className="h-3.5 w-3.5 shrink-0 text-cyan-500/80"
            aria-hidden
          />
        ) : (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none",
              open && "rotate-180"
            )}
            aria-hidden
          />
        )}
      </button>

      {open && !viewLocked && (
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
            {DROPDOWN_OPTIONS.map((opt) => {
              const selected = opt.value === expandPreset;
              return (
                <button
                  key={opt.label}
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
      )}
    </div>
  );
}
