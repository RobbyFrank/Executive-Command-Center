"use client";

import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { CompanyWithGoals } from "@/lib/types/tracker";
import { mirrorProjectToGoal } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";

interface MirrorGoalPickerDialogProps {
  open: boolean;
  onClose: () => void;
  hierarchy: CompanyWithGoals[];
  projectId: string;
  primaryGoalId: string;
  mirroredGoalIds: string[];
}

export function MirrorGoalPickerDialog({
  open,
  onClose,
  hierarchy,
  projectId,
  primaryGoalId,
  mirroredGoalIds,
}: MirrorGoalPickerDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excluded = useMemo(
    () => new Set([primaryGoalId, ...mirroredGoalIds]),
    [primaryGoalId, mirroredGoalIds]
  );

  const rows = useMemo(() => {
    const out: { companyName: string; companyShort: string; goalId: string; description: string }[] =
      [];
    for (const c of hierarchy) {
      for (const g of c.goals) {
        if (excluded.has(g.id)) continue;
        out.push({
          companyName: c.name,
          companyShort: c.shortName,
          goalId: g.id,
          description: g.description,
        });
      }
    }
    out.sort((a, b) => {
      const ca = a.companyShort.localeCompare(b.companyShort, undefined, {
        sensitivity: "base",
      });
      if (ca !== 0) return ca;
      return a.description.localeCompare(b.description, undefined, {
        sensitivity: "base",
      });
    });
    return out;
  }, [hierarchy, excluded]);

  const pick = useCallback(
    async (goalId: string) => {
      setError(null);
      setPending(true);
      try {
        await mirrorProjectToGoal(projectId, goalId);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not mirror project.");
      } finally {
        setPending(false);
      }
    },
    [projectId, onClose]
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
        aria-label="Mirror project to another goal"
        className="fixed left-1/2 top-1/2 z-[121] flex max-h-[min(480px,85vh)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            Mirror project to goal
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
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {error && (
            <p className="mb-2 rounded border border-amber-500/35 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200/95">
              {error}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-zinc-500">
              No other goals to mirror to.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((r) => (
                <li key={r.goalId}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void pick(r.goalId)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors",
                      "hover:border-zinc-600 hover:bg-zinc-800/80",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      {r.companyShort}
                    </span>
                    <span className="text-xs text-zinc-200">{r.description}</span>
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
