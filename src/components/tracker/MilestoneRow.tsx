"use client";

import { useMemo } from "react";
import type { Milestone } from "@/lib/types/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { updateMilestone, deleteMilestone } from "@/server/actions/tracker";
import { Check, Circle, Trash2 } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";

interface MilestoneRowProps {
  milestone: Milestone;
  /** When true, milestone name opens in edit mode on mount (e.g. right after create). */
  startNameInEditMode?: boolean;
}

export function MilestoneRow({
  milestone,
  startNameInEditMode = false,
}: MilestoneRowProps) {
  const isDone = milestone.status === "Done";
  const milestoneContext = useContextMenu();

  const milestoneMenuEntries = useMemo((): ContextMenuEntry[] => {
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
  }, [isDone, milestone.id, milestone.name]);

  return (
    <div
      className="group flex items-center gap-3 pl-14 pr-4 py-1 transition-colors hover:bg-zinc-900/50"
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

      <div className="flex-1 min-w-0">
        <InlineEditCell
          value={milestone.name}
          onSave={(name) => updateMilestone(milestone.id, { name })}
          displayClassName={isDone ? "line-through text-zinc-500" : ""}
          startInEditMode={startNameInEditMode}
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
