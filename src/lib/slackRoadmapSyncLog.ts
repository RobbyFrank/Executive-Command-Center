/**
 * Structured logging for the Slack → roadmap sync pipeline. Vercel Runtime Logs
 * capture stdout/stderr; one JSON object per line is easy to search and filter.
 *
 * In the Vercel dashboard, filter by: `ecc:slackRoadmapSync` (see {@link SLACK_ROADMAP_SYNC_LOG_SOURCE}).
 */
export const SLACK_ROADMAP_SYNC_LOG_SOURCE = "ecc:slackRoadmapSync" as const;

const TEXT_CHUNK_SIZE = 6000;

export type SlackRoadmapSyncLogLevel = "info" | "warn" | "error";

type BaseFields = Record<string, unknown>;

function emitLine(
  level: SlackRoadmapSyncLogLevel,
  fields: BaseFields
): void {
  const line = JSON.stringify({
    source: SLACK_ROADMAP_SYNC_LOG_SOURCE,
    ts: new Date().toISOString(),
    level,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * One JSON log line. Use a stable `event` string per call site (e.g. `cron_company`, `model_parse_error`).
 * Include `correlationId` (per company run) and optional `batchId` (multi-company jobs) for tracing.
 */
export function logSlackRoadmapSync(
  level: SlackRoadmapSyncLogLevel,
  fields: BaseFields
): void {
  emitLine(level, fields);
}

/**
 * Splits a long string over multiple log lines. Vercel (and some log sinks) cap line length; model dumps
 * can exceed that. Chunks are ordered by `textPart` / `textPartTotal` (1-based).
 */
export function logSlackRoadmapSyncLongText(
  level: SlackRoadmapSyncLogLevel,
  base: BaseFields,
  text: string
): void {
  if (!text.length) {
    emitLine(level, { ...base, textLength: 0, textEmpty: true });
    return;
  }
  const textPartTotal = Math.max(1, Math.ceil(text.length / TEXT_CHUNK_SIZE));
  for (let i = 0; i < textPartTotal; i += 1) {
    const textPart = i + 1;
    emitLine(level, {
      ...base,
      textLength: text.length,
      textPart,
      textPartTotal,
      text: text.slice(i * TEXT_CHUNK_SIZE, (i + 1) * TEXT_CHUNK_SIZE),
    });
  }
}
