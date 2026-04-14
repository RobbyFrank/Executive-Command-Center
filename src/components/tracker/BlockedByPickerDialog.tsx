"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { CompanyWithGoals } from "@/lib/types/tracker";
import { updateProject } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";

interface BlockedByPickerDialogProps {
  open: boolean;
  onClose: () => void;
  hierarchy: CompanyWithGoals[];
  /** Project that will receive `blockedByProjectId` — excluded from the list. */
  currentProjectId: string;
}

export function BlockedByPickerDialog({
  open,
  onClose,
  hierarchy,
  currentProjectId,
}: BlockedByPickerDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const out: {
      projectId: string;
      projectName: string;
      companyShort: string;
      goalDescription: string;
    }[] = [];
    /** Mirrored projects appear under multiple goals; list each project once. */
    const seenProjectIds = new Set<string>();
    for (const c of hierarchy) {
      for (const g of c.goals) {
        for (const p of g.projects) {
          if (p.id === currentProjectId) continue;
          if (seenProjectIds.has(p.id)) continue;
          seenProjectIds.add(p.id);
          out.push({
            projectId: p.id,
            projectName: p.name,
            companyShort: c.shortName,
            goalDescription: g.description,
          });
        }
      }
    }
    out.sort((a, b) => {
      const ca = a.companyShort.localeCompare(b.companyShort, undefined, {
        sensitivity: "base",
      });
      if (ca !== 0) return ca;
      return a.projectName.localeCompare(b.projectName, undefined, {
        sensitivity: "base",
      });
    });
    return out;
  }, [hierarchy, currentProjectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.projectName.toLowerCase().includes(q) ||
        r.goalDescription.toLowerCase().includes(q) ||
        r.companyShort.toLowerCase().includes(q)
    );
  }, [rows, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const pick = useCallback(
    async (projectId: string) => {
      setError(null);
      setPending(true);
      try {
        await updateProject(currentProjectId, { blockedByProjectId: projectId });
        setQuery("");
        onClose();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not set blocked-by project."
        );
      } finally {
        setPending(false);
      }
    },
    [currentProjectId, onClose]
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
        onClick={() => !pending && onClose()}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set project this work is blocked by"
        className="fixed left-1/2 top-1/2 z-[121] flex max-h-[min(480px,85vh)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            Blocked by project
          </h2>
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-zinc-800/80 px-3 py-2">
          <label className="sr-only" htmlFor="blocked-by-search">
            Search projects
          </label>
          <input
            id="blocked-by-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, goal, or company…"
            disabled={pending}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40 disabled:opacity-50"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {error && (
            <p className="mb-2 rounded border border-amber-500/35 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200/95">
              {error}
            </p>
          )}
          {filtered.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-zinc-500">
              {rows.length === 0
                ? "No other projects available."
                : "No projects match your search."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((r) => (
                <li key={r.projectId}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void pick(r.projectId)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors",
                      "hover:border-zinc-600 hover:bg-zinc-800/80",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      {r.companyShort}
                    </span>
                    <span className="text-xs font-medium text-zinc-100">
                      {r.projectName}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500">
                      {r.goalDescription}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
