"use client";

import type { Milestone } from "@/lib/types/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { updateMilestone, deleteMilestone } from "@/server/actions/tracker";
import { Check, Circle } from "lucide-react";

interface MilestoneRowProps {
  milestone: Milestone;
}

export function MilestoneRow({ milestone }: MilestoneRowProps) {
  const isDone = milestone.status === "Done";

  return (
    <div className="group flex items-center gap-3 pl-20 pr-4 py-1 hover:bg-zinc-900/50 transition-colors">
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
          emptyLabel="No date"
        />
      </div>

      <div className="flex-1 min-w-0">
        <InlineEditCell
          value={milestone.name}
          onSave={(name) => updateMilestone(milestone.id, { name })}
          displayClassName={isDone ? "line-through text-zinc-500" : ""}
        />
      </div>

      <ConfirmDeletePopover
        entityName="this milestone"
        onConfirm={() => deleteMilestone(milestone.id)}
      />
    </div>
  );
}
