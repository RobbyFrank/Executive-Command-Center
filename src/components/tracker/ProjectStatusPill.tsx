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
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types/tracker";
import { isProjectStatus } from "@/lib/projectStatus";

const PILL: Record<
  ProjectStatus,
  { className: string; icon: ReactNode }
> = {
  Idea: {
    className:
      "border-zinc-600/50 bg-zinc-800/60 text-zinc-300 ring-zinc-500/20",
    icon: <Lightbulb className="h-3 w-3 shrink-0 opacity-90" aria-hidden />,
  },
  Pending: {
    className:
      "border-slate-500/40 bg-slate-900/55 text-slate-200 ring-slate-500/15",
    icon: <Hourglass className="h-3 w-3 shrink-0 opacity-90" aria-hidden />,
  },
  "In Progress": {
    className:
      "border-amber-500/45 bg-amber-950/50 text-amber-100 ring-amber-500/25",
    icon: <Play className="h-3 w-3 shrink-0 fill-amber-300/90 text-amber-950" aria-hidden />,
  },
  Stuck: {
    className:
      "border-orange-500/50 bg-orange-950/45 text-orange-100 ring-orange-500/30",
    icon: (
      <AlertTriangle className="h-3 w-3 shrink-0 text-orange-300" aria-hidden />
    ),
  },
  "For Review": {
    className:
      "border-violet-500/45 bg-violet-950/45 text-violet-100 ring-violet-500/25",
    icon: <ClipboardList className="h-3 w-3 shrink-0 opacity-90" aria-hidden />,
  },
  Done: {
    className:
      "border-emerald-500/45 bg-emerald-950/45 text-emerald-100 ring-emerald-500/25",
    icon: <Check className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden />,
  },
};

export function ProjectStatusPill({ status }: { status: string }) {
  const key: ProjectStatus = isProjectStatus(status) ? status : "Pending";
  const cfg = PILL[key];
  return (
    <span
      className={cn(
        "inline-flex min-h-[28px] min-w-0 max-w-full w-full items-center gap-0.5 rounded border px-1 py-0.5 text-[11px] font-medium leading-tight ring-1 shadow-sm",
        cfg.className
      )}
    >
      {cfg.icon}
      <span className="min-w-0 truncate">{key}</span>
    </span>
  );
}
