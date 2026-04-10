import type { ReactNode } from "react";

/**
 * Collapsed label for an https URL: favicon (via public lookup) + hostname without leading www.
 */
export function formatWebsiteFaviconDisplay(url: string): ReactNode {
  let hostname: string;
  try {
    hostname = new URL(url.trim()).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
  if (!hostname) return url;

  const iconSrc = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      {/* External favicon service; <img> avoids Next image remotePatterns config */}
      <img
        src={iconSrc}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 rounded-sm bg-zinc-800/90 ring-1 ring-zinc-700/60"
        loading="lazy"
        decoding="async"
      />
      <span className="min-w-0 truncate font-medium text-zinc-200">{hostname}</span>
    </span>
  );
}
