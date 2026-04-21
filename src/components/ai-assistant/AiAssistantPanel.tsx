"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AArrowDown,
  AArrowUp,
  AtSign,
  Eraser,
  Loader2,
  Square,
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
import { useSmoothText } from "@/hooks/useSmoothText";
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
const PANEL_HEIGHT_STORAGE_KEY = "ecc-assistant-panel-height";
const MIN_PANEL_WIDTH = 450;
const MAX_PANEL_WIDTH_CAP = 960;
const PANEL_RIGHT_GUTTER_PX = 24;
const MD_BREAKPOINT_PX = 768;

const MIN_PANEL_HEIGHT = 650;
/** Left handle starts below the top resize strip so edges do not overlap. */
const TOP_RESIZE_STRIP_PX = 12;

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

function maxPanelHeightPx(): number {
  if (typeof window === "undefined") return 800;
  const vh = window.innerHeight;
  return Math.floor(Math.min(vh * 0.85, vh - 7 * 16));
}

function clampPanelHeight(h: number): number {
  return Math.min(maxPanelHeightPx(), Math.max(MIN_PANEL_HEIGHT, h));
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

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

export type SuggestionCategory =
  | "risk"
  | "growth"
  | "team"
  | "product"
  | "strategy"
  | "ops";

export type Suggestion = {
  short: string;
  full: string;
  category: SuggestionCategory;
};

const SUGGESTION_CATEGORIES: ReadonlySet<SuggestionCategory> = new Set([
  "risk",
  "growth",
  "team",
  "product",
  "strategy",
  "ops",
]);

function normalizeCategory(raw: unknown): SuggestionCategory {
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase() as SuggestionCategory;
    if (SUGGESTION_CATEGORIES.has(lower)) return lower;
  }
  return "strategy";
}

/**
 * Parses the JSONL suggestion stream incrementally. Each non-empty, parseable
 * line becomes one suggestion; the trailing (possibly half-written) line is
 * discarded so the UI never shows a half-typed card. The server may emit
 * occasional stray prose — we silently skip anything that doesn't parse or is
 * missing required fields.
 */
function parseStreamedSuggestions(raw: string): Suggestion[] {
  const lines = raw.split(/\r?\n/);
  const out: Suggestion[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^[,\[\]\s]+|[,\s]+$/g, "");
    if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(cleaned) as {
        short?: unknown;
        full?: unknown;
        category?: unknown;
      };
      const short =
        typeof parsed.short === "string" ? parsed.short.trim() : "";
      const full = typeof parsed.full === "string" ? parsed.full.trim() : "";
      if (!short || !full) continue;
      out.push({
        short,
        full,
        category: normalizeCategory(parsed.category),
      });
    } catch {
      /* partial or invalid JSON line */
    }
  }
  return out;
}

function mergeSuggestions(
  prev: Suggestion[],
  incoming: Suggestion[],
  maxAdd: number,
): Suggestion[] {
  const seen = new Set(prev.map((s) => s.short));
  const out = [...prev];
  let added = 0;
  for (const s of incoming) {
    if (added >= maxAdd) break;
    if (!seen.has(s.short)) {
      seen.add(s.short);
      out.push(s);
      added++;
    }
  }
  return out;
}

/** Full merged list (initial + “more”) for empty-chat restore after closing the panel. */
const SUGGESTION_LIST_CACHE_KEY = "ecc-assistant-suggestion-list-v1";

type StoredSuggestionListPayload = {
  revision: number;
  entityKey: string;
  items: Suggestion[];
};

function entityKeyFromTag(tag: AssistantEntityTag | null): string {
  return tag ? `${tag.type}:${tag.id}` : "none";
}

function readCachedSuggestionList(
  entityKey: string,
  revision: number,
): Suggestion[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUGGESTION_LIST_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredSuggestionListPayload;
    if (
      typeof data.revision !== "number" ||
      data.revision !== revision ||
      typeof data.entityKey !== "string" ||
      data.entityKey !== entityKey
    ) {
      return null;
    }
    if (!Array.isArray(data.items)) return null;
    const out: Suggestion[] = [];
    for (const item of data.items) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const short = typeof o.short === "string" ? o.short.trim() : "";
      const full = typeof o.full === "string" ? o.full.trim() : "";
      if (!short || !full) continue;
      out.push({
        short,
        full,
        category: normalizeCategory(o.category),
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function writeCachedSuggestionList(
  entityKey: string,
  revision: number,
  items: Suggestion[],
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredSuggestionListPayload = { revision, entityKey, items };
    localStorage.setItem(SUGGESTION_LIST_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

type CategoryTheme = {
  badge: string;
  card: string;
  hover: string;
  accent: string;
  label: string;
};

const CATEGORY_THEMES: Record<SuggestionCategory, CategoryTheme> = {
  risk: {
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    card: "border-rose-900/40 bg-gradient-to-br from-rose-950/40 via-zinc-900/80 to-zinc-900/80",
    hover:
      "hover:border-rose-700/70 hover:from-rose-950/70 hover:shadow-rose-900/20",
    accent: "text-rose-400/90",
    label: "Risk",
  },
  growth: {
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    card: "border-emerald-900/40 bg-gradient-to-br from-emerald-950/40 via-zinc-900/80 to-zinc-900/80",
    hover:
      "hover:border-emerald-700/70 hover:from-emerald-950/70 hover:shadow-emerald-900/20",
    accent: "text-emerald-400/90",
    label: "Growth",
  },
  team: {
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    card: "border-sky-900/40 bg-gradient-to-br from-sky-950/40 via-zinc-900/80 to-zinc-900/80",
    hover: "hover:border-sky-700/70 hover:from-sky-950/70 hover:shadow-sky-900/20",
    accent: "text-sky-400/90",
    label: "Team",
  },
  product: {
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    card: "border-violet-900/40 bg-gradient-to-br from-violet-950/40 via-zinc-900/80 to-zinc-900/80",
    hover:
      "hover:border-violet-700/70 hover:from-violet-950/70 hover:shadow-violet-900/20",
    accent: "text-violet-400/90",
    label: "Product",
  },
  strategy: {
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    card: "border-amber-900/40 bg-gradient-to-br from-amber-950/40 via-zinc-900/80 to-zinc-900/80",
    hover:
      "hover:border-amber-700/70 hover:from-amber-950/70 hover:shadow-amber-900/20",
    accent: "text-amber-400/90",
    label: "Strategy",
  },
  ops: {
    badge: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    card: "border-teal-900/40 bg-gradient-to-br from-teal-950/40 via-zinc-900/80 to-zinc-900/80",
    hover: "hover:border-teal-700/70 hover:from-teal-950/70 hover:shadow-teal-900/20",
    accent: "text-teal-400/90",
    label: "Ops",
  },
};

/** Four shimmer bubbles while the first batch streams in. */
function SuggestionSkeletons() {
  const heights = ["h-[84px]", "h-[96px]", "h-[72px]", "h-[92px]"];
  return (
    <>
      {heights.map((h, i) => (
        <div
          key={i}
          aria-hidden
          className={cn(
            "mb-2.5 block w-full break-inside-avoid rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5",
            h,
          )}
        >
          <div className="h-3 w-12 rounded-full bg-zinc-800/80" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-zinc-800/70" />
          <div className="mt-1.5 h-2.5 w-3/5 animate-pulse rounded bg-zinc-800/60" />
        </div>
      ))}
    </>
  );
}

/** Rendered at the end of the masonry while more questions are still streaming. */
function SuggestionPulseCard() {
  return (
    <div
      aria-hidden
      className="mb-2.5 block w-full [column-span:all] break-inside-avoid rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500/70" />
        Generating more
      </div>
      <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-zinc-800/60" />
      <div className="mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-zinc-800/50" />
    </div>
  );
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
  // Smooths the character-level reveal so the answer doesn't flicker on
  // every chunk from the server. See `useSmoothText` for details.
  const smoothedStreaming = useSmoothText(streaming, loading);
  const [fontStep, setFontStep] = useState(DEFAULT_FONT_STEP);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const [suggestionItems, setSuggestionItems] = useState<Suggestion[]>([]);
  const [suggestionsInitialLoading, setSuggestionsInitialLoading] =
    useState(false);
  const [suggestionsMoreLoading, setSuggestionsMoreLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestionsDone, setSuggestionsDone] = useState(false);

  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [isMdUp, setIsMdUp] = useState(false);
  const [resizeAxis, setResizeAxis] = useState<null | "ew" | "ns" | "nwse">(null);

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
      const rawW = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
      if (rawW != null) {
        const n = Number.parseInt(rawW, 10);
        if (Number.isFinite(n)) {
          setPanelWidth(clampPanelWidth(n));
        }
      }
      const rawH = localStorage.getItem(PANEL_HEIGHT_STORAGE_KEY);
      if (rawH != null) {
        const n = Number.parseInt(rawH, 10);
        if (Number.isFinite(n)) {
          setPanelHeight(clampPanelHeight(n));
        }
      }
    } catch {
      /* ignore */
    }
    return () => mq.removeEventListener("change", applyMq);
  }, []);

  useEffect(() => {
    function onResize() {
      setPanelWidth((w) => {
        if (w == null) return null;
        const next = clampPanelWidth(w);
        if (next !== w) {
          try {
            localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      });
      setPanelHeight((h) => {
        if (h == null) return null;
        const next = clampPanelHeight(h);
        if (next !== h) {
          try {
            localStorage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!resizeAxis) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor =
      resizeAxis === "ew"
        ? "ew-resize"
        : resizeAxis === "ns"
          ? "ns-resize"
          : "nwse-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [resizeAxis]);

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
    // Use the smoothed string so the scroll tracks the visible text growth
    // rather than jumping ahead on every raw server chunk.
  }, [turns, smoothedStreaming, pendingQuestion, loading]);

  // First batch: 4 from API, or restore full list (including prior “more” batches)
  // from localStorage when revision + entity still match.
  useEffect(() => {
    if (!turnsHydrated) return;
    if (turns.length > 0) return;
    if (entitiesLoading) return;

    const entityKey = entityKeyFromTag(entityTag);
    const revision = entityBundle?.revision;

    if (typeof revision === "number" && entityBundle !== null) {
      const cached = readCachedSuggestionList(entityKey, revision);
      if (cached !== null && cached.length > 0) {
        setSuggestionItems(cached);
        setSuggestionsError(null);
        setSuggestionsDone(true);
        setSuggestionsInitialLoading(false);
        return;
      }
    }

    const ac = new AbortController();
    let cancelled = false;
    setSuggestionItems([]);
    setSuggestionsError(null);
    setSuggestionsDone(false);
    setSuggestionsInitialLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/assistant/suggestions", {
          method: "POST",
          signal: ac.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            entityTag
              ? {
                  entityContext: {
                    type: entityTag.type,
                    id: entityTag.id,
                    label: entityTag.label,
                  },
                }
              : {},
          ),
        });
        if (cancelled) return;
        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parsed = parseStreamedSuggestions(buf).slice(0, 4);
          setSuggestionItems(parsed);
        }
        setSuggestionItems((prev) => {
          const final = parseStreamedSuggestions(buf).slice(0, 4);
          return final.length > 0 ? final : prev;
        });
        setSuggestionsDone(true);
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setSuggestionsError(
          e instanceof Error ? e.message : "Could not load suggestions",
        );
      } finally {
        if (!cancelled) setSuggestionsInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    turnsHydrated,
    turns.length,
    entityTag,
    entitiesLoading,
    entityBundle?.revision,
    entityBundle,
  ]);

  useEffect(() => {
    if (!turnsHydrated || turns.length > 0) return;
    const rev = entityBundle?.revision;
    if (typeof rev !== "number") return;
    if (suggestionItems.length === 0) return;
    writeCachedSuggestionList(
      entityKeyFromTag(entityTag),
      rev,
      suggestionItems,
    );
  }, [
    entityTag,
    entityBundle?.revision,
    suggestionItems,
    turns.length,
    turnsHydrated,
  ]);

  const fetchMoreSuggestions = useCallback(async () => {
    if (loading || suggestionsInitialLoading || suggestionsMoreLoading) return;
    if (suggestionItems.length === 0) return;
    setSuggestionsMoreLoading(true);
    setSuggestionsError(null);
    try {
      const res = await fetch("/api/assistant/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          more: true,
          exclude: suggestionItems.map((s) => ({
            short: s.short,
            full: s.full,
          })),
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
      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const incoming = parseStreamedSuggestions(buf);
        setSuggestionItems((prev) => mergeSuggestions(prev, incoming, 4));
      }
      setSuggestionItems((prev) =>
        mergeSuggestions(prev, parseStreamedSuggestions(buf), 4),
      );
    } catch (e) {
      setSuggestionsError(
        e instanceof Error ? e.message : "Could not load more suggestions",
      );
    } finally {
      setSuggestionsMoreLoading(false);
    }
  }, [
    entityTag,
    loading,
    suggestionItems,
    suggestionsInitialLoading,
    suggestionsMoreLoading,
  ]);

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

  const stopGeneration = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

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
    let full = "";

    const ac = new AbortController();
    streamAbortRef.current = ac;

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
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
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setPendingQuestion(null);
        return;
      }

      const decoder = new TextDecoder();
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
      if (isAbortError(e)) {
        if (full.length > 0) {
          setTurns((prev) => [...prev, { question: q, answer: full }]);
        }
        setStreaming("");
        setPendingQuestion(null);
        focusInputAfterAnswer = true;
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setPendingQuestion(null);
      }
    } finally {
      streamAbortRef.current = null;
      setLoading(false);
      if (focusInputAfterAnswer) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [input, loading, turns, entityTag, closeMention]);

  const chatFontClass = FONT_STEPS[fontStep];
  const canDecreaseFont = fontStep > 0;
  const canIncreaseFont = fontStep < FONT_STEPS.length - 1;

  const showSuggestions =
    turns.length === 0 &&
    !pendingQuestion &&
    (suggestionsInitialLoading ||
      suggestionsMoreLoading ||
      suggestionItems.length > 0 ||
      suggestionsError !== null ||
      (turnsHydrated && entitiesLoading));

  const applySuggestion = useCallback(
    (q: string) => {
      if (loading) return;
      setInput(q);
      closeMention();
      window.setTimeout(() => {
        const ta = inputRef.current;
        if (!ta) return;
        ta.focus();
        const end = q.length;
        ta.setSelectionRange(end, end);
        setInputSel(end);
      }, 0);
    },
    [loading, closeMention],
  );

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
        setResizeAxis(null);
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
      setResizeAxis("ew");
    },
    [isMdUp, panelWidth],
  );

  const onResizeTopPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMdUp || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = panelRef.current;
      const rect = el?.getBoundingClientRect();
      const startY = e.clientY;
      const startHeight =
        rect?.height ??
        clampPanelHeight(panelHeight ?? maxPanelHeightPx());

      function move(ev: PointerEvent) {
        if (ev.pointerId !== e.pointerId) return;
        const delta = ev.clientY - startY;
        setPanelHeight(clampPanelHeight(startHeight - delta));
      }

      function up(ev: PointerEvent) {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setResizeAxis(null);
        setPanelHeight((current) => {
          if (current != null) {
            try {
              localStorage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(current));
            } catch {
              /* ignore */
            }
          }
          return current;
        });
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      setResizeAxis("ns");
    },
    [isMdUp, panelHeight],
  );

  const onResizeCornerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMdUp || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = panelRef.current;
      const rect = el?.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = rect?.width ?? clampPanelWidth(panelWidth ?? maxPanelWidthPx());
      const startHeight =
        rect?.height ?? clampPanelHeight(panelHeight ?? maxPanelHeightPx());

      function move(ev: PointerEvent) {
        if (ev.pointerId !== e.pointerId) return;
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;
        setPanelWidth(clampPanelWidth(startWidth - deltaX));
        setPanelHeight(clampPanelHeight(startHeight - deltaY));
      }

      function up(ev: PointerEvent) {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;
        const w = clampPanelWidth(startWidth - deltaX);
        const h = clampPanelHeight(startHeight - deltaY);
        setPanelWidth(w);
        setPanelHeight(h);
        try {
          localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(w));
          localStorage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(h));
        } catch {
          /* ignore */
        }
        setResizeAxis(null);
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      setResizeAxis("nwse");
    },
    [isMdUp, panelWidth, panelHeight],
  );

  const panelUsesCustomHeight = isMdUp && panelHeight != null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-xl",
        !panelUsesCustomHeight && "h-[min(85vh,calc(100dvh-7rem))]",
        panelUsesCustomHeight && "min-h-[650px]",
        "max-md:left-4 max-md:right-4 max-md:w-auto",
        isMdUp && panelWidth == null && "w-[min(960px,calc(100vw-2rem))]",
        isMdUp && panelWidth != null && "min-w-[450px] max-w-[min(960px,calc(100vw-3rem))]",
        "origin-bottom-right transition-[opacity,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity motion-reduce:duration-200",
        visible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-3 scale-[0.96] opacity-0 motion-reduce:translate-y-0 motion-reduce:scale-100",
      )}
      style={
        isMdUp
          ? {
              ...(panelWidth != null ? { width: panelWidth } : {}),
              ...(panelHeight != null ? { height: panelHeight } : {}),
            }
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-assistant-title"
    >
      {isMdUp ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize assistant height"
            className={cn(
              "absolute right-0 top-0 z-[60] cursor-ns-resize touch-none select-none rounded-tr-md",
              "hover:bg-emerald-500/10",
            )}
            style={{
              left: TOP_RESIZE_STRIP_PX,
              height: TOP_RESIZE_STRIP_PX,
            }}
            onPointerDown={onResizeTopPointerDown}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize assistant width"
            className={cn(
              "absolute bottom-0 left-0 z-[60] w-3 cursor-ew-resize touch-none select-none rounded-bl-md",
              "hover:bg-emerald-500/10",
            )}
            style={{ top: TOP_RESIZE_STRIP_PX }}
            onPointerDown={onResizeHandlePointerDown}
          />
          <div
            role="group"
            aria-label="Resize assistant width and height"
            className={cn(
              "absolute left-0 top-0 z-[61] cursor-nwse-resize touch-none select-none rounded-tl-md",
              "hover:bg-emerald-500/10",
            )}
            style={{
              width: TOP_RESIZE_STRIP_PX,
              height: TOP_RESIZE_STRIP_PX,
            }}
            onPointerDown={onResizeCornerPointerDown}
          />
        </>
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

        {showSuggestions && (
          <div>
            {suggestionsError && suggestionItems.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Couldn&apos;t load suggestions — ask anything below.
              </p>
            ) : (
              <>
                {(entitiesLoading || suggestionsInitialLoading) &&
                suggestionItems.length === 0 ? (
                  <p
                    className="mb-3 text-center text-[13px] leading-snug text-zinc-500"
                    aria-live="polite"
                  >
                    {entitiesLoading && !suggestionsInitialLoading
                      ? "Syncing workspace…"
                      : "Drafting a few tailored questions from your workspace—almost there."}
                  </p>
                ) : null}
                <div
                  className="columns-1 gap-2.5 sm:columns-2"
                  aria-label="Suggested questions"
                >
                  {(entitiesLoading || suggestionsInitialLoading) &&
                  suggestionItems.length === 0 ? (
                    <SuggestionSkeletons />
                  ) : (
                    <>
                      {suggestionItems.map((s, i) => {
                        const theme = CATEGORY_THEMES[s.category];
                        return (
                          <button
                            key={`${s.short}-${i}`}
                            type="button"
                            onClick={() => applySuggestion(s.full)}
                            disabled={loading}
                            title={s.full}
                            className={cn(
                              "mb-2.5 block w-full break-inside-avoid rounded-xl border text-left shadow-sm",
                              "transition-all duration-150 ease-out motion-reduce:transition-none",
                              "px-3 py-2.5",
                              "hover:-translate-y-0.5 hover:shadow-md",
                              "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                              "disabled:pointer-events-none disabled:opacity-60",
                              theme.card,
                              theme.hover,
                            )}
                          >
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                theme.badge,
                              )}
                            >
                              {theme.label}
                            </span>
                            <div className="mt-1.5 text-[13px] font-semibold leading-snug text-zinc-100">
                              {s.short}
                            </div>
                            <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-zinc-400">
                              {s.full}
                            </div>
                          </button>
                        );
                      })}
                      {((suggestionsInitialLoading &&
                        !suggestionsDone &&
                        suggestionItems.length > 0) ||
                        suggestionsMoreLoading) && (
                        <SuggestionPulseCard />
                      )}
                    </>
                  )}
                </div>
                {suggestionItems.length > 0 && !suggestionsInitialLoading && (
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchMoreSuggestions()}
                      disabled={loading || suggestionsMoreLoading}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-200",
                        "transition-colors hover:border-emerald-700/60 hover:bg-emerald-950/30 hover:text-emerald-100",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      {suggestionsMoreLoading ? (
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin text-emerald-400/90"
                          aria-hidden
                        />
                      ) : null}
                      More suggestions
                    </button>
                    {suggestionsError ? (
                      <p
                        className="max-w-sm text-center text-xs text-rose-400/90"
                        role="alert"
                      >
                        {suggestionsError}
                      </p>
                    ) : null}
                  </div>
                )}
              </>
            )}
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
              {loading && smoothedStreaming === "" ? (
                <span className="text-zinc-500">Thinking…</span>
              ) : (
                <div className="relative">
                  <AssistantMarkdown
                    content={smoothedStreaming}
                    className="text-inherit"
                    people={entityBundle?.people ?? []}
                  />
                  {(loading ||
                    smoothedStreaming.length < streaming.length) && (
                    <span
                      aria-hidden
                      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-emerald-500/70 align-middle opacity-70"
                    />
                  )}
                </div>
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
          <div className="flex min-w-0 items-stretch gap-2">
            <div className="relative min-w-0 min-h-11 flex-1 self-stretch">
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
                className="box-border h-full min-h-11 w-full resize-none rounded-md border border-zinc-600 bg-zinc-950 px-2.5 py-2 pr-10 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
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
            {loading ? (
              <button
                type="button"
                onClick={stopGeneration}
                className="inline-flex min-h-11 min-w-[5.5rem] shrink-0 items-center justify-center gap-1.5 self-stretch rounded-md border border-rose-800/80 bg-rose-950/90 px-3 text-sm font-medium text-rose-50 hover:bg-rose-900/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim()}
                className="inline-flex min-h-11 min-w-[5.25rem] shrink-0 items-center justify-center self-stretch rounded-md bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
