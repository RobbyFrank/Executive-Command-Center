import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Dashed empty-state card used on Roadmap, Team, and Companies when there is no data yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  descriptionClassName,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Primary CTAs below the description (e.g. Add first …). */
  actions?: ReactNode;
  /** e.g. max-w-md when the copy is longer (Roadmap). */
  descriptionClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 px-6 py-20">
      <div className="flex items-center justify-center h-14 w-14 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 mb-5">
        <Icon className="h-7 w-7 text-zinc-500" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-zinc-200 mb-1.5">{title}</h2>
      <div
        className={cn(
          "text-sm text-zinc-500 text-center",
          actions ? "mb-6" : null,
          descriptionClassName
        )}
      >
        {description}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
