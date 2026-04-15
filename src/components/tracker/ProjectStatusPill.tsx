"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Lightbulb,
  Play,
  Hourglass,
} from "lucide-react";

/** Classic “stop” control (filled square); Lucide 1.x has no dedicated stop glyph. */
function StopIcon() {
  return (
    <svg
      className="h-3 w-3 shrink-0 opacity-95"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  );
}
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types/tracker";
import { isProjectStatus } from "@/lib/projectStatus";

const PILL: Record<
  ProjectStatus,
  { pillClass: string; inlineClass: string; icon: ReactNode }
> = {
  Idea: {
    pillClass:
      "border-zinc-600/50 bg-zinc-800/60 text-zinc-300 ring-zinc-500/20",
    inlineClass: "text-zinc-300",
    icon: <Lightbulb className="h-3 w-3 shrink-0 opacity-90" aria-hidden />,
  },
  Pending: {
    pillClass:
      "border-slate-500/40 bg-slate-900/55 text-slate-200 ring-slate-500/15",
    inlineClass: "text-slate-200",
    icon: <Hourglass className="h-3 w-3 shrink-0 opacity-90" aria-hidden />,
  },
  "In Progress": {
    pillClass:
      "border-amber-500/45 bg-amber-950/50 text-amber-100 ring-amber-500/25",
    inlineClass: "text-amber-100/95",
    icon: <Play className="h-3 w-3 shrink-0 fill-amber-300/90 text-amber-950" aria-hidden />,
  },
  Stuck: {
    pillClass:
      "border-orange-500/50 bg-orange-950/45 text-orange-100 ring-orange-500/30",
    inlineClass: "text-orange-100/95",
    icon: (
      <AlertTriangle className="h-3 w-3 shrink-0 text-orange-300" aria-hidden />
    ),
  },
  Blocked: {
    pillClass:
      "border-red-500/60 bg-red-950/55 text-red-100 ring-red-500/40 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.12)]",
    inlineClass: "text-red-100",
    icon: (
      <span className="shrink-0 text-red-400" aria-hidden>
        <StopIcon />
      </span>
    ),
  },
  "For Review": {
    pillClass:
      "border-violet-500/45 bg-violet-950/45 text-violet-100 ring-violet-500/25",
    inlineClass: "text-violet-100/95",
    icon: <ClipboardList className="h-3 w-3 shrink-0 opacity-90" aria-hidden />,
  },
  Done: {
    pillClass:
      "border-emerald-500/45 bg-emerald-950/45 text-emerald-100 ring-emerald-500/25",
    inlineClass: "text-emerald-100/95",
    icon: <Check className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden />,
  },
};

type ProjectStatusPillProps = {
  status: string;
  /**
   * `pill` — full bordered chip (filters, dense labels).
   * `inline` — icon + colored label only; pair with `group/status` on the parent cell so hover adds a light frame (Roadmap / Review project status).
   */
  variant?: "pill" | "inline";
};

export function ProjectStatusPill({
  status,
  variant = "pill",
}: ProjectStatusPillProps) {
  const key: ProjectStatus = isProjectStatus(status) ? status : "Pending";
  const cfg = PILL[key];
  return (
    <span
      className={cn(
        "inline-flex min-h-[28px] min-w-0 max-w-full w-full items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium leading-tight transition-[box-shadow,background-color,border-color] duration-150 motion-reduce:transition-none",
        variant === "pill" && [
          "border ring-1 shadow-sm",
          cfg.pillClass,
        ],
        variant === "inline" && [
          "border-0 bg-transparent shadow-none ring-0",
          cfg.inlineClass,
          "group-hover/status:border group-hover/status:border-zinc-600/55 group-hover/status:bg-zinc-900/65 group-hover/status:ring-1 group-hover/status:ring-zinc-500/25 group-hover/status:shadow-sm",
          "group-focus-within/status:border group-focus-within/status:border-zinc-600/55 group-focus-within/status:bg-zinc-900/65 group-focus-within/status:ring-1 group-focus-within/status:ring-zinc-500/25 group-focus-within/status:shadow-sm",
        ]
      )}
    >
      {cfg.icon}
      <span className="min-w-0 truncate">{key}</span>
    </span>
  );
}
