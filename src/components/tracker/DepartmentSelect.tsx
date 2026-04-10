"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DepartmentOptionIcon } from "@/lib/departmentIcons";

export interface DepartmentSelectOption {
  value: string;
  label: string;
}

interface DepartmentSelectProps {
  value: string;
  options: DepartmentSelectOption[];
  onChange: (value: string) => void | Promise<unknown>;
  "aria-label"?: string;
}

export function DepartmentSelect({
  value,
  options,
  onChange,
  "aria-label": ariaLabel = "Department",
}: DepartmentSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];
  const displayLabel = selected?.label ?? "No department";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = useCallback(
    async (next: string) => {
      setOpen(false);
      if (next !== value) await onChange(next);
    },
    [value, onChange]
  );

  const iconLabel = value.trim() === "" ? "" : displayLabel;

  const triggerActive = open;

  return (
    <div ref={rootRef} className="relative w-full min-w-[11rem] max-w-[220px]">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-sm shadow-none transition-[color,background-color,border-color,box-shadow] duration-150",
          "text-zinc-500",
          "hover:border-zinc-800 hover:bg-zinc-900/50 hover:text-zinc-200",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          triggerActive &&
            "border-zinc-800 bg-zinc-900/50 text-zinc-200 shadow-sm",
          !value.trim() && "italic"
        )}
      >
        <DepartmentOptionIcon
          label={iconLabel}
          className={cn(
            "bg-zinc-800/15 shadow-none opacity-60 ring-0 transition-[opacity,background-color,box-shadow] duration-150",
            "group-hover:bg-zinc-800/90 group-hover:opacity-100 group-hover:ring-1 group-hover:ring-zinc-700/50 group-hover:shadow-inner",
            "group-focus-visible:opacity-90",
            triggerActive &&
              "bg-zinc-800/90 opacity-100 ring-1 ring-zinc-700/50 shadow-inner"
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-all duration-150",
            "opacity-0 scale-95",
            "group-hover:opacity-100 group-hover:scale-100 group-hover:text-zinc-400",
            "group-focus-visible:opacity-100 group-focus-visible:scale-100",
            triggerActive && "rotate-180 opacity-100 scale-100 text-zinc-400"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              "absolute right-0 top-full z-50 mt-1 max-h-[min(18rem,calc(100vh-8rem))] w-full min-w-[13.5rem] overflow-y-auto overflow-x-hidden rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-md"
            )}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              const rowIconLabel = opt.value === "" ? "" : opt.label;
              return (
                <button
                  key={opt.value === "" ? "__empty" : opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => void pick(opt.value)}
                  className={cn(
                    "flex w-full items-center gap-3 px-2 py-2 text-left text-sm transition-colors",
                    "hover:bg-zinc-800/60",
                    isSelected && "bg-zinc-800/40"
                  )}
                >
                  <DepartmentOptionIcon
                    label={rowIconLabel}
                    className="ring-zinc-700/50"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !opt.value.trim() && "italic text-zinc-500"
                    )}
                  >
                    {opt.label}
                  </span>
                  {isSelected ? (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-zinc-400"
                      aria-hidden
                    />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
