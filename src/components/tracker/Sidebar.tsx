"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { logoutAction } from "@/server/actions/auth";
import {
  LayoutDashboard,
  Users,
  Building2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  MessageSquareWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_COLLAPSED_PREF_KEY,
  readSidebarCollapsedLocalStorage,
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
    title: "Communication",
    items: [
      {
        href: "/unreplied",
        label: "Followups",
        icon: MessageSquareWarning,
      },
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

export function Sidebar({
  displayName,
  profilePicturePath,
  initialCollapsed = false,
  unattendedNewHireCount = 0,
  unrepliedAsksCount = 0,
}: {
  displayName: string;
  /** Same source as Team roster (`/uploads/…` or remote blob URL). */
  profilePicturePath?: string;
  /** From HTTP cookie so the first paint matches the user's last choice (see `sidebar-prefs`). */
  initialCollapsed?: boolean;
  /** New hires (≤30 days) with no pilot project — Team page onboarding. */
  unattendedNewHireCount?: number;
  /** Open items on Followups (48+ business hours, no teammate reply). */
  unrepliedAsksCount?: number;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [profilePhotoBroken, setProfilePhotoBroken] = useState(false);

  // Apply browser preference before paint (localStorage wins; seed from server cookie if unset).
  // Keeps cookie aligned so the next full reload matches without a flash.
  useLayoutEffect(() => {
    try {
      let raw = readSidebarCollapsedLocalStorage();
      if (raw === null) {
        raw = initialCollapsed ? "true" : "false";
        localStorage.setItem(SIDEBAR_COLLAPSED_PREF_KEY, raw);
      }
      const v = raw === "true";
      setCollapsed(v);
      setSidebarCollapsedCookie(v);
    } catch {
      /* ignore */
    }
  }, [initialCollapsed]);

  // Other tabs / windows: stay in sync when preference changes there.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== SIDEBAR_COLLAPSED_PREF_KEY || e.newValue === null) return;
      const next = e.newValue === "true";
      setCollapsed(next);
      setSidebarCollapsedCookie(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    setProfilePhotoBroken(false);
  }, [profilePicturePath]);

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

  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();
  const profilePhotoSrc = profilePicturePath?.trim();
  const showProfilePhoto = Boolean(profilePhotoSrc) && !profilePhotoBroken;

  return (
    <aside
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col overflow-x-hidden border-r border-zinc-800/90 bg-zinc-950 transition-[width] duration-200 ease-out motion-reduce:transition-none",
        /* Very gentle top-left sheen — barely lifts flat zinc-950 */
        "after:pointer-events-none after:absolute after:inset-0 after:z-0 after:content-[''] after:bg-[linear-gradient(135deg,rgba(255,255,255,0.028)_0%,rgba(255,255,255,0.006)_38%,transparent_62%)]",
        "before:pointer-events-none before:absolute before:inset-y-8 before:right-0 before:z-[1] before:w-px before:bg-gradient-to-b before:from-transparent before:via-emerald-500/25 before:to-transparent before:opacity-70",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Keep vertical padding + border in sync with {@link RoadmapStickyToolbar} so the rule lines up with the main sticky header */}
      <div
        className={cn(
          "relative z-10 shrink-0 border-b border-zinc-800/70 bg-zinc-950/95 px-2 pt-6 pb-3 backdrop-blur-md",
          collapsed
            ? "relative flex min-h-0 flex-col items-center"
            : "flex min-h-0 items-center justify-between gap-2"
        )}
      >
        <div
          className={cn(
            "flex min-h-[2.25rem] min-w-0 items-center gap-2.5",
            collapsed
              ? "flex-col justify-center px-0.5"
              : "min-w-0 flex-1"
          )}
        >
          <div
            className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
            aria-hidden
          >
            <Image
              src="/icons/icon.png"
              alt=""
              width={32}
              height={32}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-none">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                MLabs
              </p>
              <p className="mt-0.5 truncate text-xs font-medium leading-tight text-zinc-300">
                Portfolio OS
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cn(
            "shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/30",
            collapsed &&
              "absolute right-1.5 top-1/2 z-10 -translate-y-1/2"
          )}
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
      </div>

      <nav className="relative z-10 flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-3">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div
            key={group.title}
            className={cn(
              groupIndex > 0 && "pt-3"
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
                      "relative flex items-center rounded-md text-sm transition-colors motion-reduce:transition-none",
                      collapsed
                        ? "justify-center px-2 py-2"
                        : "gap-3 px-3 py-2",
                      isActive
                        ? "bg-zinc-900/90 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        {item.href === "/team" && unattendedNewHireCount > 0 ? (
                          <span
                            className="shrink-0 tabular-nums rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/35"
                            title={`${unattendedNewHireCount} new hire${
                              unattendedNewHireCount === 1 ? "" : "s"
                            } without a pilot project`}
                          >
                            {unattendedNewHireCount > 9
                              ? "9+"
                              : unattendedNewHireCount}
                          </span>
                        ) : null}
                        {item.href === "/unreplied" && unrepliedAsksCount > 0 ? (
                          <span
                            className="shrink-0 tabular-nums rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 ring-1 ring-violet-500/35"
                            title={`${unrepliedAsksCount} open followup${
                              unrepliedAsksCount === 1 ? "" : "s"
                            }`}
                          >
                            {unrepliedAsksCount > 9 ? "9+" : unrepliedAsksCount}
                          </span>
                        ) : null}
                      </>
                    )}
                    {collapsed &&
                    item.href === "/team" &&
                    unattendedNewHireCount > 0 ? (
                      <span
                        className="absolute right-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-amber-400 shadow-[0_0_0_2px_rgba(9,9,11,1)]"
                        title={`${unattendedNewHireCount} new hire${
                          unattendedNewHireCount === 1 ? "" : "s"
                        } without a pilot project`}
                      />
                    ) : null}
                    {collapsed &&
                    item.href === "/unreplied" &&
                    unrepliedAsksCount > 0 ? (
                      <span
                        className="absolute right-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-violet-400 shadow-[0_0_0_2px_rgba(9,9,11,1)]"
                        title={`${unrepliedAsksCount} open followup${
                          unrepliedAsksCount === 1 ? "" : "s"
                        }`}
                      />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "relative z-10 border-t border-zinc-800",
          collapsed ? "p-2" : "p-3"
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            collapsed && "flex-col"
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2",
              collapsed && "flex-none flex-col gap-1.5"
            )}
          >
            {showProfilePhoto && profilePhotoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- local /uploads and blob URLs (same as Team roster / AssistantPersonInline)
              <img
                src={profilePhotoSrc}
                alt=""
                className={cn(
                  "h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-emerald-500/20",
                  collapsed && "h-6 w-6"
                )}
                onError={() => setProfilePhotoBroken(true)}
              />
            ) : (
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-zinc-300 ring-1 ring-emerald-500/15",
                  collapsed && "h-6 w-6 text-[10px]"
                )}
                aria-hidden
              >
                {initial}
              </span>
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm text-zinc-400",
                collapsed && "sr-only"
              )}
            >
              {displayName}
            </span>
          </div>
          <form action={logoutAction} className="shrink-0">
            <button
              type="submit"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/30"
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
