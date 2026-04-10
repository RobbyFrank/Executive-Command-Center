"use client";

import { cn } from "@/lib/utils";

interface ScoreCellProps {
  value: number;
  max?: number;
  /** Omit for read-only display when scores are shown without editing. */
  onSave?: (value: number) => void;
  colorScale?: "impact" | "confidence" | "autonomy" | "complexity";
}

const COLOR_SCALES = {
  impact: ["bg-zinc-700", "bg-zinc-600", "bg-yellow-600", "bg-orange-500", "bg-red-500"],
  confidence: ["bg-red-500", "bg-orange-500", "bg-yellow-600", "bg-emerald-600", "bg-emerald-500"],
  autonomy: ["bg-zinc-700", "bg-zinc-600", "bg-zinc-500", "bg-zinc-400", "bg-zinc-300"],
  complexity: ["bg-emerald-500", "bg-emerald-600", "bg-yellow-600", "bg-orange-500", "bg-red-500"],
};

export function ScoreCell({
  value,
  max = 5,
  onSave,
  colorScale = "impact",
}: ScoreCellProps) {
  const colors = COLOR_SCALES[colorScale];
  const interactive = Boolean(onSave);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const isActive = n <= value;
        const className = cn(
          "w-4 h-4 rounded-sm transition-colors",
          isActive ? colors[i] : "bg-zinc-800",
          interactive && !isActive && "hover:bg-zinc-700"
        );
        const title = `${n}/${max}`;
        if (interactive && onSave) {
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSave(n)}
              className={className}
              title={title}
            />
          );
        }
        return (
          <span
            key={n}
            className={cn(className, "inline-block shrink-0")}
            title={title}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
