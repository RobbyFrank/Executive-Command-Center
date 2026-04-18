"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
  const [menuPlacement, setMenuPlacement] = useState<{
    top: number;
    right: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];
  const displayLabel = selected?.label ?? "No Department";

  const updateMenuPlacement = useCallback(() => {
    const el = rootRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const minW = 216; // min-w-[13.5rem]
    const width = Math.max(rect.width, minW);
    const top = rect.bottom + 4;
    const maxHeight = Math.min(
      288, // max-h ~18rem
      Math.max(96, window.innerHeight - top - 12)
    );
    setMenuPlacement({
      top,
      right: window.innerWidth - rect.right,
      width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPlacement(null);
      return;
    }
    updateMenuPlacement();
  }, [open, updateMenuPlacement]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateMenuPlacement();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updateMenuPlacement]);

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
  const isNoDepartment = !value.trim();

  const triggerActive = open;

  const menuPortal =
    open &&
    menuPlacement &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[200]"
          aria-hidden
          onClick={() => setOpen(false)}
        />
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "fixed z-[210] overflow-y-auto overflow-x-hidden rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-md"
          )}
          style={{
            top: menuPlacement.top,
            right: menuPlacement.right,
            width: menuPlacement.width,
            maxHeight: menuPlacement.maxHeight,
          }}
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
                  isSelected && "bg-zinc-800/40",
                  !opt.value.trim() &&
                    "border-l-2 border-l-amber-500/70 bg-amber-950/20 font-semibold text-amber-100 hover:bg-amber-950/35"
                )}
              >
                <DepartmentOptionIcon
                  label={rowIconLabel}
                  className="ring-zinc-700/50"
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    !opt.value.trim() && "text-amber-100"
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
      </>,
      document.body
    );

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
          "group flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm shadow-none transition-[color,background-color,border-color,box-shadow] duration-150",
          isNoDepartment
            ? "border border-amber-500/35 bg-amber-950/35 text-amber-100 font-semibold shadow-sm ring-1 ring-amber-500/20 hover:border-amber-500/45 hover:bg-amber-950/50 hover:text-amber-50"
            : "text-zinc-500 hover:border hover:border-zinc-800 hover:bg-zinc-900/50 hover:text-zinc-200",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          triggerActive &&
            (isNoDepartment
              ? "border-amber-500/50 bg-amber-950/55 text-amber-50 ring-amber-500/35"
              : "border border-zinc-800 bg-zinc-900/50 text-zinc-200 shadow-sm")
        )}
      >
        <DepartmentOptionIcon
          label={iconLabel}
          className={cn(
            "bg-zinc-800/15 shadow-none opacity-60 ring-0 transition-[opacity,background-color,box-shadow] duration-150",
            isNoDepartment
              ? "border border-amber-500/30 bg-amber-950/50 opacity-100 ring-1 ring-amber-500/35"
              : "group-hover:bg-zinc-800/90 group-hover:opacity-100 group-hover:ring-1 group-hover:ring-zinc-700/50 group-hover:shadow-inner",
            !isNoDepartment && "group-focus-visible:opacity-90",
            triggerActive &&
              (isNoDepartment
                ? "border-amber-500/45 bg-amber-950/60 ring-amber-500/45"
                : "bg-zinc-800/90 opacity-100 ring-1 ring-zinc-700/50 shadow-inner")
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            isNoDepartment ? "font-semibold" : "font-medium"
          )}
        >
          {displayLabel}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-all duration-150 motion-reduce:transition-none",
            isNoDepartment ? "text-amber-400/90" : "text-zinc-500",
            "opacity-0 scale-95",
            "group-hover:opacity-100 group-hover:scale-100",
            isNoDepartment
              ? "group-hover:text-amber-300"
              : "group-hover:text-zinc-400",
            "group-focus-visible:opacity-100 group-focus-visible:scale-100",
            triggerActive &&
              (isNoDepartment
                ? "rotate-180 text-amber-200 opacity-100 scale-100"
                : "rotate-180 text-zinc-400 opacity-100 scale-100")
          )}
          aria-hidden
        />
      </button>

      {menuPortal}
    </div>
  );
}
