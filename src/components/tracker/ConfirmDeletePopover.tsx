"use client";

import { useState } from "react";
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

export function ConfirmDeletePopover({
  entityName,
  disabled = false,
  disabledReason,
  onConfirm,
}: ConfirmDeletePopoverProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
    setPending(false);
  }

  return (
    <div className="relative">
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
            ? "text-zinc-600 opacity-40 cursor-not-allowed"
            : "text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
        }`}
        title={
          disabled
            ? (disabledReason ?? "Cannot delete")
            : "Delete"
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => close()}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded-md p-3 shadow-lg w-72 max-w-[calc(100vw-2rem)]">
            <p className="text-xs text-zinc-300 mb-2">
              Delete {entityName}? This can&apos;t be undone.
            </p>
            {error && (
              <p className="text-xs text-amber-500/95 mb-2 leading-snug">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end">
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
                className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-60"
              >
                {pending ? "…" : "Delete"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
