/**
 * Best-effort logo discovery for a company website. Fetches the homepage HTML and
 * picks the most likely "brand mark" URL from common meta/link tags.
 *
 * Priority order (square brand marks beat marketing banners):
 *   1. <link rel="apple-touch-icon" sizes="..." href="..."> (largest size first)
 *   2. <link rel="apple-touch-icon-precomposed" ...>
 *   3. <link rel="icon" sizes="..."> (largest size; skip .ico unless nothing else)
 *   4. <meta property="og:image" content="..."> / og:image:url / twitter:image
 *   5. /favicon.ico fallback (often the only icon for very minimal sites)
 */

const FETCH_TIMEOUT_MS = 12_000;

const BROWSER_LIKE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; ExecutiveCommandCenter/1.0; +logo-discovery)",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface HtmlLink {
  rel: string;
  href: string;
  /** Largest dimension parsed from `sizes` (e.g. `180x180` → 180). 0 when unknown. */
  size: number;
}

interface HtmlMeta {
  /** `property` or `name` attribute value, lowercased. */
  key: string;
  content: string;
}

function ensureHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function getAttr(tag: string, name: string): string | null {
  // Captures attribute value (single quote, double quote, or unquoted).
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s'">]+))`,
    "i"
  );
  const m = tag.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

function parseSizes(raw: string | null): number {
  if (!raw) return 0;
  // sizes can be "any", "32x32", "16x16 32x32 180x180", etc.
  let max = 0;
  for (const piece of raw.split(/\s+/)) {
    const m = piece.match(/^(\d+)x(\d+)$/i);
    if (m) {
      const v = Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return max;
}

function extractHeadHtml(html: string): string {
  const lower = html.toLowerCase();
  const start = lower.indexOf("<head");
  const end = lower.indexOf("</head>");
  if (start === -1 || end === -1 || end <= start) return html;
  return html.slice(start, end + 7);
}

function parseLinkTags(headHtml: string): HtmlLink[] {
  const links: HtmlLink[] = [];
  const tagRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(headHtml)) !== null) {
    const tag = m[0];
    const rel = getAttr(tag, "rel");
    const href = getAttr(tag, "href");
    if (!rel || !href) continue;
    links.push({
      rel: rel.toLowerCase(),
      href,
      size: parseSizes(getAttr(tag, "sizes")),
    });
  }
  return links;
}

function parseMetaTags(headHtml: string): HtmlMeta[] {
  const metas: HtmlMeta[] = [];
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(headHtml)) !== null) {
    const tag = m[0];
    const property = getAttr(tag, "property");
    const name = getAttr(tag, "name");
    const content = getAttr(tag, "content");
    if (!content) continue;
    const key = (property ?? name ?? "").toLowerCase();
    if (!key) continue;
    metas.push({ key, content });
  }
  return metas;
}

function pickBiggest(links: HtmlLink[], rels: string[]): HtmlLink | null {
  const matches = links.filter((l) =>
    l.rel.split(/\s+/).some((r) => rels.includes(r))
  );
  if (matches.length === 0) return null;
  // Prefer the largest declared size; ties broken by first-declared.
  return matches.reduce<HtmlLink | null>((best, cur) => {
    if (!best) return cur;
    return cur.size > best.size ? cur : best;
  }, null);
}

function isLikelyImageHref(href: string): boolean {
  // Excludes obvious non-image hrefs (rss, manifest, etc.). We allow `.ico`.
  return !/\.(json|webmanifest|xml|atom|rss|txt)(\?|$)/i.test(href);
}

function resolveAgainst(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

interface DiscoverResult {
  imageUrl: string;
  /** Why we picked this candidate (for logs). */
  source: string;
}

/**
 * Fetch the company homepage and return the best logo image URL we can find,
 * resolved to an absolute https URL. Returns `null` when nothing usable is found.
 */
export async function discoverCompanyLogoUrl(
  websiteUrl: string,
  signal?: AbortSignal
): Promise<DiscoverResult | null> {
  const base = ensureHttpUrl(websiteUrl);
  if (!base) return null;

  let res: Response;
  try {
    res = await fetch(base, {
      redirect: "follow",
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: BROWSER_LIKE_HEADERS,
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct && !ct.includes("html") && !ct.includes("xml")) {
    // Homepage isn't HTML — skip parsing and try favicon-only fallback.
    return faviconFallback(res.url || base);
  }

  // Cap how much HTML we parse (avoid huge SPA dumps blowing memory).
  const reader = res.body?.getReader();
  let html = "";
  if (reader) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const MAX_BYTES = 512 * 1024; // 512KB of head is more than enough.
    let total = 0;
    try {
      while (total < MAX_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          html += decoder.decode(value, { stream: true });
          if (html.toLowerCase().includes("</head>")) break;
        }
      }
    } catch {
      // Network mid-stream errors are OK — work with what we have.
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  } else {
    html = await res.text();
  }

  const finalUrl = res.url || base;
  const head = extractHeadHtml(html);
  const links = parseLinkTags(head).filter((l) => isLikelyImageHref(l.href));
  const metas = parseMetaTags(head);

  const apple = pickBiggest(links, [
    "apple-touch-icon",
    "apple-touch-icon-precomposed",
  ]);
  if (apple) {
    const abs = resolveAgainst(finalUrl, apple.href);
    if (abs) return { imageUrl: abs, source: "apple-touch-icon" };
  }

  // Prefer non-.ico icons (PNG/SVG) and largest size.
  const iconCandidates = links.filter((l) =>
    l.rel.split(/\s+/).some((r) => r === "icon" || r === "shortcut")
  );
  const nonIco = iconCandidates.filter((l) => !/\.ico(\?|$)/i.test(l.href));
  const bestNonIco = nonIco.reduce<HtmlLink | null>((best, cur) => {
    if (!best) return cur;
    return cur.size > best.size ? cur : best;
  }, null);
  if (bestNonIco) {
    const abs = resolveAgainst(finalUrl, bestNonIco.href);
    if (abs) return { imageUrl: abs, source: "link rel=icon" };
  }

  const ogKeys = ["og:image", "og:image:url", "og:image:secure_url"];
  for (const k of ogKeys) {
    const meta = metas.find((m) => m.key === k);
    if (meta) {
      const abs = resolveAgainst(finalUrl, meta.content);
      if (abs) return { imageUrl: abs, source: k };
    }
  }
  const twitter = metas.find((m) => m.key === "twitter:image");
  if (twitter) {
    const abs = resolveAgainst(finalUrl, twitter.content);
    if (abs) return { imageUrl: abs, source: "twitter:image" };
  }

  // Fall back to .ico icons if nothing else surfaced.
  const bestIco = iconCandidates.reduce<HtmlLink | null>((best, cur) => {
    if (!best) return cur;
    return cur.size > best.size ? cur : best;
  }, null);
  if (bestIco) {
    const abs = resolveAgainst(finalUrl, bestIco.href);
    if (abs) return { imageUrl: abs, source: "link rel=icon (ico)" };
  }

  return faviconFallback(finalUrl);
}

function faviconFallback(finalUrl: string): DiscoverResult | null {
  try {
    const u = new URL(finalUrl);
    return {
      imageUrl: `${u.origin}/favicon.ico`,
      source: "favicon.ico fallback",
    };
  } catch {
    return null;
  }
}
