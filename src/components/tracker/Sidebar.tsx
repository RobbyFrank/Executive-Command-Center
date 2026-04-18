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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_COLLAPSED_PREF_KEY,
  setSidebarCollapsedCookie,
} from "@/lib/sidebar-prefs";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Planning",
    items: [{ href: "/", label: "Roadmap", icon: LayoutDashboard }],
  },
  {
    title: "Organization",
    items: [
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/team", label: "Team", icon: Users },
    ],
  },
];

export function Sidebar({
  displayName,
  initialCollapsed = false,
}: {
  displayName: string;
  /** From HTTP cookie so the first paint matches the user's last choice (see `sidebar-prefs`). */
  initialCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    try {
      const ls = localStorage.getItem(SIDEBAR_COLLAPSED_PREF_KEY);
      if (ls !== null) {
        setCollapsed(ls === "true");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(
          SIDEBAR_COLLAPSED_PREF_KEY,
          next ? "true" : "false"
        );
      } catch {
        /* ignore */
      }
      setSidebarCollapsedCookie(next);
      return next;
    });
  }, []);

  return (
    <aside
      className={cn(
        "border-r border-zinc-800 bg-zinc-950 flex min-h-0 flex-col shrink-0 overflow-x-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-16" : "w-56"
      )}
    >
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
                const collapsedHint = item.label;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? collapsedHint : undefined}
                    aria-label={collapsed ? collapsedHint : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-md text-sm transition-colors motion-reduce:transition-none",
                      collapsed
                        ? "justify-center px-2 py-2"
                        : "gap-3 pl-2.5 pr-3 py-2",
                      isActive
                        ? "border-l-2 border-emerald-500/90 bg-zinc-900/80 text-zinc-100"
                        : "border-l-2 border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/70"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
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
          collapsed ? "p-2" : "p-3"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 min-w-0",
            collapsed && "flex-col"
          )}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            className="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/50"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </button>
          <span
            className={cn(
              "text-sm text-zinc-400 truncate min-w-0 flex-1",
              collapsed && "sr-only"
            )}
          >
            {displayName}
          </span>
          <form action={logoutAction} className="shrink-0">
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
