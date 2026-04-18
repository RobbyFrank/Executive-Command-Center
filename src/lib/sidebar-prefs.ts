/**
 * Sidebar collapsed state: same key for localStorage (client) and HTTP cookie (SSR first paint).
 * Cookie is set when the user toggles the sidebar so the dashboard layout can render the correct width before hydration.
 */
export const SIDEBAR_COLLAPSED_PREF_KEY = "ecc.sidebar.collapsed";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

/** Persist collapsed preference for the server-rendered layout on the next request. */
export function setSidebarCollapsedCookie(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = `${SIDEBAR_COLLAPSED_PREF_KEY}=${collapsed ? "true" : "false"}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
