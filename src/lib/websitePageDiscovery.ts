const EXCLUDE_PATH = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|webm|mov|js|mjs|css|map|xml|json)(\?|$)/i;

const PATH_KEYWORDS = [
  "about",
  "company",
  "team",
  "product",
  "pricing",
  "feature",
  "solution",
  "platform",
  "customer",
  "mission",
  "career",
  "contact",
  "blog",
  "doc",
  "resource",
  "legal",
  "privacy",
  "security",
];

function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function scorePathname(pathname: string): number {
  const p = pathname.toLowerCase();
  if (p === "/" || p === "") return 4;
  let s = 0;
  for (const k of PATH_KEYWORDS) {
    if (p.includes(k)) s += 5;
  }
  const depth = p.split("/").filter(Boolean).length;
  if (depth <= 2) s += 2;
  if (depth > 5) s -= 3;
  return s;
}

function normalizePageUrl(u: URL): string {
  const withoutHash = new URL(u.href);
  withoutHash.hash = "";
  let path = withoutHash.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/") path = path.replace(/\/+$/, "");
  return `${withoutHash.origin}${path}${withoutHash.search}`;
}

/**
 * From Jina markdown for a page, extract same-origin links and return up to `maxExtra`
 * candidates (excluding the homepage URL), sorted by likely relevance.
 */
export function discoverInternalPageUrls(
  homepageUrl: string,
  homepageMarkdown: string,
  maxExtra: number
): string[] {
  let origin: URL;
  try {
    origin = new URL(homepageUrl);
  } catch {
    return [];
  }

  const originHost = normalizeHost(origin.hostname);
  const seen = new Set<string>();
  const scored: { url: string; score: number }[] = [];

  function consider(raw: string): void {
    let u: URL;
    try {
      u = new URL(raw.trim(), origin);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (normalizeHost(u.hostname) !== originHost) return;
    if (EXCLUDE_PATH.test(u.pathname)) return;
    const norm = normalizePageUrl(u);
    if (seen.has(norm)) return;
    seen.add(norm);
    scored.push({
      url: norm,
      score: scorePathname(u.pathname),
    });
  }

  const mdLink = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(homepageMarkdown))) {
    consider(m[2]);
  }

  const bare = /https?:\/\/[^\s<>)\]"']+/gi;
  while ((m = bare.exec(homepageMarkdown))) {
    consider(m[0]);
  }

  let homeNorm: string;
  try {
    homeNorm = normalizePageUrl(new URL(homepageUrl));
  } catch {
    homeNorm = homepageUrl;
  }

  const filtered = scored.filter((s) => s.url !== homeNorm);
  filtered.sort((a, b) => b.score - a.score);

  return filtered.slice(0, maxExtra).map((x) => x.url);
}
