import type { Company, Goal } from "@/lib/types/tracker";
import type { SlackChannel } from "@/lib/slack";

/** Lowercase substrings to match in channel name, topic, or purpose (non-empty only). */
export function companyFilterTerms(
  companyName: string | undefined,
  companyShortName: string | undefined
): string[] {
  const out: string[] = [];
  const n = companyName?.trim();
  const s = companyShortName?.trim();
  if (n) out.push(n.toLowerCase());
  if (s) out.push(s.toLowerCase());
  return out;
}

export function channelMatchesCompanyTerms(
  ch: SlackChannel,
  termsLower: string[]
): boolean {
  if (termsLower.length === 0) return true;
  const hay = `${ch.name}\n${ch.topic}\n${ch.purpose}`.toLowerCase();
  return termsLower.some((t) => hay.includes(t));
}

export type CompanyScrapeChannelRow = {
  id: string;
  name: string;
  /** From Slack metadata when the channel appears in `allChannels`; unset if unknown. */
  isPrivate?: boolean;
  /** Goals under this company that reference this channel id. */
  linkedToGoalIds: string[];
  /** True when name/topic/purpose matched company name or shortName. */
  matchedByName: boolean;
};

const TEST_IN_NAME = /\btest\b/i;

/**
 * Default checkbox state when the Slack scan dialog opens: **selected** unless the channel
 * is clearly **public** (`isPrivate === false`) or its **name** contains the word `test`
 * (case-insensitive; word-boundary match so e.g. `contest` is not excluded).
 * Unknown privacy (e.g. goal-linked id missing from the list) stays **selected** unless the name matches.
 */
export function slackScrapeChannelSelectedByDefault(
  row: CompanyScrapeChannelRow
): boolean {
  if (TEST_IN_NAME.test(row.name)) return false;
  if (row.isPrivate === false) return false;
  return true;
}

/**
 * Union of (a) workspace channels whose name/topic/purpose match the company and
 * (b) channels referenced by this company's goals via `slackChannelId`.
 */
export function resolveCompanyScrapeChannels({
  company,
  goalsForCompany,
  allChannels,
}: {
  company: Company;
  goalsForCompany: Goal[];
  allChannels: SlackChannel[];
}): CompanyScrapeChannelRow[] {
  const terms = companyFilterTerms(company.name, company.shortName);
  const byId = new Map<string, CompanyScrapeChannelRow>();

  for (const ch of allChannels) {
    if (!channelMatchesCompanyTerms(ch, terms)) continue;
    byId.set(ch.id, {
      id: ch.id,
      name: ch.name,
      isPrivate: ch.isPrivate,
      linkedToGoalIds: [],
      matchedByName: true,
    });
  }

  for (const g of goalsForCompany) {
    const cid = (g.slackChannelId ?? "").trim();
    if (!cid) continue;
    const existing = byId.get(cid);
    if (existing) {
      if (!existing.linkedToGoalIds.includes(g.id)) {
        existing.linkedToGoalIds.push(g.id);
      }
      continue;
    }
    const chMeta = allChannels.find((c) => c.id === cid);
    byId.set(cid, {
      id: cid,
      name: chMeta?.name ?? (g.slackChannel.trim() || cid),
      isPrivate: chMeta?.isPrivate,
      linkedToGoalIds: [g.id],
      matchedByName: false,
    });
  }

  const rows = [...byId.values()];
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
