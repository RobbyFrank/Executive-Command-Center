const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}
