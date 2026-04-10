import { cn } from "@/lib/utils";

interface ProgressBarProps {
  percent: number;
  className?: string;
}

export function ProgressBar({ percent, className }: ProgressBarProps) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <div
      className={cn(
        "relative w-full h-5 rounded-full bg-zinc-800 overflow-hidden",
        className
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 h-full rounded-full transition-[width] duration-200",
          p === 100
            ? "bg-emerald-500"
            : p >= 50
              ? "bg-blue-500"
              : p > 0
                ? "bg-yellow-500"
                : "bg-zinc-700"
        )}
        style={{ width: `${p}%` }}
        aria-hidden
      />
      <span
        className="relative z-10 flex h-full items-center justify-center text-[10px] font-medium tabular-nums text-zinc-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] pointer-events-none"
        title={`${p}%`}
      >
        {p}%
      </span>
    </div>
  );
}
