import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/anthropicModel";
import { fetchJinaMarkdown } from "@/lib/jinaReader";
import { discoverInternalPageUrls } from "@/lib/websitePageDiscovery";

const MAX_PAGES_PER_SITE = 10;
const MAX_INTERNAL_LINKS = 9;
const SCRAPE_CONCURRENCY = 6;
const MAX_CHARS_PER_PAGE = 85_000;
const MAX_COMBINED_FOR_MODEL = 420_000;

export type UrlScrapeStatus = "queued" | "running" | "done" | "failed";

export type ProgressPayload =
  | {
      type: "progress";
      phase: "scraping" | "summarizing";
      /** Per-URL status (parallel scrapes update multiple rows at once) */
      entries: { url: string; status: UrlScrapeStatus }[];
      completed: number;
      total: number;
      message?: string;
    }
  | { type: "done"; description: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function normalizeInputUrl(line: string): string | null {
  const t = line.trim();
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[…truncated…]`;
}

async function runPool(
  items: string[],
  concurrency: number,
  worker: (item: string) => Promise<void>,
  signal: AbortSignal | undefined
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function runWorker() {
    while (true) {
      throwIfAborted(signal);
      const i = next++;
      if (i >= items.length) break;
      await worker(items[i]);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => runWorker()));
}

export async function runCompanyDescriptionPipeline(
  rawUrl: string,
  signal: AbortSignal | undefined,
  onProgress: (p: ProgressPayload) => void
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    onProgress({
      type: "error",
      message: "ANTHROPIC_API_KEY is not configured",
    });
    return;
  }

  const base = normalizeInputUrl(rawUrl);
  if (!base) {
    onProgress({
      type: "error",
      message: "Enter a valid http(s) URL",
    });
    return;
  }

  const pages: { url: string; markdown: string }[] = [];
  const entries: { url: string; status: UrlScrapeStatus }[] = [];

  const emit = () => {
    const doneOrFailed = entries.filter(
      (e) => e.status === "done" || e.status === "failed"
    ).length;
    onProgress({
      type: "progress",
      phase: "scraping",
      entries: entries.map((e) => ({ ...e })),
      completed: doneOrFailed,
      total: entries.length,
    });
  };

  try {
    throwIfAborted(signal);

    entries.push({ url: base, status: "running" });
    emit();

    const home = await fetchJinaMarkdown(base, signal);
    if (!home.ok) {
      entries[0].status = "failed";
      emit();
      onProgress({
        type: "error",
        message: `Could not read ${base}. Check the URL or try again later.`,
      });
      return;
    }

    entries[0].status = "done";
    pages.push({
      url: base,
      markdown: truncate(home.markdown, MAX_CHARS_PER_PAGE),
    });
    emit();

    const extraUrls = discoverInternalPageUrls(
      base,
      home.markdown,
      MAX_INTERNAL_LINKS
    ).slice(0, MAX_PAGES_PER_SITE - 1);

    for (const u of extraUrls) {
      entries.push({ url: u, status: "queued" });
    }
    emit();

    await runPool(
      extraUrls,
      SCRAPE_CONCURRENCY,
      async (url) => {
        throwIfAborted(signal);
        const ent = entries.find((e) => e.url === url);
        if (!ent) return;
        ent.status = "running";
        emit();

        try {
          const r = await fetchJinaMarkdown(url, signal);
          ent.status = r.ok ? "done" : "failed";
          if (r.ok) {
            pages.push({
              url,
              markdown: truncate(r.markdown, MAX_CHARS_PER_PAGE),
            });
          }
        } catch (e) {
          if (isAbortError(e)) throw e;
          ent.status = "failed";
        }
        emit();
      },
      signal
    );

    throwIfAborted(signal);

    if (pages.length === 0) {
      onProgress({
        type: "error",
        message: "No page content could be scraped.",
      });
      return;
    }

    onProgress({
      type: "progress",
      phase: "summarizing",
      entries: entries.map((e) => ({ ...e })),
      completed: entries.length,
      total: entries.length,
      message: "Summarizing with Claude…",
    });

    let combined = pages
      .map((p) => `### Source: ${p.url}\n\n${p.markdown}`)
      .join("\n\n---\n\n");

    if (combined.length > MAX_COMBINED_FOR_MODEL) {
      combined = `${combined.slice(0, MAX_COMBINED_FOR_MODEL)}\n\n[…truncated for model context…]`;
    }

    throwIfAborted(signal);

    const anthropic = new Anthropic({ apiKey });
    const model = getAnthropicModel();

    const msg = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: `You write clear company profile descriptions for an internal portfolio tracker (B2B SaaS / product studios). Output plain text only: 2–5 short paragraphs, or short paragraphs with optional bullet highlights. Be specific using only what appears in the source; do not invent customers, metrics, or funding. Avoid marketing fluff and vague superlatives.`,
      messages: [
        {
          role: "user",
          content: `Below is markdown scraped from the company website (multiple pages). Produce a single cohesive description (not a page-by-page summary).\n\n---\n\n${combined}`,
        },
      ],
    });

    throwIfAborted(signal);

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      onProgress({
        type: "error",
        message: "Claude returned no text",
      });
      return;
    }
    const description = block.text.trim();

    if (!description) {
      onProgress({
        type: "error",
        message: "Claude returned an empty description",
      });
      return;
    }

    onProgress({ type: "done", description });
  } catch (e) {
    if (isAbortError(e)) {
      onProgress({ type: "cancelled" });
      return;
    }
    const err = e instanceof Error ? e.message : String(e);
    onProgress({
      type: "error",
      message: err || "Unexpected error",
    });
  }
}
