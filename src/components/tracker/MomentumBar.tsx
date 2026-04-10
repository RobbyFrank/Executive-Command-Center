import { cn } from "@/lib/utils";

interface MomentumBarProps {
  score: number;
  tooltip?: string;
  className?: string;
}

export function MomentumBar({ score, tooltip, className }: MomentumBarProps) {
  const p = Math.min(100, Math.max(0, score));
  const fillClass =
    p >= 70
      ? "bg-emerald-500"
      : p >= 40
        ? "bg-blue-500"
        : p >= 10
          ? "bg-amber-500"
          : "bg-zinc-600";

  return (
    <div
      className={cn(
        "relative w-full h-4 rounded-full bg-zinc-800 overflow-hidden min-w-[4.5rem]",
        className
      )}
      title={tooltip}
    >
      <div
        className={cn(
          "absolute left-0 top-0 h-full rounded-full transition-[width] duration-200",
          fillClass
        )}
        style={{ width: `${p}%` }}
        aria-hidden
      />
      <span
        className="relative z-10 flex h-full items-center justify-center text-[10px] font-medium tabular-nums text-zinc-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] pointer-events-none"
        aria-label={`Momentum ${p} percent`}
      >
        {p}%
      </span>
    </div>
  );
}
