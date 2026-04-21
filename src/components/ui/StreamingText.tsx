"use client";

import { useSmoothText, type UseSmoothTextOptions } from "@/hooks/useSmoothText";
import { cn } from "@/lib/utils";

/**
 * Renders a streamed AI response with frame-smoothed character reveal and a
 * soft blinking caret while the stream is live. Drop-in wrapper around
 * {@link useSmoothText}: pass the full buffer you already accumulate in your
 * fetch loop as {@link text} and whether the underlying stream is still
 * active as {@link isStreaming}. Once the stream ends, the hook flushes any
 * remaining characters and the caret is hidden.
 *
 * This component is intentionally presentational — layout, typography, and
 * whitespace handling are controlled by the caller via {@link className}.
 */
export interface StreamingTextProps extends UseSmoothTextOptions {
  text: string;
  isStreaming: boolean;
  /** Tailwind/class names applied to the wrapping span. */
  className?: string;
  /** Hide the trailing caret even while streaming (defaults to false). */
  hideCaret?: boolean;
  /** Tailwind/class names applied to the caret element. */
  caretClassName?: string;
}

export function StreamingText({
  text,
  isStreaming,
  className,
  hideCaret = false,
  caretClassName,
  ...opts
}: StreamingTextProps) {
  const displayed = useSmoothText(text, isStreaming, opts);
  // Keep the caret visible while the hook is still flushing characters
  // after the upstream stream ended, so the last few characters don't
  // appear mid-flush without a cursor.
  const stillFlushing = displayed.length < text.length;
  const showCaret = !hideCaret && (isStreaming || stillFlushing);

  return (
    <span className={className}>
      {displayed}
      {showCaret && (
        <span
          aria-hidden
          className={cn(
            "ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-current opacity-70",
            caretClassName,
          )}
        />
      )}
    </span>
  );
}
