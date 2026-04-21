import type { ReactNode } from "react";
import { RoadmapStickyToolbar } from "./RoadmapStickyToolbar";

/** Sticky page title row shared by Roadmap, Team, and Companies. */
export function PageToolbar({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <RoadmapStickyToolbar>
      <div className="flex flex-wrap items-center gap-3 px-1 min-h-[2.25rem]">
        <h1 className="shrink-0 text-lg font-bold tracking-tight text-zinc-100 sm:text-xl">
          {title}
        </h1>
        {children}
      </div>
    </RoadmapStickyToolbar>
  );
}
