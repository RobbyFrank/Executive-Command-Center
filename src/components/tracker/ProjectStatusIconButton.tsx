"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Hourglass,
  Lightbulb,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types/tracker";
import { isProjectStatus } from "@/lib/projectStatus";

/** Classic “stop” glyph (matches ProjectStatusPill so the two icons stay visually consistent). */
function StopIcon() {
  return (
    <svg
      className="h-[13.5px] w-[13.5px] shrink-0 opacity-95"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  );
}

/**
 * Per-status visuals for the leading status badge.
 * Border color mirrors the existing `ProjectStatusPill` so the two readouts feel like one system,
 * but kept local here to avoid touching the pill component.
 */
const STATUS_BADGE: Record<
  ProjectStatus,
  { ringClass: string; bgClass: string; icon: ReactNode }
> = {
  Idea: {
    ringClass: "border-zinc-500/55",
    bgClass: "bg-zinc-900/55",
    icon: (
      <Lightbulb className="h-[13.5px] w-[13.5px] shrink-0 text-zinc-300" aria-hidden />
    ),
  },
  Pending: {
    ringClass: "border-slate-400/55",
    bgClass: "bg-slate-900/60",
    icon: (
      <Hourglass className="h-[13.5px] w-[13.5px] shrink-0 text-slate-200" aria-hidden />
    ),
  },
  "In Progress": {
    ringClass: "border-amber-400/70",
    bgClass: "bg-amber-950/55",
    icon: (
      <Play
        className="h-[13.5px] w-[13.5px] shrink-0 fill-amber-300/95 text-amber-950"
        aria-hidden
      />
    ),
  },
  Stuck: {
    ringClass: "border-orange-400/70",
    bgClass: "bg-orange-950/50",
    icon: (
      <AlertTriangle
        className="h-[13.5px] w-[13.5px] shrink-0 text-orange-300"
        aria-hidden
      />
    ),
  },
  Blocked: {
    ringClass: "border-red-400/75",
    bgClass: "bg-red-950/55",
    icon: (
      <span className="shrink-0 text-red-400" aria-hidden>
        <StopIcon />
      </span>
    ),
  },
  "For Review": {
    ringClass: "border-violet-400/70",
    bgClass: "bg-violet-950/50",
    icon: (
      <ClipboardList
        className="h-[13.5px] w-[13.5px] shrink-0 text-violet-200"
        aria-hidden
      />
    ),
  },
  Done: {
    ringClass: "border-emerald-400/70",
    bgClass: "bg-emerald-950/50",
    icon: (
      <Check className="h-[13.5px] w-[13.5px] shrink-0 text-emerald-300" aria-hidden />
    ),
  },
};

interface ProjectStatusIconButtonProps {
  status: string;
  /** When true (dependency-blocked rows) the icon is display-only. */
  disabled?: boolean;
  /** Extra context for the tooltip (e.g. blocked-by project name). */
  titleSuffix?: string;
  className?: string;
}

/**
 * Circular status badge before the project name (decorative). The real control is an invisible
 * {@link InlineEditCell} status overlay in {@link ProjectRow} so the standard Status dropdown opens
 * on click with correct menu placement.
 */
export function ProjectStatusIconButton({
  status,
  disabled = false,
  titleSuffix,
  className,
}: ProjectStatusIconButtonProps) {
  const key: ProjectStatus = isProjectStatus(status) ? status : "Pending";
  const cfg = STATUS_BADGE[key];

  const title = titleSuffix
    ? `Status — ${key} (${titleSuffix})`
    : disabled
      ? `Status — ${key}`
      : `Status — ${key} · click to change`;

  return (
    <span
      title={title}
      aria-hidden
      className={cn(
        "inline-flex h-[21.6px] w-[21.6px] shrink-0 items-center justify-center rounded-full border",
        cfg.ringClass,
        cfg.bgClass,
        "pointer-events-none select-none",
        className
      )}
    >
      {cfg.icon}
    </span>
  );
}
