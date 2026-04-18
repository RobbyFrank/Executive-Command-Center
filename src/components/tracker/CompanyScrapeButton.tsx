"use client";

import { useState } from "react";
import type { CompanyWithGoals, Person } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";
import { CompanyScrapeDialog } from "./CompanyScrapeDialog";
import { SlackLogo } from "./SlackLogo";

export function CompanyScrapeButton({
  company,
  people,
}: {
  company: CompanyWithGoals;
  people: Person[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "flex items-stretch transition-opacity duration-150 motion-reduce:transition-none",
          "opacity-55 pointer-events-auto",
          "sm:group-hover/companyHeader:opacity-100",
          "sm:group-focus-within/companyHeader:opacity-100",
          open && "opacity-100"
        )}
      >
        <button
          type="button"
          title="Sync goals and projects from Slack"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-900/40 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors",
            "group-hover/companyHeader:border-violet-500/45 group-hover/companyHeader:bg-violet-950/70 group-hover/companyHeader:text-violet-100/95 group-hover/companyHeader:shadow-sm group-hover/companyHeader:shadow-black/25",
            "hover:border-violet-400/60 hover:bg-violet-950/95 hover:text-white",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/70"
          )}
          aria-label={`Sync from Slack for ${company.name}`}
        >
          <SlackLogo alt="" className="h-3.5 w-3.5 opacity-80 group-hover/companyHeader:opacity-95" />
          <span className="whitespace-nowrap">Sync from Slack</span>
        </button>
      </div>
      <CompanyScrapeDialog
        open={open}
        onClose={() => setOpen(false)}
        company={company}
        people={people}
      />
    </>
  );
}
