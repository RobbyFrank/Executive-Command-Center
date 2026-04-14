"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantEntityTag } from "@/contexts/AssistantContext";
import { AssistantMarkdown } from "./AssistantMarkdown";

export type ChatTurn = {
  question: string;
  answer: string;
};

type HistoryMessage = { role: "user" | "assistant"; content: string };

const FONT_STEP_STORAGE_KEY = "ecc-assistant-font-step";
const FONT_STEPS = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl"] as const;
const DEFAULT_FONT_STEP = 1;

function readStoredFontStep(): number {
  if (typeof window === "undefined") return DEFAULT_FONT_STEP;
  const raw = localStorage.getItem(FONT_STEP_STORAGE_KEY);
  const n = raw !== null ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 0 || n >= FONT_STEPS.length) return DEFAULT_FONT_STEP;
  return n;
}

function entityTypeLabel(t: AssistantEntityTag["type"]): string {
  switch (t) {
    case "goal":
      return "Goal";
    case "project":
      return "Project";
    case "milestone":
      return "Milestone";
    default:
      return t;
  }
}

export function AiAssistantPanel({
  onClose,
  entityTag,
}: {
  onClose: () => void;
  entityTag: AssistantEntityTag | null;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fontStep, setFontStep] = useState(DEFAULT_FONT_STEP);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setFontStep(readStoredFontStep());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_STEP_STORAGE_KEY, String(fontStep));
    } catch {
      /* ignore quota / private mode */
    }
  }, [fontStep]);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, streaming, pendingQuestion, loading]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    setLoading(true);
    setError(null);
    setStreaming("");
    setPendingQuestion(q);

    const historyMessages: HistoryMessage[] = turns.flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.answer },
    ]);

    let focusInputAfterAnswer = false;

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: historyMessages,
          ...(entityTag
            ? {
                entityContext: {
                  type: entityTag.type,
                  id: entityTag.id,
                  label: entityTag.label,
                },
              }
            : {}),
        }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(errJson?.error ?? `Request failed (${res.status})`);
        setPendingQuestion(null);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setPendingQuestion(null);
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreaming(full);
      }

      setTurns((prev) => [...prev, { question: q, answer: full }]);
      setStreaming("");
      setPendingQuestion(null);
      focusInputAfterAnswer = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPendingQuestion(null);
    } finally {
      setLoading(false);
      if (focusInputAfterAnswer) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [input, loading, turns, entityTag]);

  const chatFontClass = FONT_STEPS[fontStep];
  const canDecreaseFont = fontStep > 0;
  const canIncreaseFont = fontStep < FONT_STEPS.length - 1;

  return (
    <div
      className={cn(
        "fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-xl",
        "transition-[width,height,max-width,max-height] duration-300 ease-out motion-reduce:transition-none",
        expanded
          ? "h-[min(85vh,calc(100dvh-7rem))] w-[min(960px,calc(100vw-2rem))] max-md:left-4 max-md:right-4 max-md:w-auto"
          : "h-[min(500px,70vh)] w-[min(400px,calc(100vw-2rem))]"
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-assistant-title"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-700 px-3 py-2">
        <h2 id="ai-assistant-title" className="text-sm font-semibold text-zinc-100">
          Assistant
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setFontStep((s) => Math.max(0, s - 1))}
            disabled={!canDecreaseFont}
            className={cn(
              "rounded p-1.5 text-zinc-400 transition-all duration-200 motion-reduce:transition-none",
              "hover:bg-zinc-800 hover:text-zinc-100 active:scale-90",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
              "disabled:pointer-events-none disabled:opacity-35"
            )}
            aria-label="Decrease chat font size"
          >
            <Minus
              className="h-5 w-5 transition-transform duration-200 ease-out hover:scale-110 motion-reduce:transition-none"
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={() => setFontStep((s) => Math.min(FONT_STEPS.length - 1, s + 1))}
            disabled={!canIncreaseFont}
            className={cn(
              "rounded p-1.5 text-zinc-400 transition-all duration-200 motion-reduce:transition-none",
              "hover:bg-zinc-800 hover:text-zinc-100 active:scale-90",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
              "disabled:pointer-events-none disabled:opacity-35"
            )}
            aria-label="Increase chat font size"
          >
            <Plus
              className="h-5 w-5 transition-transform duration-200 ease-out hover:scale-110 motion-reduce:transition-none"
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="group relative rounded p-1.5 text-zinc-400 transition-transform duration-150 hover:bg-zinc-800 hover:text-zinc-100 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            aria-expanded={expanded}
            aria-label={expanded ? "Shrink assistant" : "Expand assistant"}
          >
            <span className="relative flex h-5 w-5 items-center justify-center">
              <Maximize2
                className={cn(
                  "absolute h-5 w-5 transition-all duration-300 ease-out motion-reduce:transition-none",
                  "group-hover:drop-shadow-[0_0_6px_rgba(52,211,153,0.35)]",
                  expanded
                    ? "scale-75 rotate-90 opacity-0"
                    : "scale-100 rotate-0 opacity-100"
                )}
                aria-hidden
              />
              <Minimize2
                className={cn(
                  "absolute h-5 w-5 transition-all duration-300 ease-out motion-reduce:transition-none",
                  "group-hover:drop-shadow-[0_0_6px_rgba(52,211,153,0.35)]",
                  expanded
                    ? "scale-100 rotate-0 opacity-100"
                    : "scale-75 -rotate-90 opacity-0"
                )}
                aria-hidden
              />
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close assistant"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3",
          chatFontClass
        )}
      >
        {entityTag && (
          <div className="rounded-md border border-emerald-800/40 bg-emerald-950/25 px-2 py-1.5 text-xs text-emerald-100/90">
            <span className="font-semibold text-emerald-400/95">
              {entityTypeLabel(entityTag.type)}:{" "}
            </span>
            <span className="text-zinc-200">{entityTag.label}</span>
            <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
              Workspace data is still available — ask anything, or focus on this
              item.
            </span>
          </div>
        )}

        {turns.length === 0 && !pendingQuestion && (
          <p className="text-zinc-500">
            Ask about goals, projects, milestones, companies, or team members.
          </p>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-md bg-zinc-800/80 px-2 py-1.5 text-zinc-200">
              <span className="font-medium text-zinc-400">You: </span>
              {t.question}
            </div>
            <div className="rounded-md border border-zinc-700/80 bg-zinc-950/50 px-2 py-1.5 text-zinc-200">
              <div className="mb-1.5 font-medium text-emerald-500/90">Answer</div>
              <AssistantMarkdown content={t.answer} className="text-inherit" />
            </div>
          </div>
        ))}

        {pendingQuestion && (
          <div className="space-y-2">
            <div className="rounded-md bg-zinc-800/80 px-2 py-1.5 text-zinc-200">
              <span className="font-medium text-zinc-400">You: </span>
              {pendingQuestion}
            </div>
            <div className="rounded-md border border-zinc-700/80 bg-zinc-950/50 px-2 py-1.5 text-zinc-200">
              <div className="mb-1.5 font-medium text-emerald-500/90">Answer</div>
              {loading && streaming === "" ? (
                <span className="text-zinc-500">Thinking…</span>
              ) : (
                <AssistantMarkdown content={streaming} className="text-inherit" />
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className={cn("border-t border-zinc-700 p-2", chatFontClass)}>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              entityTag
                ? `Ask about "${entityTag.label}" or the rest of the workspace…`
                : "Ask a question…"
            }
            rows={2}
            disabled={loading}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="self-end rounded-md bg-emerald-700 px-3 py-2 font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
