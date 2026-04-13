"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { logoutAction } from "@/server/actions/auth";
import {
  LayoutDashboard,
  Users,
  Building2,
  LogOut,
  BarChart3,
  Grid3X3,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "ecc.sidebar.collapsed";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Subtle beta indicator in the expanded sidebar */
  beta?: boolean;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Planning",
    items: [{ href: "/", label: "Roadmap", icon: LayoutDashboard }],
  },
  {
    title: "Insights",
    items: [
      { href: "/summary", label: "Summary", icon: BarChart3, beta: true },
      { href: "/matrix", label: "Matrix", icon: Grid3X3, beta: true },
      { href: "/review", label: "Review", icon: ClipboardCheck, beta: true },
    ],
  },
  {
    title: "Organization",
    items: [
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/team", label: "Team", icon: Users },
    ],
  },
];

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "true" : "false");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <aside
      className={cn(
        "border-r border-zinc-800 bg-zinc-950 flex min-h-0 flex-col shrink-0 overflow-x-hidden transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "border-b border-zinc-800",
          collapsed ? "p-2 flex flex-col items-center gap-2" : "p-4"
        )}
      >
        {!collapsed && (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-zinc-100 tracking-tight">
                Executive Command Center
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">MLabs Roadmap</p>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50"
              title="Collapse sidebar"
              aria-expanded={!collapsed}
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50"
            title="Expand sidebar"
            aria-expanded={false}
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-0">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div
            key={group.title}
            className={cn(
              groupIndex > 0 && "pt-3 mt-1 border-t border-zinc-800"
            )}
          >
            <h2
              className={cn(
                "px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500",
                collapsed && "sr-only"
              )}
            >
              {group.title}
            </h2>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const collapsedHint = item.beta
                  ? `${item.label} (beta)`
                  : item.label;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? collapsedHint : undefined}
                    aria-label={collapsed ? collapsedHint : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-md text-sm transition-colors",
                      collapsed
                        ? "justify-center px-2 py-2"
                        : "gap-3 px-3 py-2",
                      isActive
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.beta ? (
                          <span className="shrink-0 text-[9px] font-normal text-zinc-600/70">
                            Beta
                          </span>
                        ) : null}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "border-t border-zinc-800",
          collapsed ? "p-2 flex flex-col items-center gap-2" : "p-3"
        )}
      >
        <div
          className={cn(
            "flex items-center",
            collapsed ? "flex-col gap-2" : "justify-between px-3 py-2"
          )}
        >
          <span
            className={cn(
              "text-sm text-zinc-400 truncate",
              collapsed && "sr-only"
            )}
          >
            {username}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
