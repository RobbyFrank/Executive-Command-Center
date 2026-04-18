"use client";

import type { EmploymentKind } from "@/lib/types/tracker";
import {
  EMPLOYMENT_KIND_ORDER,
  employmentLabel,
} from "@/lib/employmentLabels";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface EmploymentSelectProps {
  employment: EmploymentKind;
  onChange: (employment: EmploymentKind) => void | Promise<unknown>;
  disabled?: boolean;
}

export function EmploymentSelect({
  employment,
  onChange,
  disabled,
}: EmploymentSelectProps) {
  return (
    <div
      className={cn(
        "group relative w-full min-w-[9.5rem] max-w-[220px]",
        !disabled && "cursor-pointer"
      )}
    >
      <select
        value={employment}
        disabled={disabled}
        aria-label="Team employment type"
        onChange={(e) => {
          void onChange(e.target.value as EmploymentKind);
        }}
        className={cn(
          "w-full cursor-pointer appearance-none rounded-md border-0 bg-transparent py-1.5 pl-2 pr-7 text-sm shadow-none transition-[color,background-color,border-color]",
          "text-zinc-300",
          "hover:border hover:border-zinc-800 hover:bg-zinc-900/50 hover:text-zinc-200",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          disabled && "cursor-not-allowed opacity-50",
          employment === "outsourced" && "text-orange-300/90"
        )}
      >
        {EMPLOYMENT_KIND_ORDER.map((kind) => (
          <option key={kind} value={kind}>
            {employmentLabel(kind)}
          </option>
        ))}
      </select>
      {!disabled ? (
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-1.5 top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 transition-all duration-150 motion-reduce:transition-none",
            "opacity-0 scale-95",
            "group-hover:opacity-100 group-hover:scale-100 group-hover:text-zinc-400",
            "group-focus-within:opacity-100 group-focus-within:scale-100 group-focus-within:text-zinc-400"
          )}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
