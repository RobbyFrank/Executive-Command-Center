"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContextMenu } from "@/hooks/useContextMenu";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { AiCreateDialog } from "./AiCreateDialog";
import { TRACKER_ADD_ROW_ACTION_BUTTON_CLASS } from "./tracker-text-actions";

export type AddEntityMenuKind = "goal" | "project";

export interface AddEntityMenuButtonProps {
  kind: AddEntityMenuKind;
  companyId?: string;
  goalId?: string;
  onManualAdd: () => void | Promise<void>;
  onAiCreated?: (id: string) => void;
  /** Primary label, e.g. "Add goal" */
  label: string;
  /** Native tooltip on trigger */
  buttonTitle?: string;
  className?: string;
}

/**
 * Single “Add goal / Add project” control that opens the same anchored {@link ContextMenu} pattern
 * as the next-milestone Slack chip (Draft with AI vs manual).
 */
export function AddEntityMenuButton({
  kind,
  companyId,
  goalId,
  onManualAdd,
  onAiCreated,
  label,
  buttonTitle,
  className,
}: AddEntityMenuButtonProps) {
  const { open, x, y, close, openFromTrigger } = useContextMenu();
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

  const entries = useMemo((): ContextMenuEntry[] => {
    const aiLabel =
      kind === "goal"
        ? "Draft a new goal with AI…"
        : "Draft a new project with AI…";
    const manualLabel =
      kind === "goal"
        ? "Add blank goal…"
        : "Add blank project…";
    return [
      {
        type: "item",
        id: "add-entity-ai",
        label: aiLabel,
        icon: Sparkles,
        onClick: () => {
          close();
          setAiDialogOpen(true);
        },
      },
      {
        type: "item",
        id: "add-entity-manual",
        label: manualLabel,
        icon: Pencil,
        onClick: () => {
          close();
          void onManualAdd();
        },
      },
    ];
  }, [kind, close, onManualAdd]);

  const aria =
    kind === "goal" ? "Add goal options" : "Add project options";
  const defaultTitle =
    kind === "goal"
      ? "Add a new goal for this company"
      : "Add a new project to this goal";

  return (
    <>
      <button
        type="button"
        title={buttonTitle ?? defaultTitle}
        aria-label={aria}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={openFromTrigger}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openFromTrigger(e);
        }}
        className={cn(TRACKER_ADD_ROW_ACTION_BUTTON_CLASS, className)}
      >
        <Plus className="h-3 w-3 shrink-0" aria-hidden />
        {label}
      </button>
      <ContextMenu
        open={open}
        x={x}
        y={y}
        onClose={close}
        scope={kind === "goal" ? "goal" : "project"}
        title={kind === "goal" ? "Add goal" : "Add project"}
        ariaLabel={aria}
        entries={entries}
      />
      {aiDialogOpen && (
        <AiCreateDialog
          type={kind}
          companyId={companyId}
          goalId={goalId}
          onCreated={onAiCreated}
          onClose={() => setAiDialogOpen(false)}
        />
      )}
    </>
  );
}
