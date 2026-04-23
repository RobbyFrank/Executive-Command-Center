"use client";

import { cn } from "@/lib/utils";
import { GROUPING_OPTIONS, type GroupingKey } from "./atlas-types";

interface AtlasGroupingToggleProps {
  value: GroupingKey;
  onChange: (next: GroupingKey) => void;
  /** Grey out + disable when no company is focused. */
  disabled?: boolean;
}

export function AtlasGroupingToggle({
  value,
  onChange,
  disabled = false,
}: AtlasGroupingToggleProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-1",
        disabled && "opacity-40"
      )}
      role="tablist"
      aria-label="Group projects by"
    >
      <span className="px-2 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
        Group by
      </span>
      {GROUPING_OPTIONS.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(option.key)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
