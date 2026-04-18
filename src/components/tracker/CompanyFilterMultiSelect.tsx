"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CompanyWithGoals } from "@/lib/types/tracker";
import { Building2, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FilterSelectSelectionBadge,
  filterSelectTriggerButtonClass,
} from "./filter-select-trigger";

export type CompanyFilterOption = Pick<
  CompanyWithGoals,
  "id" | "name" | "shortName" | "logoPath" | "revenue"
>;

function formatMrrFromThousands(revenue: number): string {
  if (!Number.isFinite(revenue) || revenue < 0) return "—";
  if (revenue === 0) return "$0";
  return `$${revenue}K`;
}

function CompanyMark({
  company,
  size = "md",
  selected = false,
}: {
  company: CompanyFilterOption;
  size?: "sm" | "md";
  selected?: boolean;
}) {
  const path = company.logoPath?.trim();
  const box = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const ringSelected = selected ? "ring-2 ring-zinc-400" : "ring-1 ring-zinc-700";
  if (path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={path}
        alt=""
        className={cn(
          "shrink-0 rounded object-cover transition-[box-shadow]",
          ringSelected,
          box
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded flex items-center justify-center transition-[box-shadow]",
        selected
          ? "bg-zinc-700 ring-2 ring-zinc-400 text-zinc-50"
          : "bg-zinc-800 ring-1 ring-zinc-700 text-zinc-400",
        box
      )}
      aria-hidden
    >
      <Building2 className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </span>
  );
}

interface CompanyFilterMultiSelectProps {
  companies: CompanyFilterOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** When set, shown as a tabular badge per company row (faceted roster counts). */
  optionCounts?: Map<string, number>;
}

export function CompanyFilterMultiSelect({
  companies,
  selectedIds,
  onChange,
  optionCounts,
}: CompanyFilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [nameSearch, setNameSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchFieldId = `${listId}-company-search`;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (!open) {
      setNameSearch("");
      return;
    }
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const filteredCompanies = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.shortName.toLowerCase().includes(q)
    );
  }, [companies, nameSearch]);

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

  const selectedCompanies = useMemo(() => {
    const byId = new Map(companies.map((c) => [c.id, c]));
    return selectedIds
      .map((id) => byId.get(id))
      .filter((c): c is CompanyFilterOption => c !== undefined);
  }, [companies, selectedIds]);

  const buttonSummary =
    selectedCompanies.length === 0 ? (
      <>
        <Building2 className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden />
        <span className="truncate">All companies</span>
      </>
    ) : selectedCompanies.length === 1 ? (
      <>
        <CompanyMark company={selectedCompanies[0]} size="sm" />
        <span className="truncate min-w-0">{selectedCompanies[0].name}</span>
      </>
    ) : (
      <>
        <span className="flex items-center shrink-0 -space-x-1.5">
          {selectedCompanies.slice(0, 4).map((c) => (
            <span key={c.id} className="ring-2 ring-zinc-950 rounded">
              <CompanyMark company={c} size="sm" />
            </span>
          ))}
        </span>
        <span className="truncate">{selectedCompanies.length} companies</span>
      </>
    );

  return (
    <div className="relative min-w-[10rem] w-full max-w-full overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        Filter tracker by company
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${listId}-label`}
        aria-controls={`${listId}-panel`}
        onClick={() => setOpen((o) => !o)}
        className={filterSelectTriggerButtonClass(
          open,
          selectedIds.length > 0
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {buttonSummary}
          <FilterSelectSelectionBadge count={selectedIds.length} />
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            id={`${listId}-panel`}
            role="group"
            aria-label="Companies"
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <div className="border-b border-zinc-800 px-2 pb-2 pt-1.5">
              <label htmlFor={searchFieldId} className="sr-only">
                Filter companies by name
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
                  aria-hidden
                />
                <input
                  ref={searchInputRef}
                  id={searchFieldId}
                  type="search"
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="Search companies…"
                  autoComplete="off"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 py-1.5 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>
            </div>
            <div className="max-h-[32rem] overflow-y-auto overflow-x-auto px-1 py-0.5">
              {filteredCompanies.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-zinc-500">
                  {nameSearch.trim()
                    ? `No companies match "${nameSearch.trim()}".`
                    : "No companies."}
                </p>
              ) : (
                filteredCompanies.map((company) => {
                  const selected = selectedSet.has(company.id);
                  return (
                    <button
                      key={company.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(company.id)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                        selected
                          ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                          : "text-zinc-200 hover:bg-zinc-800/60"
                      )}
                    >
                      <CompanyMark company={company} selected={selected} />
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0">
                        <span>{company.name}</span>
                        <span className="text-[10px] text-zinc-500">
                          {company.shortName}
                          <span aria-hidden> • </span>
                          {formatMrrFromThousands(company.revenue)}
                        </span>
                      </span>
                      {optionCounts?.has(company.id) ? (
                        <span
                          className="shrink-0 tabular-nums text-[11px] text-zinc-500"
                          aria-label={`${optionCounts.get(company.id)} team matches`}
                        >
                          {optionCounts.get(company.id)}
                        </span>
                      ) : null}
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
