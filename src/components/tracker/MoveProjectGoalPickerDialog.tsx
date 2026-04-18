"use client";

import { useCallback, useMemo, useState } from "react";
import { Building2, X } from "lucide-react";
import type { Company, Goal } from "@/lib/types/tracker";
import { moveProjectToGoal } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface MoveProjectGoalPickerDialogProps {
  open: boolean;
  onClose: () => void;
  allGoals: Goal[];
  allCompanies: Company[];
  /** Company of this project's primary goal — only goals in this company are listed. */
  projectCompanyId: string;
  projectId: string;
  primaryGoalId: string;
}

export function MoveProjectGoalPickerDialog({
  open,
  onClose,
  allGoals,
  allCompanies,
  projectCompanyId,
  projectId,
  primaryGoalId,
}: MoveProjectGoalPickerDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Same company row as Roadmap (`CompanySection` / `getHierarchy` goal order). */
  const company = useMemo(
    () => allCompanies.find((c) => c.id === projectCompanyId),
    [allCompanies, projectCompanyId]
  );

  /**
   * Same order as goals under this company on Roadmap: `allGoals` comes from
   * `hierarchy.flatMap((c) => c.goals)`, and each company's goals are sorted by
   * priority in `getHierarchy` — filter preserves that order.
   */
  const rows = useMemo(() => {
    return allGoals.filter(
      (g) => g.companyId === projectCompanyId && g.id !== primaryGoalId
    );
  }, [allGoals, projectCompanyId, primaryGoalId]);

  const pick = useCallback(
    async (goalId: string, goalDescription: string) => {
      setError(null);
      setPending(true);
      try {
        await moveProjectToGoal(projectId, goalId);
        toast.success(`Project moved to “${goalDescription}”.`);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not move project.");
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
        aria-label="Move project to another goal"
        className="fixed left-1/2 top-1/2 z-[121] flex max-h-[min(480px,85vh)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            Move project to goal
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
          {company ? (
            <div className="mb-3 flex min-w-0 items-center gap-3 border-b border-zinc-800/80 px-0.5 pb-3">
              {company.logoPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.logoPath}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded object-cover"
                />
              ) : (
                <Building2
                  className="h-5 w-5 shrink-0 text-zinc-500"
                  aria-hidden
                />
              )}
              <span className="min-w-0 truncate text-base font-semibold text-zinc-100">
                {company.name}
              </span>
            </div>
          ) : null}
          {error && (
            <p className="mb-2 rounded border border-amber-500/35 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200/95">
              {error}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-zinc-500">
              No other goals in this company to move to.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void pick(g.id, g.description)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors",
                      "hover:border-zinc-600 hover:bg-zinc-800/80",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    <span className="text-xs text-zinc-200">{g.description}</span>
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
