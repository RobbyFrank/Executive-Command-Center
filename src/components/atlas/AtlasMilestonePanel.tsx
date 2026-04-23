"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  Circle,
  ExternalLink,
  Sparkles,
  X,
} from "lucide-react";
import { buildRoadmapHref } from "@/lib/roadmap-query";
import { cn } from "@/lib/utils";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { updateMilestone } from "@/server/actions/tracker";
import { useSlackThreadStatus } from "@/hooks/useSlackThreadStatus";
import { useMilestoneLikelihood } from "@/hooks/useMilestoneLikelihood";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
  getMilestoneDueHorizon,
  type MilestoneDueHorizon,
} from "@/lib/relativeCalendarDate";
import { displayInitials } from "@/lib/displayInitials";
import { MilestoneSlackThreadInline } from "@/components/tracker/MilestoneSlackThreadInline";
import { PriorityPillInline } from "@/components/tracker/PriorityPillInline";
import {
  SlackMilestoneThreadPopovers,
  type SlackPingMode,
} from "@/components/tracker/SlackMilestoneThreadPopovers";
import { SlackCreateThreadDialog } from "@/components/tracker/SlackCreateThreadDialog";
import { SlackLogo } from "@/components/tracker/SlackLogo";
import type {
  Milestone,
  Person,
  ProjectWithMilestones,
} from "@/lib/types/tracker";

interface AtlasMilestonePanelProps {
  milestone: Milestone;
  project: ProjectWithMilestones;
  owner: Person | undefined;
  /** Parent goal description (shown as context + used by AI for drafting). */
  goalDescription: string;
  /** Parent goal priority (P0..P3) — shown as a pill alongside the project's. */
  goalPriority: string;
  /** Parent goal Slack channel ID — required to draft a brand-new thread. */
  goalSlackChannelId: string;
  /** Parent goal Slack channel display name (e.g. "#voicedrop-goals"). */
  goalSlackChannelName: string;
  /** Company display name (shown in info rows + draft context). */
  companyName: string;
  /** Company logo (site path under /public); empty string when not set. */
  companyLogoPath: string;
  /** Full roster — powers Slack popover author avatars + ping/nudge/reply dialogs. */
  people: Person[];
  /**
   * Sibling milestones (same project) — fed to the AI as roadmap context so
   * likelihood & draft prompts match what the Roadmap page produces.
   */
  siblingMilestones: Milestone[];
  onClose: () => void;
}

/**
 * Right-rail side panel shown at the deepest Atlas zoom level.
 *
 * Renders the same live Slack thread preview + AI-drafted action surface
 * that the Roadmap page uses for its milestone rows: live thread status,
 * deadline likelihood, reply author + snippet, and Reply / Nudge / Ping
 * popovers (with AI-drafted messages). When no Slack thread is linked, the
 * panel exposes a "Draft new Slack thread" flow identical to Roadmap's.
 *
 * Panel structure (top → bottom):
 *  - Header: milestone title + priority pill + close.
 *  - Due-date hero: big relative "in 5 days" / "2 days ago" + absolute date.
 *  - Mark done toggle.
 *  - Slack thread preview (auto-opens the full-fat popover on mount).
 *  - Context rows with real avatars/logos (project, goal, company, owner).
 *  - Footer: Open in Slack / Open in Roadmap.
 */
export function AtlasMilestonePanel({
  milestone,
  project,
  owner,
  goalDescription,
  goalPriority,
  goalSlackChannelId,
  goalSlackChannelName,
  companyName,
  companyLogoPath,
  people,
  siblingMilestones,
  onClose,
}: AtlasMilestonePanelProps) {
  const isDone = milestone.status === "Done";
  const slackUrlTrimmed = milestone.slackUrl.trim();
  const hasSlackThreadUrl = isValidHttpUrl(slackUrlTrimmed);

  // Same hooks the Roadmap's MilestoneRow uses — guarantees identical data
  // (cached thread status, cached AI likelihood, etc.).
  const slackThread = useSlackThreadStatus(
    hasSlackThreadUrl ? slackUrlTrimmed : null,
    people
  );

  // Sibling-milestone summary gives the AI the same project-level context
  // as Roadmap so the drafted pings/nudges reference the right work.
  const milestonesSummary = useMemo(
    () =>
      siblingMilestones
        .map(
          (m) =>
            `- ${m.name} [${m.status}]${m.targetDate ? ` ${m.targetDate}` : ""}`
        )
        .join("\n"),
    [siblingMilestones]
  );
  const roadmapContext = useMemo(() => {
    const parts: string[] = [];
    if (project.name.trim()) parts.push(`Project: ${project.name}`);
    if (milestonesSummary) parts.push(`Milestones:\n${milestonesSummary}`);
    return parts.length ? parts.join("\n\n") : undefined;
  }, [project.name, milestonesSummary]);

  const threadReplyCountForLikelihood = slackThread.loading
    ? null
    : (slackThread.status?.replyCount ?? null);

  const milestoneLikelihood = useMilestoneLikelihood({
    slackUrl: hasSlackThreadUrl ? slackUrlTrimmed : null,
    milestoneName: milestone.name,
    targetDate: milestone.targetDate,
    ownerAutonomy: owner?.autonomyScore ?? null,
    projectComplexity: project.complexityScore ?? 3,
    rosterHints: slackThread.rosterHints,
    roadmapContext,
    threadReplyCount: hasSlackThreadUrl ? threadReplyCountForLikelihood : null,
  });

  // Popover anchors + open state (mirrors MilestoneRow's wiring).
  const threadAnchorRef = useRef<HTMLButtonElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const [threadPopoverOpen, setThreadPopoverOpen] = useState(false);
  const [threadPingOpen, setThreadPingOpen] = useState(false);
  const [pingMode, setPingMode] = useState<SlackPingMode>("ping");
  const [createThreadOpen, setCreateThreadOpen] = useState(false);

  // Close the full thread popover when the focused milestone changes so
  // switching milestones never leaves a stale popover layered over the new
  // panel. The user opens the popover explicitly via the inline preview
  // click or the "View full thread" button below.
  useEffect(() => {
    setThreadPopoverOpen(false);
  }, [milestone.id]);

  const roadmapHref = buildRoadmapHref({
    focus: { goalId: project.goalId, projectId: project.id },
  });

  const canCreateSlackThread = Boolean(goalSlackChannelId.trim());

  // Due-date hero: relative phrase (green→amber→rose by horizon) + absolute
  // date. Uses the same horizon classification as Roadmap's milestone chip.
  const dueHorizon: MilestoneDueHorizon = milestone.targetDate.trim()
    ? getMilestoneDueHorizon(milestone.targetDate)
    : "none";
  const dueRelative = milestone.targetDate.trim()
    ? formatRelativeCalendarDate(milestone.targetDate)
    : "";
  const dueAbsolute = milestone.targetDate.trim()
    ? formatCalendarDateHint(milestone.targetDate)
    : "";
  const dueColorClass = dueHorizonColorClass(dueHorizon, isDone);
  const dueLabel = dueRelative ? capitalizeFirst(`due ${dueRelative}`) : "";

  const ownerInitials = owner ? displayInitials(owner.name) : "?";
  const ownerAvatar = owner?.profilePicturePath?.trim() ?? "";
  const companyLogo = companyLogoPath.trim();

  return (
    <aside
      ref={spotlightRef}
      className="pointer-events-auto absolute right-4 top-24 bottom-20 z-20 flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur"
      aria-label={`Milestone ${milestone.name}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-zinc-800/80 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
              Milestone
            </p>
            {project.priority ? (
              <PriorityPillInline priority={project.priority} />
            ) : null}
          </div>
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Due-date hero — the single most important datum on the panel. */}
        {milestone.targetDate.trim() ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2.5",
              dueColorClass.border,
              dueColorClass.bg
            )}
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
              {isDone ? "Was due" : "Due"}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[15px] font-semibold leading-tight",
                isDone ? "text-zinc-300 line-through" : dueColorClass.text
              )}
              title={dueAbsolute}
            >
              {dueLabel}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {milestone.targetDate}
              {dueAbsolute ? ` · ${dueAbsolute}` : ""}
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
              Due
            </p>
            <p className="mt-0.5 text-[13px] text-zinc-500">No target date</p>
          </div>
        )}

        {/* Quick toggle: mark done / not done. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void updateMilestone(milestone.id, {
                status: isDone ? "Not Done" : "Done",
              })
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
              isDone
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                : "border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
            )}
            title={isDone ? "Mark not done" : "Mark done"}
          >
            {isDone ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Circle className="h-3.5 w-3.5" />
            )}
            {isDone ? "Done" : "Mark done"}
          </button>
        </div>

        {/* Slack thread: live preview or CTA. */}
        <section>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
            Slack thread
          </p>
          {hasSlackThreadUrl ? (
            <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 p-1.5">
              <MilestoneSlackThreadInline
                ref={threadAnchorRef}
                status={slackThread.status}
                loading={slackThread.loading}
                error={slackThread.error}
                onOpen={() => setThreadPopoverOpen(true)}
                likelihood={
                  milestoneLikelihood.result && milestone.targetDate.trim()
                    ? {
                        likelihood: milestoneLikelihood.result.likelihood,
                        progressEstimate:
                          milestoneLikelihood.result.progressEstimate,
                        riskLevel: milestoneLikelihood.result.riskLevel,
                      }
                    : null
                }
                likelihoodLoading={
                  Boolean(milestone.targetDate.trim()) &&
                  milestoneLikelihood.loading
                }
              />
              <div className="mt-1 flex items-center justify-between gap-2 px-1">
                <p className="text-[10px] text-zinc-600">
                  Click the thread to reply, nudge, or ping the owner.
                </p>
                <button
                  type="button"
                  onClick={() => setThreadPopoverOpen((v) => !v)}
                  className="shrink-0 rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                >
                  {threadPopoverOpen ? "Hide thread" : "View full thread"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-dashed border-zinc-800 bg-zinc-900/20 p-3">
              <p className="text-[11px] text-zinc-400">
                No Slack thread linked yet.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCreateThreadOpen(true)}
                  disabled={!canCreateSlackThread}
                  title={
                    canCreateSlackThread
                      ? "Draft a new Slack thread with AI"
                      : "Set a Slack channel on the parent goal first"
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    canCreateSlackThread
                      ? "bg-violet-600/90 text-zinc-50 hover:bg-violet-500"
                      : "cursor-not-allowed border border-zinc-800 text-zinc-600"
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Draft with AI
                </button>
                <Link
                  href={roadmapHref}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
                >
                  <SlackLogo className="h-3.5 w-3.5 opacity-80" />
                  Attach URL in Roadmap
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Context rows — real avatars/logos, not text only. */}
        <section className="space-y-3">
          <Row label="Project">
            <span className="text-xs text-zinc-200">{project.name}</span>
          </Row>
          <Row label="Goal">
            <div className="flex items-start gap-2">
              {goalPriority ? (
                <PriorityPillInline priority={goalPriority} />
              ) : null}
              <span className="text-xs text-zinc-400 line-clamp-3 min-w-0 flex-1">
                {goalDescription || "—"}
              </span>
            </div>
          </Row>
          <Row label="Company">
            <div className="flex items-center gap-2">
              {companyLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={companyLogo}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-zinc-800"
                />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 ring-1 ring-zinc-800">
                  <Building2 className="h-3.5 w-3.5 text-zinc-500" />
                </div>
              )}
              <span className="text-xs text-zinc-200">{companyName}</span>
            </div>
          </Row>
          <Row label="Owner">
            <div className="flex items-center gap-2">
              {ownerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ownerAvatar}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-zinc-700"
                />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-300 ring-1 ring-zinc-700">
                  {ownerInitials}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-200">
                  {owner?.name ?? "Unassigned"}
                </p>
                {owner?.role ? (
                  <p className="truncate text-[10px] text-zinc-500">
                    {owner.role}
                  </p>
                ) : null}
              </div>
            </div>
          </Row>
        </section>
      </div>

      <footer className="flex flex-col gap-2 border-t border-zinc-800/80 px-4 py-3">
        {hasSlackThreadUrl ? (
          <a
            href={slackUrlTrimmed}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 px-3 py-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
          >
            Open in Slack
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <Link
          href={roadmapHref}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 px-3 py-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          Open in Roadmap
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </footer>

      {/* Full-fat Slack thread popover (portal-mounted); same component as
          the Roadmap row, so the Reply / Nudge / Ping experience is
          identical here. */}
      {hasSlackThreadUrl ? (
        <SlackMilestoneThreadPopovers
          anchorRef={threadAnchorRef}
          spotlightRef={spotlightRef}
          goalDescription={goalDescription}
          projectName={project.name}
          goalSlackChannelId={goalSlackChannelId}
          goalSlackChannelName={goalSlackChannelName}
          people={people}
          slackUrl={slackUrlTrimmed}
          milestoneName={milestone.name}
          status={slackThread.status}
          rosterHints={slackThread.rosterHints}
          popoverOpen={threadPopoverOpen}
          onPopoverOpenChange={setThreadPopoverOpen}
          pingOpen={threadPingOpen}
          onPingOpenChange={setThreadPingOpen}
          pingMode={pingMode}
          onPingModeChange={setPingMode}
          onRefreshStatus={() => void slackThread.refresh({ force: true })}
          onPingSent={() => void slackThread.refresh({ force: true })}
          targetDate={milestone.targetDate}
          ownerName={owner?.name ?? null}
          ownerAutonomy={owner?.autonomyScore ?? null}
          projectComplexity={project.complexityScore ?? 3}
          likelihood={milestoneLikelihood.result}
          likelihoodLoading={milestoneLikelihood.loading}
          likelihoodError={milestoneLikelihood.error}
        />
      ) : null}

      <SlackCreateThreadDialog
        open={createThreadOpen}
        onClose={() => setCreateThreadOpen(false)}
        milestoneId={milestone.id}
        milestoneName={milestone.name}
        goalDescription={goalDescription}
        projectName={project.name}
        channelId={goalSlackChannelId.trim()}
        channelName={goalSlackChannelName}
        people={people}
        spotlightRef={spotlightRef}
      />
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

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return `${s[0]!.toUpperCase()}${s.slice(1)}`;
}

/** Panel hero colors by due horizon. Rose for overdue, amber close-due, emerald future, zinc done/none. */
function dueHorizonColorClass(
  horizon: MilestoneDueHorizon,
  isDone: boolean
): { border: string; bg: string; text: string } {
  if (isDone) {
    return {
      border: "border-zinc-800/80",
      bg: "bg-zinc-900/30",
      text: "text-zinc-400",
    };
  }
  switch (horizon) {
    case "overdue":
      return {
        border: "border-rose-500/40",
        bg: "bg-rose-950/30",
        text: "text-rose-300",
      };
    case "within24h":
    case "tomorrow":
      return {
        border: "border-orange-500/40",
        bg: "bg-orange-950/30",
        text: "text-orange-300",
      };
    case "soon":
      return {
        border: "border-amber-500/40",
        bg: "bg-amber-950/30",
        text: "text-amber-200",
      };
    case "this_week":
      return {
        border: "border-yellow-500/35",
        bg: "bg-yellow-950/20",
        text: "text-yellow-200",
      };
    case "later":
      return {
        border: "border-emerald-500/30",
        bg: "bg-emerald-950/20",
        text: "text-emerald-200",
      };
    case "none":
    default:
      return {
        border: "border-zinc-800/80",
        bg: "bg-zinc-900/30",
        text: "text-zinc-300",
      };
  }
}
