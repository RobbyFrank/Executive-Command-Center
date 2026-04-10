"use client";

import type { WorkloadSortTier } from "@/lib/autonomyRoster";
import { cn } from "@/lib/utils";
import {
  CircleSlash,
  Flame,
  Gauge,
  SignalLow,
  type LucideIcon,
} from "lucide-react";

const TIER_VISUAL: Record<
  WorkloadSortTier,
  { Icon: LucideIcon; container: string; icon: string }
> = {
  heavy: {
    Icon: Flame,
    container: "bg-rose-950/40 ring-rose-500/30",
    icon: "text-rose-400",
  },
  moderate: {
    Icon: Gauge,
    container: "bg-amber-950/35 ring-amber-500/30",
    icon: "text-amber-400",
  },
  light: {
    Icon: SignalLow,
    container: "bg-sky-950/30 ring-sky-500/25",
    icon: "text-sky-400",
  },
  idle: {
    Icon: CircleSlash,
    container: "bg-zinc-800/90 ring-zinc-600/45",
    icon: "text-zinc-500",
  },
};

/** Compact icon for Team workload section headers (matches tier intensity). */
export function WorkloadTierHeaderIcon({ tier }: { tier: WorkloadSortTier }) {
  const { Icon, container, icon } = TIER_VISUAL[tier];
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 shadow-inner",
        container
      )}
      aria-hidden
    >
      <Icon className={cn("h-3.5 w-3.5", icon)} strokeWidth={2} />
    </span>
  );
}
