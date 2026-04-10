"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

type DeleteResult = { error: string | null };

interface ConfirmDeletePopoverProps {
  entityName: string;
  /** When true, delete is blocked and the control is non-interactive. */
  disabled?: boolean;
  /** Shown as the button tooltip when `disabled` is true. */
  disabledReason?: string;
  /**
   * Server actions should return `{ error: string | null }` so messages show
   * reliably; void / Promise<void> is still supported (e.g. tests).
   */
  onConfirm: () =>
    | void
    | Promise<void>
    | DeleteResult
    | Promise<DeleteResult>;
}

const PANEL_MAX_W = 288;

export function ConfirmDeletePopover({
  entityName,
  disabled = false,
  disabledReason,
  onConfirm,
}: ConfirmDeletePopoverProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [panelBox, setPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePanelPosition = useCallback(() => {
    if (!open || !anchorRef.current) {
      setPanelBox(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const width = Math.min(PANEL_MAX_W, vw - margin * 2);
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    const top = rect.bottom + 4;
    setPanelBox({ top, left, width });
  }, [open]);

  useLayoutEffect(() => {
    updatePanelPosition();
  }, [updatePanelPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  function close() {
    setOpen(false);
    setError(null);
    setPending(false);
    setPanelBox(null);
  }

  const overlay =
    mounted && open ? (
      <>
        <div
          className="fixed inset-0 z-[100]"
          aria-hidden
          onClick={() => close()}
        />
        {panelBox ? (
          <div
            className="fixed z-[110] max-h-[min(80vh,calc(100vh-2rem))] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 shadow-lg"
            style={{
              top: panelBox.top,
              left: panelBox.left,
              width: panelBox.width,
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-heading"
          >
            <p
              id="confirm-delete-heading"
              className="mb-2 text-xs text-zinc-300"
            >
              Delete {entityName}? This can&apos;t be undone.
            </p>
            {error && (
              <p className="mb-2 text-xs leading-snug text-amber-500/95">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close()}
                disabled={pending}
                className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setError(null);
                  setPending(true);
                  try {
                    const result = await Promise.resolve(onConfirm());
                    if (
                      result &&
                      typeof result === "object" &&
                      "error" in result &&
                      result.error
                    ) {
                      setError(result.error);
                      return;
                    }
                    close();
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Something went wrong."
                    );
                  } finally {
                    setPending(false);
                  }
                }}
                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-60"
              >
                {pending ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ) : null}
      </>
    ) : null;

  return (
    <div className="relative" ref={anchorRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
          setError(null);
        }}
        className={`p-1 transition-colors ${
          disabled
            ? "cursor-not-allowed text-zinc-600 opacity-40"
            : "text-zinc-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
        }`}
        title={
          disabled ? (disabledReason ?? "Cannot delete") : "Delete"
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}
