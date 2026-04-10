"use client";

import type { Milestone } from "@/lib/types/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { updateMilestone, deleteMilestone } from "@/server/actions/tracker";
import { Check, Circle } from "lucide-react";

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

  return (
    <div className="group flex items-center gap-3 pl-14 pr-4 py-1 hover:bg-zinc-900/50 transition-colors">
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
        onConfirm={() => deleteMilestone(milestone.id)}
      />
    </div>
  );
}
