import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CircleSlash,
  Code2,
  Headphones,
  Landmark,
  Megaphone,
  Package,
  Palette,
  Scale,
  Settings2,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconStyle = { Icon: LucideIcon; className: string };

function resolveDepartmentIconStyle(label: string): IconStyle {
  const raw = label.trim();
  if (!raw || raw === "—") {
    return { Icon: CircleSlash, className: "text-amber-400" };
  }
  const t = raw.toLowerCase();

  if (t === "founders") {
    return { Icon: Users, className: "text-amber-400" };
  }

  if (/\bsales\b|revenue|business dev/i.test(t)) {
    return { Icon: TrendingUp, className: "text-emerald-400" };
  }
  if (/market|growth|brand|content/i.test(t)) {
    return { Icon: Megaphone, className: "text-violet-400" };
  }
  if (/develop|engineer|engineering|devops|technical|it\b/i.test(t)) {
    return { Icon: Code2, className: "text-sky-400" };
  }
  if (/product\b|pm\b|program/i.test(t)) {
    return { Icon: Package, className: "text-amber-400" };
  }
  if (/operat|ops\b|logistics/i.test(t)) {
    return { Icon: Settings2, className: "text-orange-400" };
  }
  if (/people|human|hr\b|hiring|talent|recruit/i.test(t)) {
    return { Icon: Users, className: "text-cyan-400" };
  }
  if (/design|ux\b|ui\b|creative/i.test(t)) {
    return { Icon: Palette, className: "text-fuchsia-400" };
  }
  if (/finance|account|fp&a/i.test(t)) {
    return { Icon: Landmark, className: "text-lime-400" };
  }
  if (/legal|compliance/i.test(t)) {
    return { Icon: Scale, className: "text-rose-400" };
  }
  if (/support|success|customer/i.test(t)) {
    return { Icon: Headphones, className: "text-teal-400" };
  }

  return { Icon: Building2, className: "text-amber-400/95" };
}

/** Icon + tint for a department label (or empty / none). */
export function DepartmentOptionIcon({
  label,
  className,
  iconClassName,
}: {
  label: string;
  className?: string;
  iconClassName?: string;
}) {
  const { Icon, className: tint } = resolveDepartmentIconStyle(label);
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        "bg-zinc-800/90 ring-1 ring-zinc-700/60 shadow-inner",
        className
      )}
    >
      <Icon className={cn("h-4 w-4", tint, iconClassName)} aria-hidden />
    </span>
  );
}
