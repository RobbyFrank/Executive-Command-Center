import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/types/tracker";

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "bg-red-500/20 text-red-400 border-red-500/30",
  P1: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  P2: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  P3: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border",
        PRIORITY_COLORS[priority]
      )}
    >
      {priority}
    </span>
  );
}
