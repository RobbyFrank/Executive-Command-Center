import type { AssistantEntityTag } from "@/contexts/AssistantContext";

/** Inline mention syntax embedded in the composer (parsed on the server for focus blocks). */
export const ECC_MENTION_RE_GLOBAL = new RegExp(
  "\\[([^\\]]+)\\]\\(ecc:(company|goal|project|milestone):([^)]+)\\)",
  "g",
);

export type ParsedEccMention = {
  type: AssistantEntityTag["type"];
  id: string;
  label: string;
};

export function sanitizeMentionLabel(label: string): string {
  return label.replace(/\]/g, "›");
}

export function formatMentionLink(
  type: AssistantEntityTag["type"],
  id: string,
  label: string,
): string {
  return `[${sanitizeMentionLabel(label)}](ecc:${type}:${id})`;
}

export function parseEccMentionsFromText(text: string): ParsedEccMention[] {
  const out: ParsedEccMention[] = [];
  const re = new RegExp(ECC_MENTION_RE_GLOBAL.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      type: m[2] as ParsedEccMention["type"],
      id: m[3],
      label: m[1],
    });
  }
  return out;
}

export function mentionKey(type: string, id: string): string {
  return `${type}:${id}`;
}
