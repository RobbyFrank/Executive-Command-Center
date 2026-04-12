"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiCreateDialog } from "./AiCreateDialog";

interface AiCreateButtonProps {
  type: "goal" | "project";
  companyId?: string;
  goalId?: string;
  /** Called with the new entity id after creation */
  onCreated?: (id: string) => void;
  inline?: boolean;
}

export function AiCreateButton({
  type,
  companyId,
  goalId,
  onCreated,
  inline = false,
}: AiCreateButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        title={`Use AI to add a ${type}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-sm transition-colors",
          "text-zinc-500 hover:text-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
          inline
            ? "ml-1 align-baseline p-0"
            : "p-0.5",
        )}
      >
        <Sparkles className={cn(inline ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} aria-hidden />
      </button>

      {open && (
        <AiCreateDialog
          type={type}
          companyId={companyId}
          goalId={goalId}
          onCreated={onCreated}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
