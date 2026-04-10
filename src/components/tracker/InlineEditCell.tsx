"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { ChevronDown, Pencil } from "lucide-react";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
} from "@/lib/relativeCalendarDate";
import { cn } from "@/lib/utils";
import {
  CellHoverTooltip,
  type CellHoverTooltipHandle,
} from "./CellHoverTooltip";

function isValidHttpUrl(raw: string): boolean {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
  /** Called when the cell enters or leaves edit mode (e.g. to widen a narrow column while editing). */
  onEditingChange?: (editing: boolean) => void;
  /**
   * When `type` is `select`, `always` shows the native `<select>` at rest so one click opens
   * the menu. `toggle` uses a collapsed label and needs a second click to reveal the select.
   */
  selectPresentation?: "toggle" | "always";
  /**
   * Collapsed display: single-line ellipsis in the cell; full text in a hover tooltip
   * when truncated. Only applies to default variant text/date cells (not select/link).
   */
  displayTruncateSingleLine?: boolean;
  /** Tooltip body when `displayTruncateSingleLine`; defaults to raw `value`. */
  tooltipLabel?: string;
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
  emptyLabel = "—",
  formatDisplay,
  displayTitle,
  collapsedButtonClassName,
  variant = "default",
  linkBehavior = false,
  onEditingChange,
  selectPresentation = "always",
  displayTruncateSingleLine = false,
  tooltipLabel,
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const truncateTooltipRef = useRef<CellHoverTooltipHandle>(null);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
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
    return (
      <div className="relative isolate w-full min-w-0">
        <div
          className={cn(
            "pointer-events-none flex min-h-[28px] max-w-full items-center rounded py-0.5 pl-1.5 pr-7 text-left text-sm",
            !value.trim() && "text-zinc-600 italic",
            value.trim() && displayClassName
          )}
        >
          {value.trim() ? formatDisplay!(value) : emptyLabel}
        </div>
        <select
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (next !== value) onSave(next);
          }}
          className={cn(
            "peer absolute inset-0 z-[1] min-h-[28px] w-full max-w-full cursor-pointer appearance-none rounded border-0 bg-transparent opacity-0",
            "hover:bg-zinc-800",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-600",
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
          className="pointer-events-none absolute right-1 top-1/2 z-[2] h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 opacity-0 transition-opacity peer-hover:opacity-100 peer-focus-visible:opacity-100"
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
            "peer w-full min-h-[28px] max-w-full pl-1.5 pr-7 py-0.5 rounded text-sm cursor-pointer text-left",
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

  if (!editing) {
    const dateTitle =
      type === "date" && value
        ? `${formatCalendarDateHint(value)} — click to edit`
        : "Click to edit";
    const collapsedTitle = displayTitle ?? dateTitle;

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
        : "text-left w-full px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors min-h-[28px] text-sm";

    const trimmed = value.trim();
    if (linkBehavior && trimmed && isValidHttpUrl(trimmed)) {
      return (
        <span className="inline-flex items-center gap-0.5 min-w-0 group/urlicon">
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              collapsedLayout,
              displayClassName,
              collapsedButtonClassName,
              "inline-flex items-center justify-center no-underline text-inherit"
            )}
            title="Open link in new tab"
            onClick={(e) => e.stopPropagation()}
          >
            {formatDisplay ? formatDisplay(trimmed) : trimmed}
          </a>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditing(true);
            }}
            className={cn(
              "p-0.5 rounded shrink-0 text-zinc-500 hover:text-zinc-300 transition-opacity",
              "opacity-0 group-hover/urlicon:opacity-100 focus-visible:opacity-100",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/35"
            )}
            title="Edit or remove link"
            aria-label="Edit or remove link"
          >
            <Pencil className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </span>
      );
    }

    const collapsedInner =
      type === "select" && options
        ? !value
          ? emptyLabel
          : formatDisplay
            ? formatDisplay(value)
            : ((options.find((o) => o.value === value)?.label ?? value) ||
              emptyLabel)
        : formatDisplay
          ? value
            ? formatDisplay(value)
            : emptyLabel
          : type === "date" && value
            ? formatRelativeCalendarDate(value)
            : value || emptyLabel;

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
          className={collapsedClassName}
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
          >
            {collapsedInner}
          </CellHoverTooltip>
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

  const inputClasses =
    "w-full px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-600";

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
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
        rows={2}
        placeholder={placeholder}
        className={cn(inputClasses, "resize-none", className)}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={cn(inputClasses, className)}
    />
  );
}
