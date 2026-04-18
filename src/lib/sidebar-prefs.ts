/**
 * Sidebar collapsed state: same key for localStorage (client) and HTTP cookie (SSR first paint).
 * Cookie is set when the user toggles the sidebar so the dashboard layout can render the correct width before hydration.
 *
 * Cookie name uses underscores (no dots) — some stacks handle dotted cookie names inconsistently; we still read the legacy dotted name for migration.
 */
export const SIDEBAR_COLLAPSED_PREF_KEY = "ecc_sidebar_collapsed";

/** Previous key — migrated from localStorage and cleared from cookies on write. */
const SIDEBAR_COLLAPSED_LEGACY_COOKIE = "ecc.sidebar.collapsed";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

type CookieStoreLike = {
  get: (name: string) => { value: string } | undefined;
};

/** Read collapsed preference for the server-rendered layout (supports legacy cookie name). */
export function getSidebarCollapsedFromCookie(
  cookieStore: CookieStoreLike
): boolean {
  const v =
    cookieStore.get(SIDEBAR_COLLAPSED_PREF_KEY)?.value ??
    cookieStore.get(SIDEBAR_COLLAPSED_LEGACY_COOKIE)?.value;
  return v === "true";
}

/** Current localStorage value, migrating from legacy key if needed. Returns `"true"` | `"false"` or `null` if unset. */
export function readSidebarCollapsedLocalStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let raw = localStorage.getItem(SIDEBAR_COLLAPSED_PREF_KEY);
    if (raw !== null) return raw;
    const legacy = localStorage.getItem(SIDEBAR_COLLAPSED_LEGACY_COOKIE);
    if (legacy !== null) {
      localStorage.setItem(SIDEBAR_COLLAPSED_PREF_KEY, legacy);
      localStorage.removeItem(SIDEBAR_COLLAPSED_LEGACY_COOKIE);
      return legacy;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Persist collapsed preference for the server-rendered layout on the next request. */
export function setSidebarCollapsedCookie(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:";
  const val = collapsed ? "true" : "false";
  document.cookie = `${SIDEBAR_COLLAPSED_PREF_KEY}=${val}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure ? "; Secure" : ""}`;
  // Drop legacy cookie so the server does not read a stale value.
  document.cookie = `${SIDEBAR_COLLAPSED_LEGACY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
}
