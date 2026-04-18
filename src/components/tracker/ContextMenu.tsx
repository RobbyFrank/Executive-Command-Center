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
import { Trash2, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Max width cap for long labels; menus use `w-max` so typical short menus stay tight. */
const MENU_MAX_W = 320;
const MARGIN = 8;

/** Which hierarchy row opened the menu — used for the panel header unless `title` overrides. */
export type ContextMenuScope = "company" | "goal" | "project" | "milestone";

const DEFAULT_TITLE_BY_SCOPE: Record<ContextMenuScope, string> = {
  company: "Company context menu",
  goal: "Goal context menu",
  project: "Project context menu",
  milestone: "Milestone context menu",
};

export type ContextMenuItemDef = {
  type: "item";
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () =>
    | void
    | Promise<void>
    | { error: string | null }
    | Promise<{ error: string | null }>;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** When set, choosing this item shows an inline confirm step before running `onClick`. */
  confirmMessage?: string;
  /** Label for the confirm step primary button (default: Delete). */
  confirmButtonLabel?: string;
};

export type ContextMenuDividerDef = { type: "divider"; id: string };

export type ContextMenuEntry = ContextMenuItemDef | ContextMenuDividerDef;

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  /** Accessible label for the menu (e.g. "Company actions") */
  ariaLabel: string;
  entries: ContextMenuEntry[];
  /** Which Roadmap layer opened this menu — sets the default header copy. */
  scope: ContextMenuScope;
  /** Optional override for the header (defaults to `{Company|Goal|Project|Milestone} context menu`). */
  title?: string;
}

export function ContextMenu({
  open,
  x,
  y,
  onClose,
  ariaLabel,
  entries,
  scope,
  title: titleProp,
}: ContextMenuProps) {
  const headerTitle = titleProp ?? DEFAULT_TITLE_BY_SCOPE[scope];
  const [mounted, setMounted] = useState(false);
  const menuId = useId();
  const titleId = useId();
  const [box, setBox] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [confirmItem, setConfirmItem] = useState<ContextMenuItemDef | null>(
    null
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setConfirmItem(null);
      setError(null);
      setPending(false);
    }
  }, [open]);

  const updatePosition = useCallback(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const vw =
      typeof window !== "undefined" ? window.innerWidth : 800;
    const vh =
      typeof window !== "undefined" ? window.innerHeight : 600;
    /** Assume worst-case width so the first paint stays on-screen before we measure `w-max`. */
    const assumedW = Math.min(MENU_MAX_W, vw - MARGIN * 2);
    let left = x;
    let top = y;
    if (left + assumedW + MARGIN > vw) {
      left = Math.max(MARGIN, vw - assumedW - MARGIN);
    } else {
      left = Math.max(MARGIN, left);
    }
    const estHeight = Math.min(480, vh - MARGIN * 2);
    if (top + estHeight + MARGIN > vh) {
      top = Math.max(MARGIN, vh - estHeight - MARGIN);
    } else {
      top = Math.max(MARGIN, top);
    }
    const maxHeight = Math.min(
      Math.floor(vh - top - MARGIN),
      Math.floor(vh * 0.85)
    );
    setBox({ top, left, maxHeight });
  }, [open, x, y]);

  /** After shrink-wrapped width is known, nudge `left` so the menu doesn’t overflow the viewport. */
  const clampMenuToViewport = useCallback(() => {
    const el = menuPanelRef.current;
    if (!el || typeof window === "undefined") return;
    const vw = window.innerWidth;
    const rect = el.getBoundingClientRect();
    setBox((prev) => {
      if (!prev) return prev;
      let left = prev.left;
      if (rect.right > vw - MARGIN) {
        left = Math.max(MARGIN, vw - rect.width - MARGIN);
      } else if (rect.left < MARGIN) {
        left = MARGIN;
      }
      return left === prev.left ? prev : { ...prev, left };
    });
  }, []);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useLayoutEffect(() => {
    if (!open || !box) return;
    clampMenuToViewport();
  }, [open, box, entries, confirmItem, clampMenuToViewport]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmItem) {
          setConfirmItem(null);
          setError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, confirmItem]);

  async function runItem(item: ContextMenuItemDef) {
    if (item.disabled) return;
    setError(null);
    setPending(true);
    try {
      const result = await Promise.resolve(item.onClick());
      if (
        result &&
        typeof result === "object" &&
        "error" in result &&
        (result as { error: string | null }).error
      ) {
        setError((result as { error: string }).error);
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function onItemActivate(item: ContextMenuItemDef) {
    if (item.disabled) return;
    if (item.confirmMessage) {
      setConfirmItem(item);
      setError(null);
      return;
    }
    void runItem(item);
  }

  const portal =
    mounted &&
    open &&
    typeof document !== "undefined" &&
    box &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[200]"
          aria-hidden
          onClick={() => onClose()}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />
        <div
          ref={menuPanelRef}
          id={menuId}
          aria-labelledby={titleId}
          className="fixed z-[210] flex w-max min-w-0 max-w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-lg"
          style={{
            top: box.top,
            left: box.left,
            maxHeight: box.maxHeight,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-zinc-800 bg-zinc-900/95 px-2.5 py-2">
            <p
              id={titleId}
              className="min-w-0 flex-1 break-words pr-1 text-[11px] font-medium leading-snug text-zinc-400"
            >
              {headerTitle}
            </p>
            <button
              type="button"
              aria-label="Close menu"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/90 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          {confirmItem ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
              <p className="mb-2 text-xs leading-snug text-zinc-300">
                {confirmItem.confirmMessage}
              </p>
              {error && (
                <p className="mb-2 text-xs leading-snug text-amber-500/95">
                  {error}
                </p>
              )}
              <div className="mt-auto flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmItem(null);
                    setError(null);
                  }}
                  className="cursor-pointer px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void runItem(confirmItem)}
                  className="cursor-pointer rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending
                    ? "…"
                    : confirmItem.confirmButtonLabel ?? "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <div
              role="menu"
              aria-label={ariaLabel}
              className="min-h-0 flex-1 overflow-y-auto py-1"
            >
              {error && (
                <p className="mx-2 mb-1 text-xs leading-snug text-amber-500/95">
                  {error}
                </p>
              )}
              {entries.map((entry) => {
                if (entry.type === "divider") {
                  return (
                    <div
                      key={entry.id}
                      className="mx-2 my-1 border-t border-zinc-800"
                      role="separator"
                    />
                  );
                }
                const Icon = entry.icon;
                const disabled = entry.disabled ?? false;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    disabled={disabled || pending}
                    title={
                      disabled && entry.disabledReason
                        ? entry.disabledReason
                        : undefined
                    }
                    onClick={() => onItemActivate(entry)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                      entry.destructive
                        ? "text-red-400/95 hover:bg-zinc-800/80"
                        : "text-zinc-200 hover:bg-zinc-800/60",
                      (disabled || pending) &&
                        "cursor-not-allowed opacity-50 hover:bg-transparent"
                    )}
                  >
                    {Icon ? (
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 opacity-90",
                          entry.destructive && "text-red-400/90"
                        )}
                        aria-hidden
                      />
                    ) : entry.destructive ? (
                      <Trash2
                        className="h-3.5 w-3.5 shrink-0 text-red-400/90 opacity-90"
                        aria-hidden
                      />
                    ) : null}
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </>,
      document.body
    );

  return portal;
}
