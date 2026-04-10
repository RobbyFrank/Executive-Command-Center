"use client";

import { AlertCircle, CheckCircle } from "lucide-react";
import {
  formatLastReviewedHint,
  getReviewStaleWindowHours,
  isReviewStale,
} from "@/lib/reviewStaleness";
import { cn } from "@/lib/utils";

interface ReviewActionProps {
  lastReviewed: string;
  onConfirm: () => void;
  /** "goal" | "project" for aria-label */
  kind: "goal" | "project";
  /** Team autonomy score for the row owner — adjusts stale window when set. */
  ownerAutonomy?: number | null;
}

export function ReviewAction({
  lastReviewed,
  onConfirm,
  kind,
  ownerAutonomy,
}: ReviewActionProps) {
  const stale = isReviewStale(lastReviewed, kind, ownerAutonomy);
  const windowHours = getReviewStaleWindowHours(kind, ownerAutonomy);
  const label =
    kind === "goal" ? "Confirm goal reviewed" : "Confirm project reviewed";

  if (stale) {
    return (
      <button
        type="button"
        onClick={onConfirm}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors",
          "border-amber-500/60 bg-amber-500/15 text-amber-300",
          "hover:bg-amber-500/25 hover:border-amber-400/80",
          "shadow-[0_0_12px_-2px_rgba(245,158,11,0.35)]",
          "animate-pulse"
        )}
        title={`Not reviewed in the last ${windowHours} hours — click to confirm`}
        aria-label={label}
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Review
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onConfirm}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
        "border-emerald-500/25 bg-emerald-500/10 text-emerald-400/95",
        "hover:bg-emerald-500/20 hover:text-emerald-300"
      )}
      title={
        lastReviewed
          ? `Last reviewed ${formatLastReviewedHint(lastReviewed)}. Click to confirm again.`
          : "Click to confirm reviewed"
      }
      aria-label={label}
    >
      <CheckCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      OK
    </button>
  );
}
