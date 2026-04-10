"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TeamFacetOption {
  id: string;
  label: string;
  count: number;
  icon?: React.ReactNode;
  labelClassName?: string;
}

interface TeamFacetMultiSelectProps {
  /** Screen reader + button summary context */
  ariaLabel: string;
  /** Closed state label when nothing selected */
  emptySummary: string;
  summaryIcon: React.ReactNode;
  options: TeamFacetOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  enableSearch?: boolean;
  searchPlaceholder?: string;
}

export function TeamFacetMultiSelect({
  ariaLabel,
  emptySummary,
  summaryIcon,
  options,
  selectedIds,
  onChange,
  enableSearch = false,
  searchPlaceholder = "Search…",
}: TeamFacetMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchFieldId = `${listId}-search`;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!enableSearch || !q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, enableSearch, q]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    },
    [selectedIds, onChange]
  );

  const clear = useCallback(() => onChange([]), [onChange]);

  const selectionCount = selectedIds.length;

  const buttonSummary =
    selectionCount === 0 ? (
      <>
        <span className="text-zinc-500 shrink-0">{summaryIcon}</span>
        <span className="truncate">{emptySummary}</span>
      </>
    ) : selectionCount === 1 ? (
      (() => {
        const one = options.find((o) => o.id === selectedIds[0]);
        return (
          <>
            {one?.icon ? (
              <span className="shrink-0">{one.icon}</span>
            ) : (
              <span className="text-zinc-500 shrink-0">{summaryIcon}</span>
            )}
            <span className="truncate min-w-0">{one?.label ?? "1 selected"}</span>
          </>
        );
      })()
    ) : (
      <>
        <span className="text-zinc-500 shrink-0">{summaryIcon}</span>
        <span className="truncate">{selectionCount} selected</span>
      </>
    );

  return (
    <div className="relative min-w-[9rem] w-full max-w-[16rem] overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        {ariaLabel}
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
        <span className="flex min-w-0 flex-1 items-center gap-2">{buttonSummary}</span>
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
          <div className="fixed inset-0 z-[120]" onClick={() => setOpen(false)} />
          <div
            id={`${listId}-panel`}
            role="group"
            aria-label={ariaLabel}
            className="absolute right-0 top-full z-[130] mt-1 min-w-full w-max max-w-[min(100vw-2rem,22rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            {enableSearch ? (
              <div className="border-b border-zinc-800 px-2 pb-2 pt-1.5">
                <label htmlFor={searchFieldId} className="sr-only">
                  Search options
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
                    aria-hidden
                  />
                  <input
                    ref={searchRef}
                    id={searchFieldId}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    autoComplete="off"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 py-1.5 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  />
                </div>
              </div>
            ) : null}
            <div className="max-h-[min(24rem,calc(100vh-10rem))] overflow-y-auto overflow-x-auto px-1 py-0.5">
              {filteredOptions.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-zinc-500">
                  {q ? `No matches for “${query.trim()}”.` : "No options."}
                </p>
              ) : (
                filteredOptions.map((opt) => {
                  const selected = selectedSet.has(opt.id);
                  return (
                    <button
                      key={opt.id || "__empty__"}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(opt.id)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                        selected
                          ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                          : "text-zinc-200 hover:bg-zinc-800/60"
                      )}
                    >
                      {opt.icon ? (
                        <span className="shrink-0">{opt.icon}</span>
                      ) : null}
                      <span
                        className={cn(
                          "min-w-0 flex-1 leading-snug",
                          opt.labelClassName
                        )}
                      >
                        {opt.label}
                      </span>
                      <span
                        className="shrink-0 tabular-nums text-[11px] text-zinc-500"
                        aria-label={`${opt.count} matches`}
                      >
                        {opt.count}
                      </span>
                    </button>
                  );
                })
              )}
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
