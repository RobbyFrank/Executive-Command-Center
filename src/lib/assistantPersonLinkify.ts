/** Internal markdown link scheme — rendered as avatar + name in AssistantMarkdown. */
export const ECC_PERSON_SCHEME = "ecc-person:";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ASCII-style fold for matching assistant output to roster names (e.g. Andres vs Andrés). */
function asciiFold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export type AssistantPersonForLinkify = {
  id: string;
  name: string;
};

/**
 * Resolve a roster person from assistant output (plain text, link label, or bold)
 * using the same folding rules as linkify.
 * Matches exact folded names, or a longer assistant label that starts with a roster
 * name plus a space (e.g. roster "Dirk" vs model output "Dirk Van Meerveld").
 */
export function findPersonByDisplayName<T extends AssistantPersonForLinkify>(
  people: T[],
  displayText: string,
): T | undefined {
  const trimmed = displayText.trim();
  if (trimmed.length < 1) return undefined;
  const key = asciiFold(trimmed).toLowerCase();

  const sorted = [...people].sort(
    (a, b) => asciiFold(b.name.trim()).length - asciiFold(a.name.trim()).length,
  );

  for (const p of sorted) {
    const pn = p.name.trim();
    if (pn.length < 1) continue;
    const pk = asciiFold(pn).toLowerCase();
    if (key === pk) return p;
    if (key.startsWith(pk + " ")) return p;
  }
  return undefined;
}

/**
 * Wraps known roster names in markdown links so the assistant UI can render
 * profile photos. Skips fenced and inline code. Does not match the local part
 * of an email (`name@`). Uses Unicode-aware boundaries so accented names match.
 */
export function linkifyAssistantPeople(
  markdown: string,
  people: AssistantPersonForLinkify[],
): string {
  const filtered = people
    .map((p) => ({ id: p.id, name: p.name.trim() }))
    .filter((p) => p.name.length >= 2);
  if (!filtered.length) return markdown;

  /** Canonical person keyed by asciiFold(name).toLowerCase() — first wins on collision. */
  const byFoldedLower = new Map<string, { id: string; name: string }>();
  for (const p of filtered) {
    const k = asciiFold(p.name).toLowerCase();
    if (!byFoldedLower.has(k)) byFoldedLower.set(k, p);
  }

  const patternParts: string[] = [];
  const seenRegex = new Set<string>();
  for (const p of filtered) {
    const variants = new Set<string>();
    variants.add(p.name);
    const folded = asciiFold(p.name);
    if (folded !== p.name) variants.add(folded);
    for (const v of variants) {
      const esc = escapeRegex(v);
      if (seenRegex.has(esc)) continue;
      seenRegex.add(esc);
      patternParts.push(esc);
    }
  }

  patternParts.sort((a, b) => b.length - a.length);
  const pattern = patternParts.join("|");
  if (!pattern) return markdown;

  const re = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(${pattern})(?![\\p{L}\\p{M}\\p{N}])`,
    "giu",
  );

  function lookup(g1: string): { id: string; name: string } | undefined {
    return byFoldedLower.get(asciiFold(g1).toLowerCase());
  }

  function processChunk(chunk: string): string {
    return chunk.replace(re, (full, g1: string, offset: number) => {
      if (offset > 0 && chunk[offset - 1] === "[") {
        return full;
      }

      const rest = chunk.slice(offset + full.length);
      if (rest.startsWith("@")) return full;

      const p = lookup(g1);
      if (!p) return full;

      const restAfter = chunk.slice(offset + full.length);
      if (
        p.name.trim().split(/\s+/).length === 1 &&
        /^ +[\p{Lu}]/u.test(restAfter)
      ) {
        return full;
      }

      return `[${p.name}](${ECC_PERSON_SCHEME}${p.id})`;
    });
  }

  const fenceSplit = markdown.split(/(```[\s\S]*?```)/g);
  return fenceSplit
    .map((piece) => {
      if (piece.startsWith("```")) return piece;
      const inlineSplit = piece.split(/(`[^`]+`)/g);
      return inlineSplit
        .map((inlinePiece) => {
          if (inlinePiece.startsWith("`") && inlinePiece.endsWith("`")) {
            return inlinePiece;
          }
          return processChunk(inlinePiece);
        })
        .join("");
    })
    .join("");
}
