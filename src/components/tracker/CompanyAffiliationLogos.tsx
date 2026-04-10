"use client";

import type { Company } from "@/lib/types/tracker";

function companyForToken(token: string, companies: Company[]): Company | undefined {
  const t = token.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  return companies.find(
    (c) =>
      c.shortName.trim().toLowerCase() === lower || c.id.toLowerCase() === lower
  );
}

interface CompanyAffiliationLogosProps {
  /** Comma-separated company short names or IDs (matches `Company.id`). */
  shortListCsv: string;
  companies: Company[];
}

/**
 * Roster display: one logo per affiliated company; if `logoPath` is empty,
 * shows the short name in a compact badge.
 */
export function CompanyAffiliationLogos({
  shortListCsv,
  companies,
}: CompanyAffiliationLogosProps) {
  const tokens = shortListCsv.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return <span className="text-zinc-600 italic">—</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
      {tokens.map((token, i) => {
        const c = companyForToken(token, companies);
        if (!c) {
          return (
            <span
              key={`unknown-${i}`}
              className="font-mono text-xs text-amber-500/90"
              title="Unknown company token"
            >
              {token}
            </span>
          );
        }

        if (c.logoPath?.trim()) {
          return (
            // eslint-disable-next-line @next/next/no-img-element -- local uploads under /public
            <img
              key={c.id}
              src={c.logoPath}
              alt=""
              title={c.name}
              className="h-8 w-8 shrink-0 rounded-md border border-zinc-700 object-cover"
            />
          );
        }

        return (
          <span
            key={c.id}
            title={c.name}
            className="inline-flex min-h-8 min-w-8 max-w-[5rem] items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 px-1 font-mono text-xs leading-tight text-zinc-300"
          >
            {c.shortName}
          </span>
        );
      })}
    </span>
  );
}
