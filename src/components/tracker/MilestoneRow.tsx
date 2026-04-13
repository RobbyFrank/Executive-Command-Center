"use client";

import { useMemo, useState } from "react";
import type { Milestone } from "@/lib/types/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { updateMilestone, deleteMilestone } from "@/server/actions/tracker";
import { Check, Circle, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SlackLogo } from "./SlackLogo";
import { cn } from "@/lib/utils";
import { isValidHttpUrl } from "@/lib/httpUrl";

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
}

export function MilestoneRow({
  milestone,
  startNameInEditMode = false,
  isNextPendingMilestone = false,
  isQueuedPendingMilestone = false,
}: MilestoneRowProps) {
  const isDone = milestone.status === "Done";
  const milestoneContext = useContextMenu();
  const [slackUrlEditing, setSlackUrlEditing] = useState(false);
  const [slackEditNonce, setSlackEditNonce] = useState(0);

  const slackUrlTrimmed = milestone.slackUrl.trim();
  const hasSlackThreadUrl = isValidHttpUrl(slackUrlTrimmed);
  const slackNeedsAttention =
    isNextPendingMilestone &&
    !isDone &&
    !hasSlackThreadUrl;

  const milestoneMenuEntries = useMemo((): ContextMenuEntry[] => {
    const slackBlock: ContextMenuEntry[] = [
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
    slackUrlTrimmed,
  ]);

  return (
    <div
      className={cn(
        "group flex items-center gap-3 pl-14 pr-4 py-1.5 transition-colors",
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
        <div className="min-w-0 flex-1">
          <InlineEditCell
            value={milestone.name}
            onSave={(name) => updateMilestone(milestone.id, { name })}
            displayClassName={isDone ? "line-through text-zinc-500" : ""}
            startInEditMode={startNameInEditMode}
          />
        </div>
      </div>

      <div
        className={cn(
          "transition-[min-width,max-width] duration-150 ease-out",
          slackUrlEditing
            ? "relative z-20 min-w-0 max-w-md flex-1 basis-0"
            : slackNeedsAttention
              ? "min-w-[7.25rem] shrink-0"
              : "w-8 shrink-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditCell
          value={milestone.slackUrl}
          onSave={(slackUrl) => updateMilestone(milestone.id, { slackUrl })}
          placeholder="Paste Slack thread URL"
          linkBehavior
          openEditNonce={slackEditNonce}
          onEditingChange={setSlackUrlEditing}
          displayClassName="not-italic"
          collapsedButtonClassName={cn(
            "inline-flex items-center justify-center shrink-0",
            slackNeedsAttention && !slackUrlEditing
              ? "min-h-[26px] w-full rounded-md border border-amber-500/45 bg-amber-950/45 px-2 ring-1 ring-amber-500/25"
              : "w-auto min-w-[28px] px-1"
          )}
          formatDisplay={(url) => (
            <SlackLogo
              className={cn(
                "h-3.5 w-3.5",
                isValidHttpUrl(url.trim()) ? "opacity-90" : "opacity-40 grayscale"
              )}
            />
          )}
          emptyLabel={
            slackNeedsAttention ? (
              <span className="inline-flex items-center gap-1.5">
                <SlackLogo className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold text-amber-100/95">
                  Add Slack thread URL
                </span>
              </span>
            ) : (
              <SlackLogo className="h-3.5 w-3.5 opacity-25 grayscale" />
            )
          }
          displayTitle={
            slackNeedsAttention
              ? "Add a Slack thread URL for this milestone (next up)"
              : "Add or edit Slack thread link"
          }
        />
      </div>

      <ConfirmDeletePopover
        entityName="this milestone"
        rowGroup="project"
        onConfirm={() => deleteMilestone(milestone.id)}
      />
      <ContextMenu
        open={milestoneContext.open}
        x={milestoneContext.x}
        y={milestoneContext.y}
        onClose={milestoneContext.close}
        ariaLabel={`Actions for milestone ${milestone.name}`}
        entries={milestoneMenuEntries}
      />
    </div>
  );
}
