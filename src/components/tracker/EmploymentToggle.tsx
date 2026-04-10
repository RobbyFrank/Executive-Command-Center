"use client";

import { cn } from "@/lib/utils";

interface EmploymentToggleProps {
  outsourced: boolean;
  onChange: (outsourced: boolean) => void | Promise<unknown>;
  disabled?: boolean;
}

/** Single switch: off = In-house, on = Outsourced. */
export function EmploymentToggle({
  outsourced,
  onChange,
  disabled,
}: EmploymentToggleProps) {
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={outsourced}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          void onChange(!outsourced);
        }}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          disabled && "cursor-not-allowed opacity-50",
          outsourced
            ? "border-orange-500/35 bg-orange-950/50"
            : "border-zinc-700 bg-zinc-800/90"
        )}
        aria-label={outsourced ? "Outsourced — click for In-house" : "In-house — click for Outsourced"}
      >
        <span
          className={cn(
            "pointer-events-none absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-zinc-100 shadow-sm transition-transform duration-200 ease-out",
            outsourced && "translate-x-5"
          )}
        />
      </button>
      <span
        className={cn(
          "min-w-[4.5rem] text-xs font-medium",
          disabled ? "text-zinc-600" : outsourced ? "text-orange-300/90" : "text-zinc-300"
        )}
      >
        {outsourced ? "Outsourced" : "In-house"}
      </span>
    </div>
  );
}
