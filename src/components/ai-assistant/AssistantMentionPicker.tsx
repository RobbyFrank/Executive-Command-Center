"use client";

import { useEffect, useMemo, useRef } from "react";
import { Building2, CircleDot, Flag, Layers } from "lucide-react";
import type {
  AssistantEntitiesBundle,
  AssistantEntityOption,
} from "@/lib/types/assistant-entities";
import { cn } from "@/lib/utils";

export type { AssistantEntitiesBundle };

function matches(item: AssistantEntityOption, q: string): boolean {
  if (!q.trim()) return true;
  const s = q.trim().toLowerCase();
  const typeLabel =
    item.type === "company"
      ? "company"
      : item.type === "goal"
        ? "goal"
        : item.type === "project"
          ? "project"
          : "milestone";
  const hay = `${item.label} ${item.subtitle ?? ""} ${typeLabel}`.toLowerCase();
  return hay.includes(s);
}

type Row =
  | { kind: "header"; title: string }
  | { kind: "item"; item: AssistantEntityOption; flatIndex: number };

function buildRows(
  bundle: AssistantEntitiesBundle | null,
  q: string,
): { rows: Row[]; flatItems: AssistantEntityOption[] } {
  if (!bundle) return { rows: [], flatItems: [] };

  const sections: {
    title: string;
    icon: typeof Building2;
    items: AssistantEntityOption[];
  }[] = [
    { title: "Companies", icon: Building2, items: bundle.companies },
    { title: "Goals", icon: Flag, items: bundle.goals },
    { title: "Projects", icon: Layers, items: bundle.projects },
    { title: "Milestones", icon: CircleDot, items: bundle.milestones },
  ];

  const rows: Row[] = [];
  const flatItems: AssistantEntityOption[] = [];

  for (const sec of sections) {
    const filtered = sec.items.filter((it) => matches(it, q));
    if (filtered.length === 0) continue;
    rows.push({ kind: "header", title: sec.title });
    for (const item of filtered) {
      const flatIndex = flatItems.length;
      flatItems.push(item);
      rows.push({ kind: "item", item, flatIndex });
    }
  }

  return { rows, flatItems };
}

function TypeIcon({ type }: { type: AssistantEntityOption["type"] }) {
  const cls = "h-4 w-4 shrink-0";
  switch (type) {
    case "company":
      return <Building2 className={cn(cls, "text-sky-400/90")} aria-hidden />;
    case "goal":
      return <Flag className={cn(cls, "text-emerald-400/90")} aria-hidden />;
    case "project":
      return <Layers className={cn(cls, "text-amber-400/90")} aria-hidden />;
    case "milestone":
      return <CircleDot className={cn(cls, "text-violet-400/90")} aria-hidden />;
    default:
      return null;
  }
}

export function AssistantMentionPicker({
  bundle,
  query,
  loading,
  error,
  open,
  highlightedIndex,
  onHighlightedIndexChange,
  onSelect,
}: {
  bundle: AssistantEntitiesBundle | null;
  query: string;
  loading: boolean;
  error: string | null;
  open: boolean;
  highlightedIndex: number;
  onHighlightedIndexChange: (n: number) => void;
  onSelect: (item: AssistantEntityOption) => void;
}) {
  const { rows, flatItems } = useMemo(
    () => buildRows(bundle, query),
    [bundle, query],
  );

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || flatItems.length === 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-flat-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, flatItems.length, open]);

  if (!open) return null;

  return (
    <div
      className="mb-1 flex max-h-[min(280px,40vh)] flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-2xl ring-1 ring-black/40"
      role="listbox"
      aria-label="Tag company, goal, project, or milestone"
    >
      <div className="border-b border-zinc-700/80 px-2.5 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Tag workspace item
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          Search matches name, company, and type —{" "}
          <kbd className="rounded bg-zinc-800 px-1 py-px font-mono text-[10px] text-zinc-300">
            ↑↓
          </kbd>{" "}
          move ·{" "}
          <kbd className="rounded bg-zinc-800 px-1 py-px font-mono text-[10px] text-zinc-300">
            Enter
          </kbd>{" "}
          insert ·{" "}
          <kbd className="rounded bg-zinc-800 px-1 py-px font-mono text-[10px] text-zinc-300">
            Esc
          </kbd>{" "}
          close
        </p>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && (
          <p className="px-3 py-4 text-sm text-zinc-500">Loading workspace…</p>
        )}
        {error && (
          <p className="px-3 py-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && flatItems.length === 0 && (
          <p className="px-3 py-4 text-sm text-zinc-500">
            {bundle ? "No matches — try another word." : "No data."}
          </p>
        )}
        {!loading &&
          !error &&
          rows.map((row, i) => {
            if (row.kind === "header") {
              return (
                <div
                  key={`h-${row.title}-${i}`}
                  className="sticky top-0 z-[1] bg-zinc-900/95 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 backdrop-blur-sm"
                >
                  {row.title}
                </div>
              );
            }
            const active = row.flatIndex === highlightedIndex;
            const it = row.item;
            return (
              <button
                key={`${it.type}-${it.id}`}
                type="button"
                data-flat-index={row.flatIndex}
                role="option"
                aria-selected={active}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-emerald-900/35 text-zinc-100"
                    : "text-zinc-200 hover:bg-zinc-800/80",
                )}
                onMouseEnter={() => onHighlightedIndexChange(row.flatIndex)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(it)}
              >
                <TypeIcon type={it.type} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium leading-snug">
                    {it.label}
                  </span>
                  {it.subtitle && (
                    <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                      {it.subtitle}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

export function countFlatItems(
  bundle: AssistantEntitiesBundle | null,
  q: string,
): number {
  return buildRows(bundle, q).flatItems.length;
}

export function getNthFlatItem(
  bundle: AssistantEntitiesBundle | null,
  q: string,
  index: number,
): AssistantEntityOption | null {
  const { flatItems } = buildRows(bundle, q);
  if (index < 0 || index >= flatItems.length) return null;
  return flatItems[index] ?? null;
}
