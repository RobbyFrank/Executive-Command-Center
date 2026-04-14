"use client";

import { BotMessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistant } from "@/contexts/AssistantContext";
import { AiAssistantPanel } from "./AiAssistantPanel";

export function AiAssistantButton() {
  const { open, entityTag, toggleFab, closeAssistant } = useAssistant();

  return (
    <>
      <button
        type="button"
        onClick={() => toggleFab()}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-zinc-100 shadow-lg transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500",
          open && "ring-2 ring-emerald-500/50"
        )}
        aria-expanded={open}
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        <BotMessageSquare className="h-7 w-7" aria-hidden />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            aria-hidden
            onClick={() => closeAssistant()}
          />
          <AiAssistantPanel
            key={entityTag ? `${entityTag.type}-${entityTag.id}` : "default"}
            entityTag={entityTag}
            onClose={() => closeAssistant()}
          />
        </>
      )}
    </>
  );
}
