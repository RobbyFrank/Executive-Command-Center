"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MENU_MIN_W = 200;
const MENU_MAX_W = 320;
const MARGIN = 8;

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
}

export function ContextMenu({
  open,
  x,
  y,
  onClose,
  ariaLabel,
  entries,
}: ContextMenuProps) {
  const [mounted, setMounted] = useState(false);
  const menuId = useId();
  const [box, setBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
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
    const width = Math.min(
      MENU_MAX_W,
      Math.max(MENU_MIN_W, vw - MARGIN * 2)
    );
    let left = x;
    let top = y;
    if (left + width + MARGIN > vw) {
      left = Math.max(MARGIN, vw - width - MARGIN);
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
    setBox({ top, left, width, maxHeight });
  }, [open, x, y]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

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
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="fixed z-[210] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-lg"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            maxHeight: box.maxHeight,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {confirmItem ? (
            <div className="flex max-h-[min(80vh,480px)] flex-col overflow-y-auto p-3">
              <p className="mb-2 text-xs leading-snug text-zinc-300">
                {confirmItem.confirmMessage}
              </p>
              {error && (
                <p className="mb-2 text-xs leading-snug text-amber-500/95">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
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
            <div className="max-h-[inherit] overflow-y-auto py-1">
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
