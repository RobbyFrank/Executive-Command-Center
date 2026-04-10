import { isAbortError } from "@/lib/abortError";

const JINA_READER_PREFIX = "https://r.jina.ai/";

function isJinaErrorPayload(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    return false;
  }
  return (parsed as { data: unknown }).data === null;
}

/**
 * Fetches markdown for a public URL via Jina Reader (`https://r.jina.ai/{{url}}`).
 * Pass `signal` to allow cancellation (throws on abort).
 */
export async function fetchJinaMarkdown(
  websiteUrl: string,
  signal?: AbortSignal
): Promise<{ ok: true; markdown: string } | { ok: false }> {
  const trimmed = websiteUrl.trim();
  if (!trimmed) return { ok: false };

  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }

  const jinaUrl = `${JINA_READER_PREFIX}${trimmed}`;

  let res: Response;
  try {
    res = await fetch(jinaUrl, {
      headers: {
        Accept: "application/json, text/markdown, text/plain, */*",
      },
      cache: "no-store",
      signal,
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { ok: false };
  }

  const text = await res.text();
  const body = text.trim();

  if (body.startsWith("{")) {
    try {
      const json: unknown = JSON.parse(body);
      if (isJinaErrorPayload(json)) {
        return { ok: false };
      }
      if (
        typeof json === "object" &&
        json !== null &&
        "data" in json &&
        typeof (json as { data: unknown }).data === "string" &&
        (json as { data: string }).data.length > 0
      ) {
        return { ok: true, markdown: (json as { data: string }).data };
      }
    } catch {
      // Not JSON; fall through to treat body as markdown when res.ok
    }
  }

  if (!res.ok) return { ok: false };
  if (!body) return { ok: false };

  return { ok: true, markdown: body };
}
