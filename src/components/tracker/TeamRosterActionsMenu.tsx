"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, RefreshCw, Sparkles } from "lucide-react";
import { filterSelectTriggerButtonClass } from "./filter-select-trigger";
import { cn } from "@/lib/utils";
import { SlackLogo } from "./SlackLogo";

export type SlackRefreshScope = "incomplete" | "all";

interface TeamRosterActionsMenuProps {
  onImportFromSlack: () => void;
  onRefreshFromSlack: (scope: SlackRefreshScope) => void;
  /** Total roster rows that have a Slack user ID (targets for "all"). */
  slackTargetCount: number;
  /** Subset of roster rows missing at least one Slack-sourced field (targets for "incomplete"). */
  incompleteTargetCount: number;
  slackBulkRefreshRunning: boolean;
}

/**
 * Slack-related roster actions, grouped under an “Actions” control on the Team toolbar.
 *
 * The refresh action is split into two scopes so founders can re-hydrate just the rows
 * that have empty fields (much faster on big teams) without forcing every row through
 * another Slack round-trip:
 *
 * - **Refresh incomplete profiles** — only rows missing name / email / join date / role /
 *   department / photo. Disabled with `"All profiles up to date"` tooltip when none match.
 * - **Refresh all from Slack** — every row with a Slack user ID (current behavior).
 */
export function TeamRosterActionsMenu({
  onImportFromSlack,
  onRefreshFromSlack,
  slackTargetCount,
  incompleteTargetCount,
  slackBulkRefreshRunning,
}: TeamRosterActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (slackBulkRefreshRunning) setOpen(false);
  }, [slackBulkRefreshRunning]);

  const close = useCallback(() => setOpen(false), []);

  const refreshAllDisabled =
    slackBulkRefreshRunning || slackTargetCount === 0;
  const refreshIncompleteDisabled =
    slackBulkRefreshRunning || incompleteTargetCount === 0;

  const refreshAllTitle =
    slackTargetCount === 0
      ? "Add Slack user IDs to team members first"
      : `Re-fetch profile, email, join date, and photo for all ${slackTargetCount} ${
          slackTargetCount === 1 ? "member" : "members"
        } with a Slack ID`;

  const refreshIncompleteTitle =
    slackTargetCount === 0
      ? "Add Slack user IDs to team members first"
      : incompleteTargetCount === 0
        ? "All profiles are already filled in — nothing to fetch"
        : `Fetch only the ${incompleteTargetCount} ${
            incompleteTargetCount === 1 ? "profile" : "profiles"
          } missing a name, email, join date, role, department, or photo`;

  return (
    <div className="relative inline-block max-w-full shrink-0">
      <button
        type="button"
        id={`${listId}-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${listId}-menu`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          filterSelectTriggerButtonClass(open, false),
          "inline-flex max-w-full min-h-[2.25rem] w-max items-center gap-2 py-1.5 pl-2.5 pr-2 font-medium transition-colors",
          "hover:border-zinc-600 hover:bg-zinc-800",
          "text-zinc-100"
        )}
      >
        <Sparkles
          className="h-3.5 w-3.5 shrink-0 text-zinc-400"
          strokeWidth={2}
          aria-hidden
        />
        <span className="whitespace-nowrap text-left">Actions</span>
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
            onClick={close}
          />
          <div
            id={`${listId}-menu`}
            role="menu"
            aria-labelledby={`${listId}-trigger`}
            className="absolute right-0 top-full z-50 mt-1 min-w-[16rem] w-max max-w-[min(100vw-2rem,22rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
              onClick={() => {
                onImportFromSlack();
                close();
              }}
            >
              <SlackLogo alt="" className="h-3.5 w-3.5 shrink-0 opacity-90" />
              <span className="min-w-0 flex-1">Import from Slack</span>
            </button>

            <div
              className="mx-2 my-1 border-t border-zinc-800"
              role="separator"
            />

            <button
              type="button"
              role="menuitem"
              disabled={refreshIncompleteDisabled}
              title={refreshIncompleteTitle}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                refreshIncompleteDisabled
                  ? "cursor-not-allowed opacity-40 text-zinc-500"
                  : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
              onClick={() => {
                if (refreshIncompleteDisabled) return;
                onRefreshFromSlack("incomplete");
                close();
              }}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-zinc-500",
                  slackBulkRefreshRunning && "animate-spin"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                Refresh incomplete profiles
              </span>
              <span
                className={cn(
                  "ml-auto shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  incompleteTargetCount === 0
                    ? "bg-zinc-800/70 text-zinc-500"
                    : "bg-amber-500/15 text-amber-200/95 ring-1 ring-amber-400/30"
                )}
                aria-label={`${incompleteTargetCount} incomplete`}
              >
                {incompleteTargetCount}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              disabled={refreshAllDisabled}
              title={refreshAllTitle}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                refreshAllDisabled
                  ? "cursor-not-allowed opacity-40 text-zinc-500"
                  : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
              onClick={() => {
                if (refreshAllDisabled) return;
                onRefreshFromSlack("all");
                close();
              }}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-zinc-500",
                  slackBulkRefreshRunning && "animate-spin"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">Refresh all from Slack</span>
              <span
                className="ml-auto shrink-0 rounded-sm bg-zinc-800/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-400"
                aria-label={`${slackTargetCount} with Slack ID`}
              >
                {slackTargetCount}
              </span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
