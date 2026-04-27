"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Discreet toolbar control: the "…" trigger keeps sensitive roster data (e.g. compensation)
 * out of sight by default for screensharing.
 */
export function TeamRosterViewMenu({
  showSensitiveData,
  onShowSensitiveDataChange,
  disabled,
}: {
  showSensitiveData: boolean;
  onShowSensitiveDataChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="relative inline-block max-w-full shrink-0">
      <button
        type="button"
        id={`${listId}-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${listId}-menu`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-zinc-900/80 text-zinc-400 transition-[border-color,background-color,color] duration-150 ease-out motion-reduce:transition-none",
          "hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400/20 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          disabled
            ? "cursor-not-allowed border-zinc-800 opacity-50"
            : "cursor-pointer border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800",
          open && !disabled && "border-zinc-500/50 text-zinc-200"
        )}
        title="View options"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
        <span className="sr-only">View options</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={close} />
          <div
            id={`${listId}-menu`}
            role="menu"
            aria-labelledby={`${listId}-trigger`}
            className="absolute right-0 top-full z-50 mt-1 w-max min-w-[14rem] max-w-[min(100vw-2rem,20rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showSensitiveData}
              className="flex w-full items-center justify-between gap-3 px-2.5 py-2 pl-2.5 pr-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
              onClick={() => {
                onShowSensitiveDataChange(!showSensitiveData);
                close();
              }}
            >
              <span className="min-w-0">Show Sensitive Data</span>
              <input
                type="checkbox"
                readOnly
                tabIndex={-1}
                checked={showSensitiveData}
                className="pointer-events-none h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-amber-500"
                aria-hidden
              />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
