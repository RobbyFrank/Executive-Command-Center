"use client";

import { useEffect, useState } from "react";
import { BotMessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistant } from "@/contexts/AssistantContext";
import { AiAssistantPanel } from "./AiAssistantPanel";

/** Matches panel + backdrop CSS transition duration. */
const ASSISTANT_PANEL_EXIT_MS = 300;

export function AiAssistantButton() {
  const { open, entityTag, toggleFab, closeAssistant } = useAssistant();
  const [mounted, setMounted] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimOpen(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setAnimOpen(false);
    const t = window.setTimeout(() => setMounted(false), ASSISTANT_PANEL_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAssistant();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeAssistant]);

  return (
    <>
      <button
        type="button"
        onClick={() => toggleFab()}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-zinc-100 shadow-lg transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500",
          open && "ring-2 ring-emerald-500/50",
        )}
        aria-expanded={open}
        aria-label={
          entityTag
            ? open
              ? "Close assistant — item context attached"
              : "Open assistant — item context attached"
            : open
              ? "Close assistant"
              : "Open assistant"
        }
      >
        <span className="relative inline-flex">
          <BotMessageSquare className="h-7 w-7" aria-hidden />
          {entityTag ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-800 bg-emerald-500 shadow-sm"
              title="Discuss in chat context attached"
              aria-hidden
            />
          ) : null}
        </span>
      </button>
      {mounted && (
        <>
          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ease-out motion-reduce:duration-200 md:hidden",
              animOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden
            onClick={() => closeAssistant()}
          />
          <AiAssistantPanel
            key={entityTag ? `${entityTag.type}-${entityTag.id}` : "default"}
            entityTag={entityTag}
            onClose={() => closeAssistant()}
            visible={animOpen}
          />
        </>
      )}
    </>
  );
}
