"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/server/actions/auth";
import {
  LayoutDashboard,
  Users,
  Building2,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Roadmap", icon: LayoutDashboard },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/team", label: "Team", icon: Users },
];

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-sm font-bold text-zinc-100 tracking-tight">
          Executive Command Center
        </h1>
        <p className="text-xs text-zinc-500 mt-0.5">MLabs Roadmap</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-zinc-800">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm text-zinc-400">{username}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
