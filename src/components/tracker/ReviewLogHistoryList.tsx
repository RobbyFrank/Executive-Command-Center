import type { ReviewLogEntry } from "@/lib/types/tracker";
import { formatLastReviewedHint } from "@/lib/reviewStaleness";
import { cn } from "@/lib/utils";

interface ReviewLogHistoryListProps {
  /** Newest first */
  entries: ReviewLogEntry[];
  size?: "default" | "compact";
  className?: string;
}

export function ReviewLogHistoryList({
  entries,
  size = "default",
  className,
}: ReviewLogHistoryListProps) {
  if (entries.length === 0) return null;

  const compact = size === "compact";

  return (
    <ul
      className={cn(
        "space-y-2 overflow-y-auto overscroll-contain pr-0.5",
        compact ? "max-h-40" : "max-h-52",
        className
      )}
    >
      {entries.map((e, i) => (
        <li
          key={e.id}
          className={cn(
            "rounded-r-md border border-zinc-800/80 border-l-2 border-l-zinc-500/50 bg-zinc-950/70 pl-3 pr-2.5",
            compact ? "py-2" : "py-2.5",
            i === 0 && "border-l-teal-500/45"
          )}
        >
          <div
            className={cn(
              "mb-1 font-medium tabular-nums text-zinc-500",
              compact ? "text-[10px] leading-none" : "text-[11px]"
            )}
          >
            {formatLastReviewedHint(e.at)}
          </div>
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-zinc-200 leading-relaxed",
              compact ? "text-[11px]" : "text-xs"
            )}
          >
            {e.text}
          </p>
        </li>
      ))}
    </ul>
  );
}
