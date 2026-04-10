import { cn } from "@/lib/utils";
import type { Status } from "@/lib/types/tracker";

const STATUS_COLORS: Record<Status, string> = {
  "In Progress": "bg-blue-500/20 text-blue-400",
  "Not Started": "bg-zinc-500/20 text-zinc-400",
  Planning: "bg-purple-500/20 text-purple-400",
  Blocked: "bg-red-500/20 text-red-400",
  Ongoing: "bg-emerald-500/20 text-emerald-400",
  "Demand Testing": "bg-yellow-500/20 text-yellow-400",
  Evaluating: "bg-cyan-500/20 text-cyan-400",
  Idea: "bg-zinc-600/20 text-zinc-500",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium",
        STATUS_COLORS[status]
      )}
    >
      {status}
    </span>
  );
}
