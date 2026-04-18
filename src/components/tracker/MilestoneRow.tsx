"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Milestone, Person } from "@/lib/types/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { updateMilestone, deleteMilestone } from "@/server/actions/tracker";
import {
  CalendarPlus,
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
import { StartSlackThreadChip } from "./StartSlackThreadChip";
import { RowActionIcons } from "./RowActionIcons";
import { cn } from "@/lib/utils";
import {
  ROADMAP_ENTITY_TITLE_DISPLAY_CLASS,
  ROADMAP_MILESTONE_GRID_PADDING_CLASS,
  ROADMAP_MILESTONE_NEXT_CHIP_SLOT_CLASS,
  ROADMAP_MILESTONE_TITLE_MAX_WHEN_SLACK_THREAD_STRIP_CLASS,
  TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT,
} from "@/lib/tracker-roadmap-columns";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { useAssistantOptional } from "@/contexts/AssistantContext";
import {
  getMilestoneDueHorizon,
  type MilestoneDueHorizon,
} from "@/lib/relativeCalendarDate";

function milestoneDateDisplayClass(
  horizon: MilestoneDueHorizon
): string | undefined {
  switch (horizon) {
    case "overdue":
      return "font-semibold text-rose-400";
    case "within24h":
    case "tomorrow":
      return "font-semibold text-orange-400";
    case "soon":
      return "font-semibold text-yellow-300";
    case "this_week":
      return "font-semibold text-amber-400";
    default:
      return undefined;
  }
}

function nextMilestoneChipClass(horizon: MilestoneDueHorizon): string {
  switch (horizon) {
    case "overdue":
      return "text-rose-50 ring-rose-400/60";
    case "within24h":
    case "tomorrow":
      return "text-orange-50 ring-orange-400/62";
    case "soon":
      return "text-yellow-50 ring-yellow-400/55";
    case "this_week":
      return "text-amber-50 ring-amber-400/55";
    default:
      return "text-violet-200/95 ring-violet-500/35";
  }
}

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
   * Roadmap only: when there is no Slack URL yet, position the **Start Slack thread** chip
   * with the same horizontal alignment as the linked thread strip (project **Complexity** column).
   */
  alignSlackPreviewToNextMilestoneColumn?: boolean;
  /**
   * Increment from the parent (e.g. project row “Attach existing Slack thread URL…”) to open the URL
   * editor for this milestone — only honored when this row is the next pending milestone.
   */
  slackUrlEditSignal?: number;
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
  slackUrlEditSignal = 0,
}: MilestoneRowProps) {
  const isDone = milestone.status === "Done";
  const dueHorizon = useMemo((): MilestoneDueHorizon => {
    if (isDone) return "none";
    return getMilestoneDueHorizon(milestone.targetDate);
  }, [isDone, milestone.targetDate]);

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
  const slackThreadSpotlightRef = useRef<HTMLDivElement>(null);
  const lastSlackUrlEditSignal = useRef(0);

  useEffect(() => {
    if (!isNextPendingMilestone || isDone || !slackUrlEditSignal) return;
    if (slackUrlEditSignal <= lastSlackUrlEditSignal.current) return;
    lastSlackUrlEditSignal.current = slackUrlEditSignal;
    setSlackEditNonce((n) => n + 1);
    setSlackUrlEditing(true);
  }, [slackUrlEditSignal, isNextPendingMilestone, isDone]);

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

  /** Linked thread preview — always in flow beside the title (same `gap-2` as date ↔ title). */
  const showSlackInlineBesideTitle = hasSlackThreadUrl;

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
              progressEstimate: milestoneLikelihood.result.progressEstimate,
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

  /** Roadmap expanded: align Start Slack thread chip with the collapsed project row (not the old Add URL control). */
  const showSlackStartAlignedInRow =
    alignSlackPreviewToNextMilestoneColumn &&
    slackNeedsAttention &&
    !slackUrlEditing;

  const showSlackQuickMenu = !hasSlackThreadUrl && !slackUrlEditing;

  /** Same absolute `left` as thread strip / Start Slack chip — reserve title width so neither overlaps. */
  const reserveTitleSpaceForRoadmapSlackStrip =
    showSlackInlineBesideTitle || showSlackStartAlignedInRow;

  const slackIconCellClass =
    "inline-flex !h-7 !w-7 !min-w-[1.75rem] !max-w-[1.75rem] shrink-0 items-center justify-center !border-0 !px-0 !py-0 !shadow-none !ring-0 bg-transparent hover:bg-zinc-800/80 rounded-sm";

  const milestoneMenuEntries = useMemo((): ContextMenuEntry[] => {
    const slackBlock: ContextMenuEntry[] = [
      ...(hasSlackThreadUrl
        ? []
        : [
            {
              type: "item" as const,
              id: "slack-create-thread",
              label: "Draft a new Slack thread with AI…",
              icon: Sparkles,
              disabled: !canCreateSlackThread,
              disabledReason:
                "Set a Slack channel on the goal first (Roadmap goal row)",
              onClick: () => setCreateThreadOpen(true),
            },
          ]),
      {
        type: "item",
        id: "slack-add-edit",
        label: slackUrlTrimmed
          ? "Edit Slack thread URL…"
          : "Attach existing Slack thread URL…",
        icon: Pencil,
        onClick: () => {
          setSlackEditNonce((n) => n + 1);
          // Without a linked URL the Slack column is only a 7×7 menu button — no InlineEditCell
          // mounted yet — so bumping openEditNonce alone does nothing. Expand the paste field.
          if (!hasSlackThreadUrl) setSlackUrlEditing(true);
        },
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
        label: "Draft a new Slack thread with AI…",
        icon: Sparkles,
        disabled: !canCreateSlackThread,
        disabledReason:
          "Set a Slack channel on the goal first (Roadmap goal row)",
        onClick: () => setCreateThreadOpen(true),
      },
      {
        type: "item",
        id: "slack-q-paste",
        label: "Attach existing Slack thread URL…",
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
      ref={slackThreadSpotlightRef}
      className={cn(
        "group/milestone relative flex min-h-[28px] min-w-0 items-center gap-2 py-1 transition-colors",
        ROADMAP_MILESTONE_GRID_PADDING_CLASS,
        isNextPendingMilestone &&
          !isDone &&
          (dueHorizon === "none" || dueHorizon === "later") &&
          "bg-violet-950/20 hover:bg-violet-950/30",
        !(
          isNextPendingMilestone &&
          !isDone &&
          (dueHorizon === "none" || dueHorizon === "later")
        ) && "hover:bg-zinc-900/60",
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
          emptyLabel={
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors not-italic hover:bg-zinc-800/55 hover:text-zinc-300"
              aria-hidden
            >
              <CalendarPlus
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
          }
          displayClassName={
            isNextPendingMilestone && !isDone
              ? milestoneDateDisplayClass(dueHorizon)
              : undefined
          }
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Always reserve the Next chip column so names start on one vertical line (with or without Slack URL). */}
        <div className={ROADMAP_MILESTONE_NEXT_CHIP_SLOT_CLASS}>
          {isNextPendingMilestone && !isDone ? (
            <span
              className={cn(
                "inline shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide ring-1",
                nextMilestoneChipClass(dueHorizon)
              )}
              title="This is the next milestone to complete — link Slack here first"
            >
              Next
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "min-h-[1.5rem] min-w-0 shrink overflow-hidden flex-1",
            reserveTitleSpaceForRoadmapSlackStrip &&
              ROADMAP_MILESTONE_TITLE_MAX_WHEN_SLACK_THREAD_STRIP_CLASS
          )}
        >
          <InlineEditCell
            value={milestone.name}
            onSave={(name) => updateMilestone(milestone.id, { name })}
            displayClassName={cn(
              ROADMAP_ENTITY_TITLE_DISPLAY_CLASS,
              isDone && "line-through text-zinc-500"
            )}
            startInEditMode={startNameInEditMode}
          />
        </div>
      </div>

      <div
        className={cn(
          "flex min-w-0 items-center gap-1 transition-[min-width,max-width] duration-150 ease-out",
          slackUrlEditing
            ? "relative z-20 min-w-0 max-w-md flex-1 basis-0"
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
              startInEditMode
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
        )}
      </div>

      {showSlackQuickMenu ? (
        <ContextMenu
          open={slackQuickContext.open}
          x={slackQuickContext.x}
          y={slackQuickContext.y}
          onClose={slackQuickContext.close}
          scope="milestone"
          ariaLabel={`Slack thread for ${milestone.name}`}
          entries={slackQuickMenuEntries}
        />
      ) : null}

      <RowActionIcons rowGroup="milestone">
        <button
          type="button"
          title="Milestone actions"
          aria-label={`More actions for milestone ${milestone.name}`}
          aria-haspopup="menu"
          aria-expanded={milestoneContext.open}
          onClick={milestoneContext.openFromTrigger}
          className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      </RowActionIcons>

      {showSlackInlineBesideTitle ? (
        <div
          className="pointer-events-none absolute top-1/2 z-10 min-w-0 w-max max-w-[min(36rem,calc(100%-max(4.5rem,3vw)))] -translate-y-1/2 overflow-hidden"
          style={{
            left: TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT,
          }}
        >
          <div className="pointer-events-auto min-w-0 w-max max-w-full">
            {slackThreadPreview}
          </div>
        </div>
      ) : null}

      {showSlackStartAlignedInRow ? (
        <div
          className="pointer-events-none absolute top-1/2 z-10 w-max max-w-[min(36rem,calc(100vw-4rem))] -translate-y-1/2"
          style={{
            left: TRACKER_ROADMAP_MILESTONE_SLACK_INLINE_AT_GOAL_CONFIDENCE_LEFT,
          }}
        >
          <div
            className="pointer-events-auto w-fit"
            onClick={(e) => e.stopPropagation()}
          >
            <StartSlackThreadChip
              menuOpen={slackQuickContext.open}
              onMenuTrigger={slackQuickContext.openFromTrigger}
              ariaLabel={`Start Slack thread for ${milestone.name}`}
            />
          </div>
        </div>
      ) : null}

      <ContextMenu
        open={milestoneContext.open}
        x={milestoneContext.x}
        y={milestoneContext.y}
        onClose={milestoneContext.close}
        scope="milestone"
        ariaLabel={`Actions for milestone ${milestone.name}`}
        entries={milestoneMenuEntries}
      />

      {hasSlackThreadUrl ? (
        <SlackMilestoneThreadPopovers
          anchorRef={threadAnchorRef}
          spotlightRef={slackThreadSpotlightRef}
          goalDescription={goalDescription}
          projectName={projectName}
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
        spotlightRef={slackThreadSpotlightRef}
      />
    </div>
  );
}
