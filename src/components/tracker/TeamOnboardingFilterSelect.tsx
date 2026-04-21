"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Check, ChevronDown, UserPlus, Users } from "lucide-react";
import { filterSelectTriggerButtonClass } from "./filter-select-trigger";
import { cn } from "@/lib/utils";

export type TeamOnboardingFilterValue = "all" | "onboarding";

interface TeamOnboardingFilterSelectProps {
  value: TeamOnboardingFilterValue;
  onChange: (value: TeamOnboardingFilterValue) => void;
  /** Row count when the onboarding dimension is not applied (same facet base as other columns). */
  allCount: number;
  /** How many of those people are in active onboarding. */
  onboardingCount: number;
  disabled?: boolean;
}

/**
 * Single-select filter: all team members vs. onboarding (new hire + pilot project).
 */
export function TeamOnboardingFilterSelect({
  value,
  onChange,
  allCount,
  onboardingCount,
  disabled = false,
}: TeamOnboardingFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = useCallback(
    (next: TeamOnboardingFilterValue) => {
      onChange(next);
      setOpen(false);
    },
    [onChange]
  );

  const summary =
    value === "onboarding"
      ? "Onboarding"
      : "All members";

  return (
    <div className="relative inline-block max-w-full shrink-0">
      <span id={`${listId}-label`} className="sr-only">
        Filter by onboarding status
      </span>
      <button
        type="button"
        id="team-roster-onboarding-filter"
        aria-labelledby={`${listId}-label`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${listId}-listbox`}
        title={
          disabled
            ? "Filter is locked while Slack sync runs"
            : "Show everyone or only people in active onboarding"
        }
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        className={cn(
          filterSelectTriggerButtonClass(open, value === "onboarding"),
          "inline-flex max-w-full min-h-[2.25rem] w-max items-center py-1.5 pl-2.5 pr-2 font-medium transition-colors",
          "text-zinc-100",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Users className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="whitespace-nowrap text-left">{summary}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            id={`${listId}-listbox`}
            role="listbox"
            aria-labelledby={`${listId}-label`}
            className="absolute left-0 top-full z-50 mt-1 min-w-full w-max max-w-[min(100vw-2rem,20rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <button
              type="button"
              role="option"
              aria-selected={value === "all"}
              onClick={() => pick("all")}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                value === "all"
                  ? "bg-zinc-800/90 text-zinc-100"
                  : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
            >
              <Users
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  value === "all" ? "text-zinc-200" : "text-zinc-500"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">All members</span>
              <span
                className={cn(
                  "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  value === "all"
                    ? "bg-zinc-700/80 text-zinc-200"
                    : "bg-zinc-800/70 text-zinc-500"
                )}
              >
                {allCount}
              </span>
              {value === "all" ? (
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-emerald-500/90"
                  strokeWidth={2.5}
                  aria-hidden
                />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
            </button>
            <button
              type="button"
              role="option"
              aria-selected={value === "onboarding"}
              title="New hire (first 30 days) with at least one pilot project"
              onClick={() => pick("onboarding")}
              disabled={onboardingCount === 0}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                onboardingCount === 0
                  ? "cursor-not-allowed opacity-40 text-zinc-500"
                  : value === "onboarding"
                    ? "bg-zinc-800/90 text-zinc-100"
                    : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
            >
              <UserPlus
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  value === "onboarding" ? "text-emerald-400/95" : "text-zinc-500"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">Onboarding</span>
              <span
                className={cn(
                  "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  onboardingCount === 0
                    ? "bg-zinc-800/70 text-zinc-500"
                    : value === "onboarding"
                      ? "bg-emerald-500/15 text-emerald-200/95 ring-1 ring-emerald-400/30"
                      : "bg-zinc-800/70 text-zinc-400"
                )}
              >
                {onboardingCount}
              </span>
              {value === "onboarding" ? (
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-emerald-500/90"
                  strokeWidth={2.5}
                  aria-hidden
                />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
