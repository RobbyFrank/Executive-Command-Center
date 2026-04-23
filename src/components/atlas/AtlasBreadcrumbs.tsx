"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";

export interface AtlasCrumb {
  label: string;
  onClick: () => void;
  /** When true, this crumb is the current level (highlighted, non-clickable). */
  active?: boolean;
}

export function AtlasBreadcrumbs({ crumbs }: { crumbs: AtlasCrumb[] }) {
  return (
    <nav
      className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em]"
      aria-label="Atlas zoom path"
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Fragment key={`${crumb.label}-${i}`}>
            <button
              type="button"
              onClick={crumb.active ? undefined : crumb.onClick}
              className={cn(
                "shrink-0 transition-colors",
                isLast && "min-w-0 max-w-full truncate",
                crumb.active
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200"
              )}
              aria-current={crumb.active ? "page" : undefined}
              title={crumb.label}
            >
              {crumb.label}
            </button>
            {i < crumbs.length - 1 ? (
              <span className="shrink-0 text-zinc-700">/</span>
            ) : null}
          </Fragment>
        );
      })}
    </nav>
  );
}
