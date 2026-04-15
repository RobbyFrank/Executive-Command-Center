"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AArrowDown,
  AArrowUp,
  AtSign,
  Eraser,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantEntityTag } from "@/contexts/AssistantContext";
import { formatMentionLink } from "@/lib/assistantMentions";
import type {
  AssistantEntitiesBundle,
  AssistantEntityOption,
} from "@/lib/types/assistant-entities";
import { AssistantMarkdown } from "./AssistantMarkdown";
import {
  AssistantMentionPicker,
  countFlatItems,
  getNthFlatItem,
} from "./AssistantMentionPicker";
import { AssistantUserMessage } from "./AssistantUserMessage";

export type ChatTurn = {
  question: string;
  answer: string;
};

type HistoryMessage = { role: "user" | "assistant"; content: string };

const FONT_STEP_STORAGE_KEY = "ecc-assistant-font-step";
const CHAT_TURNS_STORAGE_KEY = "ecc-assistant-chat-turns";
const FONT_STEPS = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl"] as const;
/** Default is two steps below the previous default (text-lg → text-sm). */
const DEFAULT_FONT_STEP = 1;

const PANEL_WIDTH_STORAGE_KEY = "ecc-assistant-panel-width";
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH_CAP = 960;
const PANEL_RIGHT_GUTTER_PX = 24;
const MD_BREAKPOINT_PX = 768;

function maxPanelWidthPx(): number {
  if (typeof window === "undefined") return MAX_PANEL_WIDTH_CAP;
  return Math.min(
    MAX_PANEL_WIDTH_CAP,
    Math.max(MIN_PANEL_WIDTH, window.innerWidth - PANEL_RIGHT_GUTTER_PX * 2),
  );
}

function clampPanelWidth(w: number): number {
  return Math.min(maxPanelWidthPx(), Math.max(MIN_PANEL_WIDTH, w));
}

function readStoredTurns(): ChatTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_TURNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ChatTurn[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as { question?: unknown; answer?: unknown };
      if (typeof o.question === "string" && typeof o.answer === "string") {
        out.push({ question: o.question, answer: o.answer });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function readStoredFontStep(): number {
  if (typeof window === "undefined") return DEFAULT_FONT_STEP;
  const raw = localStorage.getItem(FONT_STEP_STORAGE_KEY);
  const n = raw !== null ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 0 || n >= FONT_STEPS.length) return DEFAULT_FONT_STEP;
  return n;
}

function entityTypeLabel(t: AssistantEntityTag["type"]): string {
  switch (t) {
    case "company":
      return "Company";
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

/** `@` opens the picker when it starts a token (not `a@b` email-style). */
function isMentionTriggerPosition(value: string, atIndex: number): boolean {
  if (atIndex < 0 || value[atIndex] !== "@") return false;
  if (atIndex === 0) return true;
  const prev = value[atIndex - 1];
  return /\s/.test(prev) || prev === "(";
}

export function AiAssistantPanel({
  onClose,
  entityTag,
  visible = true,
}: {
  onClose: () => void;
  entityTag: AssistantEntityTag | null;
  /** When false, plays the close animation (used by the FAB mount wrapper). Defaults to true. */
  visible?: boolean;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [turnsHydrated, setTurnsHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [inputSel, setInputSel] = useState(0);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontStep, setFontStep] = useState(DEFAULT_FONT_STEP);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [isMdUp, setIsMdUp] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const [entityBundle, setEntityBundle] = useState<AssistantEntitiesBundle | null>(
    null,
  );
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionStart(null);
    setMentionHighlight(0);
  }, []);

  useLayoutEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MD_BREAKPOINT_PX}px)`);
    const applyMq = () => setIsMdUp(mq.matches);
    applyMq();
    mq.addEventListener("change", applyMq);
    try {
      const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
      if (raw != null) {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n)) {
          setPanelWidth(clampPanelWidth(n));
        }
      }
    } catch {
      /* ignore */
    }
    return () => mq.removeEventListener("change", applyMq);
  }, []);

  useEffect(() => {
    function onResize() {
      setPanelWidth((w) => (w == null ? null : clampPanelWidth(w)));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isResizing]);

  useEffect(() => {
    setFontStep(readStoredFontStep());
  }, []);

  useEffect(() => {
    setTurns(readStoredTurns());
    setTurnsHydrated(true);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_STEP_STORAGE_KEY, String(fontStep));
    } catch {
      /* ignore quota / private mode */
    }
  }, [fontStep]);

  useEffect(() => {
    if (!turnsHydrated) return;
    try {
      localStorage.setItem(CHAT_TURNS_STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* ignore quota / private mode */
    }
  }, [turns, turnsHydrated]);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEntitiesLoading(true);
    setEntitiesError(null);
    void (async () => {
      try {
        const res = await fetch("/api/assistant/entities");
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }
        const data = (await res.json()) as AssistantEntitiesBundle;
        if (!cancelled) setEntityBundle(data);
      } catch (e) {
        if (!cancelled) {
          setEntitiesError(
            e instanceof Error ? e.message : "Could not load workspace list",
          );
        }
      } finally {
        if (!cancelled) setEntitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, streaming, pendingQuestion, loading]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (mentionOpen) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, mentionOpen]);

  const mentionQuery =
    mentionStart !== null
      ? input.slice(mentionStart + 1, inputSel)
      : "";

  const flatCount = entityBundle
    ? countFlatItems(entityBundle, mentionQuery)
    : 0;

  useEffect(() => {
    if (!mentionOpen || !entityBundle) return;
    const n = countFlatItems(entityBundle, mentionQuery);
    if (n === 0) return;
    setMentionHighlight((h) => Math.min(h, n - 1));
  }, [mentionQuery, entityBundle, mentionOpen]);

  const applyMention = useCallback(
    (item: AssistantEntityOption) => {
      if (mentionStart === null) return;
      const ta = inputRef.current;
      const cursor = ta?.selectionStart ?? input.length;
      const before = input.slice(0, mentionStart);
      const after = input.slice(cursor);
      const link = formatMentionLink(item.type, item.id, item.label);
      const next = before + link + after;
      const caret = (before + link).length;
      setInput(next);
      closeMention();
      window.setTimeout(() => {
        ta?.focus();
        ta?.setSelectionRange(caret, caret);
        setInputSel(caret);
      }, 0);
    },
    [input, mentionStart, closeMention],
  );

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    closeMention();
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
  }, [input, loading, turns, entityTag, closeMention]);

  const chatFontClass = FONT_STEPS[fontStep];
  const canDecreaseFont = fontStep > 0;
  const canIncreaseFont = fontStep < FONT_STEPS.length - 1;

  const resetChat = useCallback(() => {
    if (loading) return;
    closeMention();
    setTurns([]);
    setInput("");
    setError(null);
    setPendingQuestion(null);
    setStreaming("");
  }, [loading, closeMention]);

  const canResetChat =
    !loading && (turns.length > 0 || error !== null);

  const onInsertAtClick = useCallback(() => {
    if (loading) return;
    const ta = inputRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? input.length;
    const end = ta.selectionEnd ?? start;
    const next = `${input.slice(0, start)}@${input.slice(end)}`;
    const atPos = start;
    setInput(next);
    setMentionStart(atPos);
    setMentionOpen(true);
    setMentionHighlight(0);
    window.setTimeout(() => {
      ta.focus();
      const pos = atPos + 1;
      ta.setSelectionRange(pos, pos);
      setInputSel(pos);
    }, 0);
  }, [input, loading]);

  const onResizeHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMdUp || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = panelRef.current;
      const rect = el?.getBoundingClientRect();
      const startX = e.clientX;
      const startWidth = rect?.width ?? clampPanelWidth(panelWidth ?? maxPanelWidthPx());

      function move(ev: PointerEvent) {
        if (ev.pointerId !== e.pointerId) return;
        const delta = ev.clientX - startX;
        setPanelWidth(clampPanelWidth(startWidth - delta));
      }

      function up(ev: PointerEvent) {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setIsResizing(false);
        setPanelWidth((current) => {
          if (current != null) {
            try {
              localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(current));
            } catch {
              /* ignore */
            }
          }
          return current;
        });
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      setIsResizing(true);
    },
    [isMdUp, panelWidth],
  );

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bottom-24 right-6 z-50 flex h-[min(85vh,calc(100dvh-7rem))] flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-xl",
        "max-md:left-4 max-md:right-4 max-md:w-auto",
        isMdUp && panelWidth == null && "w-[min(960px,calc(100vw-2rem))]",
        isMdUp && panelWidth != null && "min-w-[300px] max-w-[min(960px,calc(100vw-3rem))]",
        "origin-bottom-right transition-[opacity,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity motion-reduce:duration-200",
        visible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-3 scale-[0.96] opacity-0 motion-reduce:translate-y-0 motion-reduce:scale-100",
      )}
      style={
        isMdUp && panelWidth != null ? { width: panelWidth } : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-assistant-title"
    >
      {isMdUp ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant width"
          className={cn(
            "absolute left-0 top-0 z-[60] w-3 cursor-ew-resize touch-none select-none rounded-l-md",
            "hover:bg-emerald-500/10",
            "after:pointer-events-none after:absolute after:inset-y-4 after:right-0 after:w-px after:bg-zinc-500/80",
          )}
          onPointerDown={onResizeHandlePointerDown}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-700 px-3 py-2">
        <h2 id="ai-assistant-title" className="text-sm font-semibold text-zinc-100">
          Assistant
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={resetChat}
            disabled={!canResetChat}
            title="Clear conversation history (starts a fresh chat)"
            className={cn(
              "rounded p-1.5 text-zinc-400 transition-all duration-200 motion-reduce:transition-none",
              "hover:bg-zinc-800 hover:text-zinc-100 active:scale-90",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
              "disabled:pointer-events-none disabled:opacity-35",
            )}
            aria-label="Reset chat — clear conversation history"
          >
            <Eraser
              className="h-5 w-5 transition-transform duration-200 ease-out hover:scale-110 motion-reduce:transition-none"
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={() => setFontStep((s) => Math.max(0, s - 1))}
            disabled={!canDecreaseFont}
            className={cn(
              "rounded p-1.5 text-zinc-400 transition-all duration-200 motion-reduce:transition-none",
              "hover:bg-zinc-800 hover:text-zinc-100 active:scale-90",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
              "disabled:pointer-events-none disabled:opacity-35",
            )}
            aria-label="Decrease chat font size"
          >
            <AArrowDown
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
            <AArrowUp
              className="h-5 w-5 transition-transform duration-200 ease-out hover:scale-110 motion-reduce:transition-none"
              aria-hidden
            />
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

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-md bg-zinc-800/80 px-2 py-1.5 text-zinc-200">
              <span className="font-medium text-zinc-400">You: </span>
              <AssistantUserMessage text={t.question} />
            </div>
            <div className="rounded-md border border-zinc-700/80 bg-zinc-950/50 px-2 py-1.5 text-zinc-200">
              <div className="mb-1.5 font-medium text-emerald-500/90">Answer</div>
              <AssistantMarkdown
                content={t.answer}
                className="text-inherit"
                people={entityBundle?.people ?? []}
              />
            </div>
          </div>
        ))}

        {pendingQuestion && (
          <div className="space-y-2">
            <div className="rounded-md bg-zinc-800/80 px-2 py-1.5 text-zinc-200">
              <span className="font-medium text-zinc-400">You: </span>
              <AssistantUserMessage text={pendingQuestion} />
            </div>
            <div className="rounded-md border border-zinc-700/80 bg-zinc-950/50 px-2 py-1.5 text-zinc-200">
              <div className="mb-1.5 font-medium text-emerald-500/90">Answer</div>
              {loading && streaming === "" ? (
                <span className="text-zinc-500">Thinking…</span>
              ) : (
                <AssistantMarkdown
                  content={streaming}
                  className="text-inherit"
                  people={entityBundle?.people ?? []}
                />
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
        <div className="relative">
          <AssistantMentionPicker
            bundle={entityBundle}
            query={mentionQuery}
            loading={entitiesLoading}
            error={entitiesError}
            open={mentionOpen}
            highlightedIndex={mentionHighlight}
            onHighlightedIndexChange={setMentionHighlight}
            onSelect={(item) => {
              applyMention(item);
            }}
          />
          <div className="flex items-end gap-2">
            <div className="relative min-w-0 flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  const sel = e.target.selectionStart ?? v.length;
                  setInput(v);
                  setInputSel(sel);

                  const justTypedAt =
                    !loading &&
                    sel > 0 &&
                    v[sel - 1] === "@" &&
                    isMentionTriggerPosition(v, sel - 1);

                  if (mentionStart !== null) {
                    if (
                      justTypedAt ||
                      sel < mentionStart ||
                      v[mentionStart] !== "@" ||
                      !isMentionTriggerPosition(v, mentionStart)
                    ) {
                      closeMention();
                    }
                  }

                  if (justTypedAt) {
                    setMentionStart(sel - 1);
                    setMentionOpen(true);
                    setMentionHighlight(0);
                  }
                }}
                onSelect={(e) => {
                  setInputSel(e.currentTarget.selectionStart ?? 0);
                }}
                onKeyDown={(e) => {
                  if (mentionOpen) {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      closeMention();
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (flatCount > 0) {
                        setMentionHighlight((h) =>
                          Math.min(h + 1, flatCount - 1),
                        );
                      }
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionHighlight((h) => Math.max(0, h - 1));
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const item = getNthFlatItem(
                        entityBundle,
                        mentionQuery,
                        mentionHighlight,
                      );
                      if (item) applyMention(item);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  entityTag
                    ? `Ask about "${entityTag.label}" or the rest of the workspace…`
                    : "Ask a question… (@ to tag)"
                }
                rows={2}
                disabled={loading}
                className="min-h-[44px] w-full resize-none rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 pr-10 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={onInsertAtClick}
                disabled={loading}
                className={cn(
                  "absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-zinc-500 transition-colors",
                  "hover:bg-zinc-800 hover:text-emerald-400/90",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                  "disabled:pointer-events-none disabled:opacity-40",
                )}
                title="Tag company, goal, project, or milestone"
                aria-label="Insert at-tag for workspace item"
              >
                <AtSign className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="inline-flex h-[44px] shrink-0 items-center justify-center rounded-md bg-emerald-700 px-3 font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
