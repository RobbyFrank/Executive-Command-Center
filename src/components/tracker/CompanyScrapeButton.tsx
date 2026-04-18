"use client";

import { useState } from "react";
import type { CompanyWithGoals } from "@/lib/types/tracker";
import { cn } from "@/lib/utils";
import { CompanyScrapeDialog } from "./CompanyScrapeDialog";
import { SlackLogo } from "./SlackLogo";

export function CompanyScrapeButton({
  company,
}: {
  company: CompanyWithGoals;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "flex items-stretch transition-opacity duration-150 motion-reduce:transition-none",
          "opacity-100 pointer-events-auto",
          "sm:opacity-0 sm:pointer-events-none",
          "sm:group-hover/companyHeader:opacity-100 sm:group-hover/companyHeader:pointer-events-auto",
          "sm:group-focus-within/companyHeader:opacity-100 sm:group-focus-within/companyHeader:pointer-events-auto",
          open && "pointer-events-auto opacity-100"
        )}
      >
        <button
          type="button"
          title="Find goals and projects to add from Slack"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-950/40 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors",
            "hover:border-zinc-600 hover:bg-zinc-800/70 hover:text-zinc-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
          )}
          aria-label={`Find more in Slack for ${company.name}`}
        >
          <SlackLogo alt="" className="h-3.5 w-3.5 opacity-95" />
          <span className="whitespace-nowrap">Find more</span>
        </button>
      </div>
      <CompanyScrapeDialog
        open={open}
        onClose={() => setOpen(false)}
        company={company}
      />
    </>
  );
}
