/**
 * Reads newline-delimited JSON from a Response body (e.g. streaming API routes).
 */
export async function consumeNdjsonStream<T = unknown>(
  res: Response,
  onPayload: (p: T) => void,
  signal?: AbortSignal
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        onPayload(JSON.parse(t) as T);
      } catch {
        // ignore malformed chunks
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      onPayload(JSON.parse(tail) as T);
    } catch {
      // ignore
    }
  }
}
