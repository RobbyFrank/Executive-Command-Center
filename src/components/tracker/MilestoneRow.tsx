"use client";

import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Milestone, Person } from "@/lib/types/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { updateMilestone, deleteMilestone } from "@/server/actions/tracker";
import {
  Check,
  Circle,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SlackLogo } from "./SlackLogo";
import { useSlackThreadStatus } from "@/hooks/useSlackThreadStatus";
import { useMilestoneLikelihood } from "@/hooks/useMilestoneLikelihood";
import { MilestoneSlackThreadInline } from "./MilestoneSlackThreadInline";
import {
  SlackMilestoneThreadPopovers,
  type SlackPingMode,
} from "./SlackMilestoneThreadPopovers";
import { SlackCreateThreadDialog } from "./SlackCreateThreadDialog";
import { cn } from "@/lib/utils";
import { TRACKER_ROADMAP_NEXT_MS_COLUMN_PL_FROM_MILESTONE_ROW } from "@/lib/tracker-roadmap-columns";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { useAssistantOptional } from "@/contexts/AssistantContext";

interface MilestoneRowProps {
  milestone: Milestone;
  /** When true, milestone name opens in edit mode on mount (e.g. right after create). */
  startNameInEditMode?: boolean;
  /**
   * First not-done milestone in list order — emphasized; Slack URL is expected here first.
   */
  isNextPendingMilestone?: boolean;
  /**
   * Open milestone that comes after the current “next” one — subtly de-emphasized.
   */
  isQueuedPendingMilestone?: boolean;
  /** Goal Slack channel — required to create a new thread from the Roadmap. */
  goalSlackChannelId?: string;
  goalSlackChannelName?: string;
  /** Parent goal description (Roadmap) — shown in Slack draft dialog hierarchy. */
  goalDescription?: string;
  /** Team roster — Slack thread previews resolve names/avatars from `slackHandle`. */
  people?: Person[];
  /** Project context for deadline likelihood AI (optional; defaults keep scoring neutral). */
  projectName?: string;
  projectOwnerId?: string;
  projectComplexity?: number;
  /** Preformatted list of milestones for roadmap context (e.g. sibling milestones). */
  milestonesSummary?: string;
  /**
   * Roadmap only: position the Slack thread preview (same milestone row) so its left
   * edge matches the project row **Next milestone** column (`ProjectRow` `w-[36rem]`).
   * Review mode keeps the default (preview beside the title in flow layout).
   */
  alignSlackPreviewToNextMilestoneColumn?: boolean;
}

export function MilestoneRow({
  milestone,
  startNameInEditMode = false,
  isNextPendingMilestone = false,
  isQueuedPendingMilestone = false,
  goalSlackChannelId = "",
  goalSlackChannelName = "",
  goalDescription = "",
  people = [],
  projectName = "",
  projectOwnerId = "",
  projectComplexity = 3,
  milestonesSummary,
  alignSlackPreviewToNextMilestoneColumn = false,
}: MilestoneRowProps) {
  const isDone = milestone.status === "Done";
  const assistant = useAssistantOptional();
  const milestoneContext = useContextMenu();
  const slackQuickContext = useContextMenu();
  const [slackUrlEditing, setSlackUrlEditing] = useState(false);
  const [slackEditNonce, setSlackEditNonce] = useState(0);
  const [createThreadOpen, setCreateThreadOpen] = useState(false);
  const [threadPopoverOpen, setThreadPopoverOpen] = useState(false);
  const [threadPingOpen, setThreadPingOpen] = useState(false);
  const [slackPingMode, setSlackPingMode] = useState<SlackPingMode>("ping");
  const threadAnchorRef = useRef<HTMLButtonElement>(null);

  const goalChannelIdTrimmed = goalSlackChannelId.trim();
  const canCreateSlackThread = Boolean(goalChannelIdTrimmed);

  const slackUrlTrimmed = milestone.slackUrl.trim();
  const hasSlackThreadUrl = isValidHttpUrl(slackUrlTrimmed);
  const slackThread = useSlackThreadStatus(
    hasSlackThreadUrl ? slackUrlTrimmed : null,
    people
  );

  const ownerPerson = useMemo(() => {
    const id = projectOwnerId.trim();
    if (!id) return undefined;
    return people.find((p) => p.id === id);
  }, [people, projectOwnerId]);

  const ownerName = ownerPerson?.name ?? null;
  const ownerAutonomy = ownerPerson?.autonomyScore ?? null;

  const roadmapContext = useMemo(() => {
    const parts: string[] = [];
    const pn = projectName.trim();
    if (pn) parts.push(`Project: ${pn}`);
    const ms = milestonesSummary?.trim();
    if (ms) parts.push(`Milestones:\n${ms}`);
    return parts.length ? parts.join("\n\n") : undefined;
  }, [projectName, milestonesSummary]);

  const threadReplyCountForLikelihood = slackThread.loading
    ? null
    : (slackThread.status?.replyCount ?? null);

  const milestoneLikelihood = useMilestoneLikelihood({
    slackUrl: hasSlackThreadUrl ? slackUrlTrimmed : null,
    milestoneName: milestone.name,
    targetDate: milestone.targetDate,
    ownerAutonomy: ownerAutonomy ?? null,
    projectComplexity,
    rosterHints: slackThread.rosterHints,
    roadmapContext,
    threadReplyCount: hasSlackThreadUrl ? threadReplyCountForLikelihood : null,
  });

  const showSlackInlineBesideTitle =
    hasSlackThreadUrl && !alignSlackPreviewToNextMilestoneColumn;
  /** Same row as title/checkbox — absolutely positioned to match `ProjectRow` Next milestone column. */
  const showSlackPreviewAlignedInRow =
    hasSlackThreadUrl && alignSlackPreviewToNextMilestoneColumn;

  const slackThreadPreview = (
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
              riskLevel: milestoneLikelihood.result.riskLevel,
            }
          : null
      }
      likelihoodLoading={
        Boolean(milestone.targetDate.trim()) && milestoneLikelihood.loading
      }
    />
  );

  const slackNeedsAttention =
    isNextPendingMilestone &&
    !isDone &&
    !hasSlackThreadUrl;

  /** Amber “Add URL” row spans wider than the fixed Slack icon grid. */
  const slackAmberNoChannel =
    slackNeedsAttention && !canCreateSlackThread && !hasSlackThreadUrl;

  const slackIconCellClass =
    "inline-flex !h-7 !w-7 !min-w-[1.75rem] !max-w-[1.75rem] shrink-0 items-center justify-center !border-0 !px-0 !py-0 !shadow-none !ring-0 bg-transparent hover:bg-zinc-800/80 rounded-sm";

  const milestoneMenuEntries = useMemo((): ContextMenuEntry[] => {
    const slackBlock: ContextMenuEntry[] = [
      {
        type: "item",
        id: "slack-create-thread",
        label: "Draft Slack thread with AI…",
        icon: Sparkles,
        disabled: !canCreateSlackThread,
        disabledReason:
          "Set a Slack channel on the goal first (Roadmap goal row)",
        onClick: () => setCreateThreadOpen(true),
      },
      {
        type: "item",
        id: "slack-add-edit",
        label: slackUrlTrimmed
          ? "Edit Slack thread URL…"
          : "Add Slack thread URL…",
        icon: Pencil,
        onClick: () => setSlackEditNonce((n) => n + 1),
      },
      {
        type: "item",
        id: "slack-open",
        label: "Open Slack thread",
        icon: ExternalLink,
        disabled: !hasSlackThreadUrl,
        disabledReason: "Add a valid https URL first",
        onClick: () => {
          if (!hasSlackThreadUrl) return;
          window.open(slackUrlTrimmed, "_blank", "noopener,noreferrer");
        },
      },
    ];

    return [
      {
        type: "item",
        id: "toggle-done",
        label: isDone ? "Mark not done" : "Mark done",
        icon: isDone ? Circle : Check,
        onClick: () =>
          void updateMilestone(milestone.id, {
            status: isDone ? "Not Done" : "Done",
          }),
      },
      ...(assistant
        ? [
            {
              type: "item" as const,
              id: "discuss-in-chat",
              label: "Discuss in chat",
              icon: MessageSquare,
              onClick: () =>
                assistant.openAssistant({
                  type: "milestone",
                  id: milestone.id,
                  label: milestone.name,
                }),
            },
          ]
        : []),
      { type: "divider", id: "ms-slack" },
      ...slackBlock,
      { type: "divider", id: "ms-d1" },
      {
        type: "item",
        id: "delete-ms",
        label: "Delete milestone…",
        icon: Trash2,
        destructive: true,
        confirmMessage: `Delete milestone "${milestone.name}"? This can't be undone.`,
        onClick: () => void deleteMilestone(milestone.id),
      },
    ];
  }, [
    isDone,
    hasSlackThreadUrl,
    milestone.id,
    milestone.name,
    assistant,
    slackUrlTrimmed,
    canCreateSlackThread,
  ]);

  const slackQuickMenuEntries = useMemo((): ContextMenuEntry[] => {
    return [
      {
        type: "item",
        id: "slack-q-create",
        label: "Draft Slack thread with AI…",
        icon: Sparkles,
        disabled: !canCreateSlackThread,
        disabledReason:
          "Set a Slack channel on the goal first (Roadmap goal row)",
        onClick: () => setCreateThreadOpen(true),
      },
      {
        type: "item",
        id: "slack-q-paste",
        label: "Add Slack thread URL…",
        icon: Pencil,
        onClick: () => {
          setSlackEditNonce((n) => n + 1);
          setSlackUrlEditing(true);
        },
      },
    ];
  }, [canCreateSlackThread]);

  return (
    <div
      className={cn(
        "group relative flex min-w-0 items-center gap-3 pl-14 pr-4 py-1.5 transition-colors",
        isNextPendingMilestone &&
          !isDone &&
          "bg-violet-950/20 hover:bg-violet-950/30",
        (!isNextPendingMilestone || isDone) &&
          "hover:bg-zinc-900/50",
        isQueuedPendingMilestone && !isDone && "opacity-[0.78]"
      )}
      onContextMenuCapture={milestoneContext.onContextMenuCapture}
    >
      <button
        type="button"
        onClick={() =>
          updateMilestone(milestone.id, {
            status: isDone ? "Not Done" : "Done",
          })
        }
        className={
          isDone
            ? "text-emerald-500 hover:text-emerald-400"
            : "text-zinc-600 hover:text-zinc-400"
        }
        title={isDone ? "Mark not done" : "Mark done"}
      >
        {isDone ? (
          <Check className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>

      <div className="w-28 shrink-0">
        <InlineEditCell
          value={milestone.targetDate}
          onSave={(targetDate) =>
            updateMilestone(milestone.id, { targetDate })
          }
          type="date"
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isNextPendingMilestone && !isDone ? (
          <span
            className="inline shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-violet-200/95 ring-1 ring-violet-500/35 bg-violet-500/15"
            title="This is the next milestone to complete — link Slack here first"
          >
            Next
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {/* Title truncates; roadmap-aligned Slack is absolutely positioned (same row). */}
          <div
            className={cn(
              "min-h-[1.75rem] min-w-0 flex-1 overflow-hidden",
              showSlackPreviewAlignedInRow &&
                "max-w-[calc(360px+38.625rem)]"
            )}
          >
            <InlineEditCell
              value={milestone.name}
              onSave={(name) => updateMilestone(milestone.id, { name })}
              displayClassName={isDone ? "line-through text-zinc-500" : ""}
              displayTruncateSingleLine
              startInEditMode={startNameInEditMode}
            />
          </div>
          {showSlackInlineBesideTitle ? (
            <div className="min-w-0 max-w-[min(46rem,55%)] shrink-0">
              {slackThreadPreview}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex min-w-0 items-center gap-1 transition-[min-width,max-width] duration-150 ease-out",
          slackUrlEditing
            ? "relative z-20 min-w-0 max-w-md flex-1 basis-0"
            : slackAmberNoChannel
              ? "max-w-[13rem] shrink-0"
              : "shrink-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {slackUrlEditing ? (
          <div className="w-full min-w-0">
            <InlineEditCell
              value={milestone.slackUrl}
              onSave={(slackUrl) => updateMilestone(milestone.id, { slackUrl })}
              placeholder="Paste Slack thread URL"
              linkBehavior
              linkBehaviorHideTrailingEdit
              openEditNonce={slackEditNonce}
              onEditingChange={setSlackUrlEditing}
              displayClassName="not-italic"
              collapsedButtonClassName={cn(
                "inline-flex items-center justify-center shrink-0",
                slackNeedsAttention && !canCreateSlackThread
                  ? "min-h-[26px] w-full rounded-md border border-amber-500/40 bg-amber-950/30 px-1.5 ring-1 ring-amber-500/20"
                  : "w-auto min-w-[28px] px-1"
              )}
              formatDisplay={(url) => (
                <SlackLogo
                  className={cn(
                    "h-3.5 w-3.5",
                    isValidHttpUrl(url.trim())
                      ? "opacity-90"
                      : "opacity-40 grayscale"
                  )}
                />
              )}
              emptyLabel={
                slackNeedsAttention ? (
                  <span className="inline-flex items-center gap-1.5">
                    <SlackLogo className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium text-amber-200/90">
                      Add URL
                    </span>
                  </span>
                ) : (
                  <SlackLogo className="h-3.5 w-3.5 opacity-25 grayscale" />
                )
              }
              displayTitle={
                slackNeedsAttention
                  ? canCreateSlackThread
                    ? "Add a Slack thread URL for this milestone (next up)"
                    : "Set a Slack channel on the goal first, or paste a thread URL"
                  : "Add or edit Slack thread link"
              }
            />
          </div>
        ) : slackAmberNoChannel ? (
          <div className="flex w-full min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <InlineEditCell
                value={milestone.slackUrl}
                onSave={(slackUrl) =>
                  updateMilestone(milestone.id, { slackUrl })
                }
                placeholder="Paste Slack thread URL"
                linkBehavior
                linkBehaviorHideTrailingEdit
                openEditNonce={slackEditNonce}
                onEditingChange={setSlackUrlEditing}
                displayClassName="not-italic"
                collapsedButtonClassName="min-h-[26px] w-full rounded-md border border-amber-500/40 bg-amber-950/30 px-1.5 ring-1 ring-amber-500/20"
                formatDisplay={(url) => (
                  <SlackLogo
                    className={cn(
                      "h-3.5 w-3.5",
                      isValidHttpUrl(url.trim())
                        ? "opacity-90"
                        : "opacity-40 grayscale"
                    )}
                  />
                )}
                emptyLabel={
                  <span className="inline-flex items-center gap-1.5">
                    <SlackLogo className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium text-amber-200/90">
                      Add URL
                    </span>
                  </span>
                }
                displayTitle="Set a Slack channel on the goal first, or paste a thread URL"
              />
            </div>
          </div>
        ) : hasSlackThreadUrl ? (
          <div className="flex w-7 shrink-0 justify-center">
            <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-sm">
              <InlineEditCell
                value={milestone.slackUrl}
                onSave={(slackUrl) =>
                  updateMilestone(milestone.id, { slackUrl })
                }
                placeholder="Paste Slack thread URL"
                variant="plain"
                linkBehavior
                linkBehaviorHideTrailingEdit
                openEditNonce={slackEditNonce}
                onEditingChange={setSlackUrlEditing}
                displayClassName="not-italic"
                collapsedButtonClassName={slackIconCellClass}
                formatDisplay={(url) => (
                  <SlackLogo
                    className={cn(
                      "h-3.5 w-3.5 opacity-100 saturate-100",
                      !isValidHttpUrl(url.trim()) && "opacity-50 grayscale"
                    )}
                  />
                )}
                emptyLabel={
                  <SlackLogo className="h-3.5 w-3.5 opacity-25 grayscale" />
                }
                displayTitle="Slack thread linked — click to open"
              />
              {/* Green dot — "connected" indicator */}
              <span
                className="pointer-events-none absolute -bottom-px -right-px h-[7px] w-[7px] rounded-full bg-emerald-500 ring-[1.5px] ring-zinc-950"
                aria-hidden
              />
            </div>
          </div>
        ) : (
          <>
            {/* Empty URL: left-click opens the same 2-item menu as right-click */}
            <div className="flex w-7 shrink-0 justify-center">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-sm">
                <button
                  type="button"
                  title={
                    slackNeedsAttention && !isDone
                      ? "Next milestone — add a Slack thread (click for options)"
                      : "No Slack thread linked — click for draft or add URL"
                  }
                  aria-label={`Slack thread actions for ${milestone.name}`}
                  aria-haspopup="menu"
                  aria-expanded={slackQuickContext.open}
                  onClick={slackQuickContext.openFromTrigger}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    slackQuickContext.openFromTrigger(
                      e as ReactMouseEvent<HTMLElement>
                    );
                  }}
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm",
                    slackNeedsAttention && !isDone
                      ? "text-zinc-200"
                      : "text-zinc-500",
                    "transition-colors hover:bg-zinc-800/80 hover:text-zinc-100",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
                  )}
                >
                  <SlackLogo
                    className={cn(
                      "h-3.5 w-3.5",
                      slackNeedsAttention && !isDone
                        ? "opacity-95 saturate-100"
                        : "opacity-[0.28] grayscale contrast-75"
                    )}
                  />
                </button>
              </div>
            </div>
            <ContextMenu
              open={slackQuickContext.open}
              x={slackQuickContext.x}
              y={slackQuickContext.y}
              onClose={slackQuickContext.close}
              ariaLabel={`Slack thread for ${milestone.name}`}
              entries={slackQuickMenuEntries}
            />
          </>
        )}
      </div>

      <button
        type="button"
        title="Milestone actions"
        aria-label={`More actions for milestone ${milestone.name}`}
        aria-haspopup="menu"
        aria-expanded={milestoneContext.open}
        onClick={milestoneContext.openFromTrigger}
        className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
      </button>

      {showSlackPreviewAlignedInRow ? (
        <div
          className="pointer-events-none absolute top-1/2 z-10 min-w-0 max-w-[36rem] -translate-y-1/2 overflow-hidden"
          style={{
            left: TRACKER_ROADMAP_NEXT_MS_COLUMN_PL_FROM_MILESTONE_ROW,
            right: "1rem",
          }}
        >
          <div className="pointer-events-auto min-w-0">{slackThreadPreview}</div>
        </div>
      ) : null}

      <ContextMenu
        open={milestoneContext.open}
        x={milestoneContext.x}
        y={milestoneContext.y}
        onClose={milestoneContext.close}
        ariaLabel={`Actions for milestone ${milestone.name}`}
        entries={milestoneMenuEntries}
      />

      {hasSlackThreadUrl ? (
        <SlackMilestoneThreadPopovers
          anchorRef={threadAnchorRef}
          slackUrl={slackUrlTrimmed}
          milestoneName={milestone.name}
          status={slackThread.status}
          rosterHints={slackThread.rosterHints}
          popoverOpen={threadPopoverOpen}
          onPopoverOpenChange={setThreadPopoverOpen}
          pingOpen={threadPingOpen}
          onPingOpenChange={setThreadPingOpen}
          pingMode={slackPingMode}
          onPingModeChange={setSlackPingMode}
          onRefreshStatus={() => void slackThread.refresh({ force: true })}
          onPingSent={() => void slackThread.refresh({ force: true })}
          targetDate={milestone.targetDate}
          ownerName={ownerName}
          ownerAutonomy={ownerAutonomy}
          projectComplexity={projectComplexity}
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
        projectName={projectName}
        channelId={goalChannelIdTrimmed}
        channelName={goalSlackChannelName}
        people={people}
      />
    </div>
  );
}
