"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown, Pencil } from "lucide-react";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
} from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";
import { isValidHttpUrl } from "@/lib/httpUrl";
import {
  CellHoverTooltip,
  type CellHoverTooltipEditExtrasContext,
  type CellHoverTooltipHandle,
} from "./CellHoverTooltip";

/** Split after the last space so the final word can stay on one line with a trailing inline control. */
function splitHeadAndLastWord(text: string): { head: string; last: string } {
  const t = text.trimEnd();
  if (t.length === 0) return { head: "", last: "" };
  const i = t.lastIndexOf(" ");
  if (i === -1) return { head: "", last: t };
  return { head: t.slice(0, i + 1), last: t.slice(i + 1) };
}

interface InlineEditCellProps {
  value: string;
  onSave: (value: string) => void;
  type?: "text" | "textarea" | "select" | "number" | "date";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number | string;
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  emptyLabel?: ReactNode;
  /** When set, used for the collapsed (non-editing) display instead of raw `value`. */
  formatDisplay?: (value: string) => ReactNode;
  /** Extra classes for the collapsed control (e.g. compact icon trigger). */
  collapsedButtonClassName?: string;
  /** Optional title on the collapsed control (e.g. owner name when showing only a photo). */
  displayTitle?: string;
  /**
   * `plain` — collapsed state looks like body text (no box); hover reveals edit affordance.
   * Use for secondary fields that should blend into a row until interaction.
   */
  variant?: "default" | "plain";
  /**
   * When true and the value is a valid http(s) URL, collapsed state opens the link in a new tab.
   * A compact edit control appears beside it to change or clear the value.
   */
  linkBehavior?: boolean;
  /**
   * With `linkBehavior` + valid URL + `formatDisplay`, omit the trailing edit button so the parent
   * can place it (e.g. fixed grid column on milestone Slack).
   */
  linkBehaviorHideTrailingEdit?: boolean;
  /** Called when the cell enters or leaves edit mode (e.g. to widen a narrow column while editing). */
  onEditingChange?: (editing: boolean) => void;
  /**
   * When `type` is `select`, `always` shows the control at rest so one click opens the menu
   * (custom list when `formatDisplay` is set; otherwise native `<select>`).
   * `toggle` uses a collapsed label and needs a second click to reveal the select.
   */
  selectPresentation?: "toggle" | "always";
  /**
   * Collapsed display: single-line ellipsis in the cell; full text in a hover tooltip
   * when truncated. Only applies to default variant text/date cells (not select/link).
   */
  displayTruncateSingleLine?: boolean;
  /** Tooltip body when `displayTruncateSingleLine`; defaults to raw `value`. */
  tooltipLabel?: string;
  /** Extra controls in the floating edit panel (Companies description: generate from websites). */
  truncateTooltipEditExtras?: (
    ctx: CellHoverTooltipEditExtrasContext
  ) => ReactNode;
  /** When true, hover always opens the readonly panel when label is non-empty (e.g. character-capped preview). */
  truncateTooltipAlwaysHover?: boolean;
  /**
   * With `displayTruncateSingleLine`: wrap trigger in `group/trigger` and brighten one-line preview on hover
   * before the floating panel opens (Roadmap long-text fields).
   */
  truncateSubduedPreview?: boolean;
  /**
   * When set, `draft` is checked before save. Return an error message to block commit and keep editing.
   */
  validate?: (draft: string) => string | undefined;
  /**
   * When true on first mount, the cell opens in edit mode (focused input). Ignored after mount so the
   * parent can keep passing true without forcing edit mode again after the user finishes.
   */
  startInEditMode?: boolean;
  /**
   * Increment from the parent (e.g. `setState((n) => n + 1)`) to open edit mode after mount — used for
   * context-menu **Rename**. The initial value establishes a baseline without opening.
   */
  openEditNonce?: number;
  /**
   * Roadmap goal/project grid: omit default resting left padding so values line up with sticky column headers.
   */
  trackerGridAlign?: boolean;
  /** When `type` is `date` and the value is empty, draw attention (Roadmap due date). */
  emphasizeEmpty?: boolean;
  /** When `type` is `date`, minimum allowed `YYYY-MM-DD` (native `min` — inclusive). */
  dateMin?: string;
  /**
   * Overlay `select` (`formatDisplay` + custom list menu): skip the default hover grey wash
   * so text-only cells (e.g. project Status) stay borderless until `group-hover` on the wrapper.
   */
  overlaySelectQuiet?: boolean;
  /**
   * Rendered inline immediately after the collapsed value (same line as the text when it fits).
   * Use for a trailing control (e.g. roadmap goal/project name + info icon). Incompatible with
   * `displayTruncateSingleLine` (suffix is ignored when the truncate tooltip path is used).
   */
  collapsedSuffix?: ReactNode;
}

export function InlineEditCell({
  value,
  onSave,
  type = "text",
  options,
  min,
  max,
  step,
  placeholder,
  className,
  displayClassName,
  emptyLabel,
  formatDisplay,
  displayTitle,
  collapsedButtonClassName,
  variant = "default",
  linkBehavior = false,
  linkBehaviorHideTrailingEdit = false,
  onEditingChange,
  selectPresentation = "always",
  displayTruncateSingleLine = false,
  tooltipLabel,
  truncateTooltipEditExtras,
  truncateTooltipAlwaysHover = false,
  truncateSubduedPreview = false,
  validate,
  startInEditMode = false,
  openEditNonce,
  trackerGridAlign = false,
  emphasizeEmpty = false,
  dateMin,
  overlaySelectQuiet = false,
  collapsedSuffix,
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(() => Boolean(startInEditMode));
  const [draft, setDraft] = useState(value);
  const [validationError, setValidationError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const lastOpenEditNonce = useRef<number | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const truncateTooltipRef = useRef<CellHoverTooltipHandle>(null);
  const validationHintId = `${useId()}-validation`;
  const dateFieldId = useId();
  const overlaySelectListboxId = useId();
  const [overlaySelectOpen, setOverlaySelectOpen] = useState(false);
  const overlaySelectContainerRef = useRef<HTMLDivElement>(null);
  const resolvedEmptyLabel = emptyLabel ?? (type === "date" ? "Set date" : "—");

  const cellPadX = trackerGridAlign ? "pl-0 pr-1.5" : "px-1.5";
  const selectPadX = trackerGridAlign ? "pl-0 pr-7" : "pl-1.5 pr-7";

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => {
    setDraft(value);
    setValidationError(undefined);
  }, [value]);

  useEffect(() => {
    setOverlaySelectOpen(false);
  }, [value]);

  useEffect(() => {
    if (!overlaySelectOpen) return;
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
      const el = overlaySelectContainerRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOverlaySelectOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOverlaySelectOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overlaySelectOpen]);

  useEffect(() => {
    if (openEditNonce === undefined) return;
    if (lastOpenEditNonce.current === null) {
      lastOpenEditNonce.current = openEditNonce;
      return;
    }
    if (openEditNonce !== lastOpenEditNonce.current) {
      lastOpenEditNonce.current = openEditNonce;
      setEditing(true);
    }
  }, [openEditNonce]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  useEffect(() => {
    if (validationError && editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [validationError, editing]);

  const commit = useCallback(() => {
    const err = validate?.(draft);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(undefined);
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  }, [draft, value, onSave, validate]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
    setValidationError(undefined);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && type !== "textarea") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
    [commit, cancel, type]
  );

  const openNativeDatePicker = useCallback(() => {
    const el = dateInputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
      if (typeof el.showPicker === "function") {
        void el.showPicker();
      } else {
        el.click();
      }
    } catch {
      try {
        el.click();
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** Always-visible select with custom visible label (e.g. owner photo) — invisible native select on top for one-click open. */
  const overlaySelect =
    type === "select" &&
    options &&
    options.length > 0 &&
    selectPresentation === "always" &&
    formatDisplay;

  /** Native always-visible select when the value is shown as plain option text. */
  const inlineSelect =
    type === "select" &&
    options &&
    options.length > 0 &&
    selectPresentation === "always" &&
    !formatDisplay;

  if (overlaySelect) {
    const listLabel = displayTitle ?? "Choose an option";
    return (
      <div
        ref={overlaySelectContainerRef}
        className={cn("relative isolate w-full min-w-0", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          id={`${overlaySelectListboxId}-trigger`}
          aria-haspopup="listbox"
          aria-expanded={overlaySelectOpen}
          aria-controls={overlaySelectListboxId}
          onClick={() => setOverlaySelectOpen((o) => !o)}
          title={listLabel}
          aria-label={listLabel}
          className={cn(
            "peer relative z-[1] flex min-h-8 w-full max-w-full cursor-pointer items-center rounded py-0.5 text-left text-sm transition-colors",
            selectPadX,
            "pr-7",
            !value.trim() && "text-zinc-600 italic",
            value.trim() && displayClassName,
            overlaySelectQuiet
              ? "border border-transparent bg-transparent hover:bg-transparent"
              : "border border-transparent bg-transparent hover:bg-zinc-800",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-600",
            overlaySelectOpen && "ring-1 ring-blue-600"
          )}
        >
          {value.trim() ? formatDisplay!(value) : resolvedEmptyLabel}
        </button>
        {overlaySelectOpen ? (
          <div
            id={overlaySelectListboxId}
            role="listbox"
            aria-labelledby={`${overlaySelectListboxId}-trigger`}
            className="absolute left-0 top-full z-[60] mt-0.5 w-full min-w-[max(100%,10rem)] overflow-hidden rounded-md border border-zinc-600/70 bg-zinc-950 py-1 shadow-xl shadow-black/50 ring-1 ring-zinc-800/90"
          >
            {options!.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value === "" ? "__empty" : opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full min-w-0 cursor-pointer items-center px-1.5 py-1 text-left text-sm transition-colors",
                    "hover:bg-zinc-800/95 focus:bg-zinc-800/95 focus:outline-none",
                    selected && "bg-zinc-800/60"
                  )}
                  onClick={() => {
                    setOverlaySelectOpen(false);
                    if (opt.value !== value) onSave(opt.value);
                  }}
                >
                  {formatDisplay!(opt.value)}
                </button>
              );
            })}
          </div>
        ) : null}
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-1 top-1/2 z-[2] h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 transition-opacity",
            overlaySelectQuiet
              ? cn(
                  "opacity-0 group-hover/status:opacity-100 peer-focus-visible:opacity-100",
                  overlaySelectOpen && "opacity-100"
                )
              : cn(
                  "opacity-0 peer-hover:opacity-100 peer-focus-visible:opacity-100",
                  overlaySelectOpen && "opacity-100"
                )
          )}
          aria-hidden
        />
      </div>
    );
  }

  if (inlineSelect) {
    return (
      <div className="relative w-full min-w-0">
        <select
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (next !== value) onSave(next);
          }}
          className={cn(
            "peer w-full min-h-[28px] max-w-full py-0.5 rounded text-sm cursor-pointer text-left",
            selectPadX,
            "appearance-none border-0 bg-transparent shadow-none",
            "transition-colors",
            "hover:bg-zinc-800",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-600",
            value.trim() ? displayClassName : "text-zinc-600 italic",
            className
          )}
          title={displayTitle ?? "Choose an option"}
          aria-label={displayTitle ?? "Choose an option"}
        >
          {options.map((opt) => (
            <option key={opt.value === "" ? "__empty" : opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 opacity-0 transition-opacity peer-hover:opacity-100 peer-focus-visible:opacity-100"
          aria-hidden
        />
      </div>
    );
  }

  /**
   * Visible button + visually hidden `input[type=date]`. Opening the picker via `showPicker()`
   * from the click handler keeps a real user gesture (fully transparent overlays often do not
   * receive hits reliably on Chromium).
   */
  if (type === "date") {
    const emptyAttention =
      emphasizeEmpty && !value.trim() && variant !== "plain";
    const dateHint = value.trim()
      ? `${formatCalendarDateHint(value)} — choose date`
      : dateMin
        ? `Set due date — on or after ${dateMin}`
        : "Set date — choose date";
    const buttonClass =
      variant === "plain"
        ? cn(
            "inline-flex w-full max-w-full min-w-0 min-h-[28px] items-center text-left text-sm leading-normal",
            "rounded-sm border-0 bg-transparent p-0 m-0 shadow-none ring-0",
            "cursor-pointer transition-colors",
            "hover:bg-zinc-800/50 hover:px-1.5 hover:py-0.5 hover:-mx-1.5",
            "focus-visible:outline-none focus-visible:bg-zinc-800/45 focus-visible:px-1.5 focus-visible:py-0.5 focus-visible:-mx-1.5 focus-visible:ring-1 focus-visible:ring-zinc-500/35",
            !value.trim() && "text-zinc-500 italic",
            value.trim() && displayClassName
          )
        : cn(
            "flex min-h-[28px] w-full max-w-full items-center rounded py-0.5 text-left text-sm",
            cellPadX,
            "border-0 bg-transparent transition-colors cursor-pointer",
            "hover:bg-zinc-800",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600",
            !value.trim() && !emptyAttention && "text-zinc-600 italic",
            emptyAttention &&
              "rounded-md border border-amber-500/45 bg-amber-950/40 font-medium not-italic text-amber-100 shadow-sm ring-1 ring-amber-500/25 hover:bg-amber-950/55",
            emptyAttention && trackerGridAlign && "pl-1.5",
            value.trim() && displayClassName
          );

    return (
      <div className={cn("relative w-full min-w-0", className)}>
        <input
          id={dateFieldId}
          ref={dateInputRef}
          type="date"
          value={value}
          min={dateMin || undefined}
          onChange={(e) => {
            const next = e.target.value;
            if (next === value) return;
            if (dateMin && next && next < dateMin) {
              return;
            }
            onSave(next);
          }}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <button
          type="button"
          className={buttonClass}
          title={typeof displayTitle === "string" ? displayTitle : dateHint}
          aria-label={dateHint}
          onClick={(e) => {
            e.stopPropagation();
            openNativeDatePicker();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              openNativeDatePicker();
            }
          }}
        >
          {value.trim()
            ? formatDisplay
              ? formatDisplay(value)
              : formatRelativeCalendarDate(value)
            : resolvedEmptyLabel}
        </button>
      </div>
    );
  }

  if (!editing) {
    const collapsedTitle = displayTitle ?? "Click to edit";

    const collapsedLayout =
      variant === "plain"
        ? cn(
            // Inline text: no full-width “field”, no resting border/padding — edit affordance on hover only.
            "inline-block w-max max-w-full min-w-0 text-left align-baseline text-sm leading-normal",
            "p-0 m-0 border-0 bg-transparent shadow-none ring-0",
            "rounded-sm cursor-default transition-colors",
            "hover:bg-zinc-800/50 hover:px-1.5 hover:py-0.5 hover:-mx-1.5 hover:cursor-text",
            "focus-visible:outline-none focus-visible:bg-zinc-800/45 focus-visible:px-1.5 focus-visible:py-0.5 focus-visible:-mx-1.5 focus-visible:cursor-text focus-visible:ring-1 focus-visible:ring-zinc-500/35"
          )
        : cn(
            "text-left w-full py-0.5 rounded hover:bg-zinc-800 transition-colors min-h-[28px] text-sm cursor-pointer",
            cellPadX
          );

    const trimmed = value.trim();
    if (linkBehavior && trimmed && isValidHttpUrl(trimmed)) {
      const iconOnlyLink = Boolean(formatDisplay);
      return (
        <span
          className={cn(
            "inline-flex items-center min-w-0",
            linkBehaviorHideTrailingEdit ? "gap-0" : "gap-0.5 group/urlicon"
          )}
        >
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              collapsedLayout,
              displayClassName,
              collapsedButtonClassName,
              "inline-flex items-center no-underline text-inherit",
              iconOnlyLink
                ? "h-7 w-7 shrink-0 justify-center !border-0 !p-0 !shadow-none !ring-0 min-w-0 bg-transparent hover:bg-zinc-800/80"
                : "min-w-0 justify-start gap-1"
            )}
            title={trimmed}
            onClick={(e) => e.stopPropagation()}
          >
            {formatDisplay ? formatDisplay(trimmed) : trimmed}
          </a>
          {linkBehaviorHideTrailingEdit ? null : (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEditing(true);
              }}
              className={cn(
                "inline-flex h-7 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:text-zinc-300 transition-opacity",
                "opacity-0 group-hover/urlicon:opacity-100 focus-visible:opacity-100",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/35"
              )}
              title="Edit or remove link"
              aria-label="Edit or remove link"
            >
              <Pencil className="h-3 w-3" strokeWidth={1.75} />
            </button>
          )}
        </span>
      );
    }

    const collapsedInner =
      type === "select" && options
        ? !value
          ? resolvedEmptyLabel
          : formatDisplay
            ? formatDisplay(value)
            : ((options.find((o) => o.value === value)?.label ?? value) ||
              resolvedEmptyLabel)
        : formatDisplay
          ? value
            ? formatDisplay(value)
            : resolvedEmptyLabel
          : value || resolvedEmptyLabel;

    const useTruncateTooltip =
      displayTruncateSingleLine &&
      variant === "default" &&
      type !== "select" &&
      !linkBehavior;

    const tooltipSource = tooltipLabel ?? value;

    const collapsedClassName = cn(
      collapsedLayout,
      useTruncateTooltip && "min-w-0 w-full",
      !value &&
        (variant === "plain"
          ? "text-zinc-500 italic"
          : "text-zinc-600 italic"),
      displayClassName,
      collapsedButtonClassName
    );

    if (useTruncateTooltip) {
      return (
        <div
          role="button"
          tabIndex={0}
          className={cn(
            collapsedClassName,
            truncateSubduedPreview && "group/trigger"
          )}
          title={undefined}
          aria-label={collapsedTitle}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            truncateTooltipRef.current?.openInEditMode();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              truncateTooltipRef.current?.openInEditMode();
            }
          }}
        >
          <CellHoverTooltip
            ref={truncateTooltipRef}
            label={tooltipSource}
            onSave={onSave}
            placeholder={placeholder}
            editExtras={truncateTooltipEditExtras}
            alwaysHoverReadonly={truncateTooltipAlwaysHover}
            triggerClassName={
              truncateSubduedPreview
                ? "transition-colors group-hover/trigger:text-zinc-200"
                : undefined
            }
          >
            {collapsedInner}
          </CellHoverTooltip>
        </div>
      );
    }

    /** Inline trailing control (e.g. info icon) — last word + icon wrapped in nowrap so they never orphan apart. */
    if (collapsedSuffix != null && !useTruncateTooltip) {
      const titleGroupClass = cn(
        variant === "plain"
          ? cn(
              "inline-block max-w-full min-w-0 break-words rounded-sm border-0 bg-transparent p-0 m-0 shadow-none ring-0",
              "cursor-pointer text-left text-sm leading-normal transition-colors outline-none",
              "hover:bg-zinc-800/50 hover:px-1.5 hover:py-0.5 hover:-mx-1.5",
              "focus-visible:bg-zinc-800/45 focus-visible:px-1.5 focus-visible:py-0.5 focus-visible:-mx-1.5 focus-visible:ring-1 focus-visible:ring-zinc-500/35"
            )
          : cn(
              "inline-block max-w-full min-w-0 break-words rounded py-0.5 text-left text-sm cursor-pointer transition-colors outline-none",
              cellPadX,
              "hover:bg-zinc-800 focus-visible:ring-1 focus-visible:ring-blue-600"
            ),
        !value &&
          (variant === "plain"
            ? "text-zinc-500 italic"
            : "text-zinc-600 italic"),
        displayClassName,
        collapsedButtonClassName
      );

      const openEditFromGroup = (
        e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>
      ) => {
        if ((e.target as HTMLElement).closest("[data-ai-context-trigger]")) return;
        if ("key" in e && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
        }
        e.stopPropagation();
        setEditing(true);
      };

      const canSplitLastWord = !formatDisplay && value.trim().length > 0;
      const { head, last } = canSplitLastWord
        ? splitHeadAndLastWord(value)
        : { head: "", last: "" };

      return (
        <div
          className={cn(
            "w-full min-w-0 min-h-[28px] py-0.5 text-sm leading-normal",
            className
          )}
        >
          <div
            tabIndex={0}
            role="group"
            title={typeof displayTitle === "string" ? displayTitle : undefined}
            aria-label={collapsedTitle}
            className={titleGroupClass}
            onClick={(e) => openEditFromGroup(e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openEditFromGroup(e);
            }}
          >
            {canSplitLastWord ? (
              <>
                {head}
                <span className="whitespace-nowrap">
                  {last}
                  {"\u00A0"}
                  <span
                    data-ai-context-trigger
                    className="inline-flex items-baseline align-middle"
                  >
                    {collapsedSuffix}
                  </span>
                </span>
              </>
            ) : (
              <span className="whitespace-nowrap">
                {collapsedInner}
                {"\u00A0"}
                <span
                  data-ai-context-trigger
                  className="inline-flex items-baseline align-middle"
                >
                  {collapsedSuffix}
                </span>
              </span>
            )}
          </div>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={collapsedClassName}
        title={collapsedTitle}
      >
        {collapsedInner}
      </button>
    );
  }

  const inputClasses = cn(
    "w-full py-0.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-600",
    cellPadX
  );

  if (type === "select" && options) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setEditing(false);
          if (e.target.value !== value) onSave(e.target.value);
        }}
        onBlur={cancel}
        onKeyDown={handleKeyDown}
        className={cn(inputClasses, className)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (type === "textarea") {
    return (
      <div className="w-full min-w-0">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (validationError) setValidationError(undefined);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          rows={2}
          placeholder={placeholder}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? validationHintId : undefined}
          className={cn(
            inputClasses,
            "resize-none",
            validationError && "border-red-600 focus:ring-red-600",
            className
          )}
        />
        {validationError ? (
          <p id={validationHintId} className="mt-1 text-xs text-red-400">
            {validationError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={type === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (validationError) setValidationError(undefined);
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        aria-invalid={validationError ? true : undefined}
        aria-describedby={validationError ? validationHintId : undefined}
        className={cn(
          inputClasses,
          validationError && "border-red-600 focus:ring-red-600",
          className
        )}
      />
      {validationError ? (
        <p id={validationHintId} className="mt-1 text-xs text-red-400">
          {validationError}
        </p>
      ) : null}
    </div>
  );
}
