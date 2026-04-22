const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Fast model for high-volume, structured classification (unreplied-asks scan, etc.). */
const DEFAULT_CLASSIFY_MODEL = "claude-haiku-4-5";

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Model for lightweight classify-once jobs (e.g. ask vs. not_ask). Override with
 * `ANTHROPIC_CLASSIFY_MODEL` when you want Sonnet or a pinned Haiku snapshot.
 */
export function getAnthropicClassifyModel(): string {
  return process.env.ANTHROPIC_CLASSIFY_MODEL?.trim() || DEFAULT_CLASSIFY_MODEL;
}
