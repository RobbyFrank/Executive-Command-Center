"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Bookmark, Flag, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExecFlagMode = "none" | "at_risk" | "spotlight";

function modeFromFlags(atRisk: boolean, spotlight: boolean): ExecFlagMode {
  if (atRisk) return "at_risk";
  if (spotlight) return "spotlight";
  return "none";
}

function flagsFromMode(mode: ExecFlagMode): {
  atRisk: boolean;
  spotlight: boolean;
} {
  switch (mode) {
    case "at_risk":
      return { atRisk: true, spotlight: false };
    case "spotlight":
      return { atRisk: false, spotlight: true };
    default:
      return { atRisk: false, spotlight: false };
  }
}

const OPTIONS: {
  mode: ExecFlagMode;
  label: string;
  hint: string;
  Icon: LucideIcon;
}[] = [
  {
    mode: "none",
    label: "None",
    hint: "No executive signal",
    Icon: Bookmark,
  },
  {
    mode: "at_risk",
    label: "At risk",
    hint: "Needs attention",
    Icon: Flag,
  },
  {
    mode: "spotlight",
    label: "Spotlight",
    hint: "Win or momentum — exec highlight",
    Icon: Sparkles,
  },
];

interface ExecFlagMenuProps {
  atRisk: boolean;
  spotlight: boolean;
  onCommit: (flags: { atRisk: boolean; spotlight: boolean }) => void;
  /** Shown in aria-labels, e.g. "Goal" or "Project" */
  entityLabel: string;
  /**
   * Roadmap rows use `group/goal` vs `group/project` so hover-revealed controls stay per-row.
   * Default matches goal rows.
   */
  rowGroup?: "goal" | "project";
}

export function ExecFlagMenu({
  atRisk,
  spotlight,
  onCommit,
  entityLabel,
  rowGroup = "goal",
}: ExecFlagMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [menuPlacement, setMenuPlacement] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const listId = useId();
  const mode = modeFromFlags(atRisk, spotlight);
  const rowGroupHoverOpacity =
    rowGroup === "project"
      ? "group-hover/project:opacity-100"
      : "group-hover/goal:opacity-100";

  const updateMenuPlacement = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    setMenuPlacement({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPlacement(null);
      return;
    }
    updateMenuPlacement();
  }, [open, updateMenuPlacement]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateMenuPlacement();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updateMenuPlacement]);

  const applyMode = useCallback(
    (m: ExecFlagMode) => {
      onCommit(flagsFromMode(m));
      setOpen(false);
    },
    [onCommit]
  );

  const menuPortal =
    open &&
    menuPlacement &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[200]"
          aria-hidden
          onClick={() => setOpen(false)}
        />
        <div
          id={`${listId}-menu`}
          role="listbox"
          aria-label={`${entityLabel} executive signal`}
          className="fixed z-[210] w-max min-w-[10.5rem] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          style={{
            top: menuPlacement.top,
            right: menuPlacement.right,
          }}
        >
          {OPTIONS.map(({ mode: m, label, hint, Icon }) => {
            const selected = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={selected}
                title={hint}
                onClick={() => applyMode(m)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                  selected
                    ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                    : "text-zinc-200 hover:bg-zinc-800/60"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    m === "at_risk" && "text-amber-400",
                    m === "spotlight" && "text-emerald-400",
                    m === "none" && "text-zinc-500"
                  )}
                  aria-hidden
                />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </>,
      document.body
    );

  return (
    <div
      ref={triggerRef}
      className="relative shrink-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span id={`${listId}-label`} className="sr-only">
        Executive signal for {entityLabel}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${listId}-label`}
        aria-controls={open ? `${listId}-menu` : undefined}
        title={
          mode === "none"
            ? "Set executive signal (at risk or spotlight)"
            : mode === "at_risk"
              ? "At risk — click to change"
              : "Spotlight — click to change"
        }
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center justify-center rounded p-1 transition-colors",
          mode === "none" &&
            cn(
              "text-zinc-500 opacity-0 hover:opacity-100 focus-visible:opacity-100",
              rowGroupHoverOpacity
            ),
          mode === "none" && open && "opacity-100",
          mode === "at_risk" &&
            "text-amber-300 ring-1 ring-amber-400/40 bg-amber-500/10 opacity-100",
          mode === "spotlight" &&
            "text-emerald-300 ring-1 ring-emerald-400/40 bg-emerald-500/10 opacity-100"
        )}
      >
        {mode === "none" && (
          <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        )}
        {mode === "at_risk" && (
          <Flag
            className="h-4 w-4"
            strokeWidth={2.25}
            fill="currentColor"
            aria-hidden
          />
        )}
        {mode === "spotlight" && (
          <Sparkles className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        )}
      </button>

      {menuPortal}
    </div>
  );
}
