"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useCompanySectionOverlayOptional } from "./company-section-overlay-context";

const CLOSE_DELAY_MS = 200;

export type CellHoverTooltipHandle = {
  /** Opens the floating panel in edit mode (e.g. cell click when value may be empty or not truncated). */
  openInEditMode: () => void;
};

export type CellHoverTooltipEditExtrasContext = {
  draft: string;
  setDraft: (value: string) => void;
  /**
   * While a nested dialog is open, textarea blur must not commit (e.g. URL picker modal).
   * Call the returned cleanup when the dialog closes.
   */
  suspendBlurCommit: () => () => void;
};

type CellHoverTooltipProps = {
  /** Full text (committed value). */
  label: string;
  onSave: (value: string) => void;
  children: ReactNode;
  placeholder?: string;
  /** Extra controls below the textarea in edit mode (e.g. generate from websites). */
  editExtras?: (ctx: CellHoverTooltipEditExtrasContext) => ReactNode;
  /**
   * When true, hovering opens the readonly panel whenever `label` is non-empty,
   * even if the visible text is not overflowing (e.g. character-capped preview).
   */
  alwaysHoverReadonly?: boolean;
  /** Merged into the one-line trigger `span` (e.g. group-hover for subdued previews). */
  triggerClassName?: string;
  /**
   * When true, the one-line trigger hugs text width (up to the cell max) instead of stretching full
   * cell width — use for roadmap milestone names so short titles don’t create a row-wide hit area.
   */
  shrinkTriggerWidth?: boolean;
};

/**
 * Truncated-cell preview: hover shows a floating panel; move pointer onto the panel to keep it open.
 * Click the panel to edit in-place with a multiline textarea (Enter / Shift+Enter = new line).
 */
export const CellHoverTooltip = forwardRef<
  CellHoverTooltipHandle,
  CellHoverTooltipProps
>(function CellHoverTooltip(
  {
    label,
    onSave,
    children,
    placeholder,
    editExtras,
    alwaysHoverReadonly = false,
    triggerClassName,
    shrinkTriggerWidth = false,
  },
  ref
) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef(false);
  const skipCommitOnBlurRef = useRef(false);
  const blurCommitSuspendCountRef = useRef(0);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(
    null
  );

  const { incrementOverlay, decrementOverlay } =
    useCompanySectionOverlayOptional() ?? {};

  editingRef.current = editing;

  useEffect(() => {
    if (!panelOpen || !incrementOverlay || !decrementOverlay) return;
    incrementOverlay();
    return () => decrementOverlay();
  }, [panelOpen, incrementOverlay, decrementOverlay]);

  useEffect(() => {
    setDraft(label);
  }, [label]);

  const refreshPlacement = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 6;
    const maxW = 448;
    let left = r.left;
    const top = r.bottom + margin;
    if (left + maxW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - maxW);
    }
    setPlacement({ top, left });
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (editingRef.current) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setPanelOpen(false);
      setEditing(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const cancelClose = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  const openPanelReadonly = useCallback(() => {
    cancelClose();
    refreshPlacement();
    setEditing(false);
    setDraft(label);
    setPanelOpen(true);
  }, [cancelClose, refreshPlacement, label]);

  const closePanel = useCallback(() => {
    clearCloseTimer();
    setPanelOpen(false);
    setEditing(false);
    setDraft(label);
  }, [label, clearCloseTimer]);

  const commit = useCallback(() => {
    skipCommitOnBlurRef.current = true;
    const next = draft;
    setEditing(false);
    if (next !== label) {
      onSave(next);
    }
    closePanel();
    queueMicrotask(() => {
      skipCommitOnBlurRef.current = false;
    });
  }, [draft, label, onSave, closePanel]);

  const cancelEdit = useCallback(() => {
    skipCommitOnBlurRef.current = true;
    setDraft(label);
    setEditing(false);
    closePanel();
    queueMicrotask(() => {
      skipCommitOnBlurRef.current = false;
    });
  }, [label, closePanel]);

  const suspendBlurCommit = useCallback(() => {
    blurCommitSuspendCountRef.current += 1;
    return () => {
      blurCommitSuspendCountRef.current -= 1;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      openInEditMode: () => {
        cancelClose();
        setDraft(label);
        setEditing(true);
        refreshPlacement();
        setPanelOpen(true);
        queueMicrotask(() => {
          textareaRef.current?.focus();
          textareaRef.current?.select();
        });
      },
    }),
    [label, cancelClose, refreshPlacement]
  );

  useLayoutEffect(() => {
    if (!panelOpen) return;
    refreshPlacement();
  }, [panelOpen, refreshPlacement, editing]);

  useEffect(() => {
    if (!panelOpen || editing) return;
    const onScroll = () => closePanel();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [panelOpen, editing, closePanel]);

  useEffect(() => {
    if (!panelOpen) return;
    const onResize = () => refreshPlacement();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panelOpen, refreshPlacement]);

  const handleTriggerMouseEnter = () => {
    if (!label.trim()) return;
    const el = triggerRef.current;
    if (!el) return;
    if (!alwaysHoverReadonly && el.scrollWidth <= el.clientWidth) return;
    openPanelReadonly();
  };

  const handleTriggerMouseLeave = () => {
    scheduleClose();
  };

  const startEditFromPanel = () => {
    cancelClose();
    setDraft(label);
    setEditing(true);
    queueMicrotask(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };

  const handleTextareaBlur = () => {
    if (skipCommitOnBlurRef.current) return;
    if (blurCommitSuspendCountRef.current > 0) return;
    commit();
  };

  const showDimmedTrigger = panelOpen && !editing;

  return (
    <>
      <span
        ref={triggerRef}
        className={cn(
          "min-w-0 truncate text-left transition-[opacity,color] duration-150 ease-out",
          shrinkTriggerWidth
            ? "inline-block w-max max-w-full"
            : "block w-full",
          triggerClassName,
          showDimmedTrigger && "text-zinc-500 opacity-40"
        )}
        onMouseEnter={handleTriggerMouseEnter}
        onMouseLeave={handleTriggerMouseLeave}
      >
        {children}
      </span>
      {panelOpen &&
        placement &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role={editing ? "dialog" : "tooltip"}
            className={cn(
              "fixed z-[200] max-w-lg rounded-md border border-zinc-600/90 bg-zinc-900 shadow-xl",
              editing
                ? "pointer-events-auto w-[min(32rem,calc(100vw-1rem))] p-0"
                : "pointer-events-auto max-h-[min(40vh,20rem)] max-w-lg cursor-text overflow-y-auto px-3 py-2.5"
            )}
            style={{ top: placement.top, left: placement.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={() => {
              if (!editingRef.current) scheduleClose();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {editing ? (
              <div className="flex flex-col gap-1.5 p-3">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={handleTextareaBlur}
                  onKeyDown={handlePanelKeyDown}
                  placeholder={placeholder}
                  rows={6}
                  className={cn(
                    "min-h-[8rem] w-full resize-y rounded-md border border-zinc-600 bg-zinc-950 px-2.5 py-2",
                    "text-base leading-relaxed text-zinc-100 placeholder:text-zinc-600",
                    "focus:outline-none focus:ring-2 focus:ring-emerald-600/80"
                  )}
                  aria-label={placeholder ?? "Edit value"}
                />
                {editExtras ? (
                  <div className="shrink-0">
                    {editExtras({
                      draft,
                      setDraft,
                      suspendBlurCommit,
                    })}
                  </div>
                ) : null}
                <p className="pointer-events-none text-[11px] text-zinc-500">
                  Enter / Shift+Enter: new line · Blur or Ctrl+Enter: save · Esc: cancel
                </p>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                className="w-full cursor-text text-left text-base leading-relaxed text-zinc-100 outline-none hover:bg-zinc-800/40 rounded-sm"
                onClick={startEditFromPanel}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    startEditFromPanel();
                  }
                }}
              >
                <span className="whitespace-pre-wrap break-words">{label}</span>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
});

CellHoverTooltip.displayName = "CellHoverTooltip";
