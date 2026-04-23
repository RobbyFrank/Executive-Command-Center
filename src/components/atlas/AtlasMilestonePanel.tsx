"use client";

import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { buildRoadmapHref } from "@/lib/roadmap-query";
import { cn } from "@/lib/utils";
import type {
  Milestone,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";

interface AtlasMilestonePanelProps {
  milestone: Milestone;
  project: ProjectWithMilestones;
  owner: Person | undefined;
  /** Label shown as the goal context (e.g. goal description). */
  goalDescription: string;
  /** Company display name. */
  companyName: string;
  onClose: () => void;
}

/**
 * Right-rail side panel shown at the deepest zoom level. Gives enough context
 * to act on the milestone and jumps to either Slack or the Roadmap (where the
 * full SlackThreadPopover is wired up).
 */
export function AtlasMilestonePanel({
  milestone,
  project,
  owner,
  goalDescription,
  companyName,
  onClose,
}: AtlasMilestonePanelProps) {
  const hasSlack = Boolean(milestone.slackUrl?.trim());
  const isDone = milestone.status === "Done";
  const statusColor = isDone
    ? "text-emerald-300"
    : "text-amber-200";

  const roadmapHref = buildRoadmapHref({
    focus: { goalId: project.goalId, projectId: project.id },
  });

  return (
    <aside
      className="pointer-events-auto absolute right-6 top-24 bottom-20 z-20 flex w-[22rem] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur"
      aria-label={`Milestone ${milestone.name}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-zinc-800/80 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
            Milestone
          </p>
          <h2 className="mt-1 truncate text-sm font-medium text-zinc-100">
            {milestone.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close milestone panel"
          className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <Row label="Status">
          <span className={cn("text-xs font-medium", statusColor)}>
            {isDone ? "Done" : "Not done"}
          </span>
        </Row>
        {milestone.targetDate ? (
          <Row label="Target date">
            <span className="text-xs text-zinc-300">{milestone.targetDate}</span>
          </Row>
        ) : null}
        <Row label="Project">
          <span className="text-xs text-zinc-300">{project.name}</span>
        </Row>
        <Row label="Goal">
          <span className="text-xs text-zinc-400 line-clamp-2">
            {goalDescription}
          </span>
        </Row>
        <Row label="Company">
          <span className="text-xs text-zinc-300">{companyName}</span>
        </Row>
        <Row label="Owner">
          <span className="text-xs text-zinc-300">
            {owner?.name ?? "Unassigned"}
            {owner?.role ? (
              <span className="text-zinc-500"> · {owner.role}</span>
            ) : null}
          </span>
        </Row>
      </div>

      <footer className="flex flex-col gap-2 border-t border-zinc-800/80 px-4 py-3">
        {hasSlack ? (
          <a
            href={milestone.slackUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600/90 px-3 py-2 text-xs font-medium text-zinc-950 transition-colors hover:bg-emerald-500"
          >
            Open Slack thread
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="inline-flex items-center justify-center rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
            No Slack thread linked
          </span>
        )}
        <Link
          href={roadmapHref}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          Open in Roadmap
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </footer>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
