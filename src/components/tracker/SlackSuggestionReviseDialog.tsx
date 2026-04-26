"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Person } from "@/lib/types/tracker";
import type { SlackSuggestionRecord } from "@/lib/schemas/tracker";
import {
  SlackScrapeSuggestionSchema,
  type SlackScrapeSuggestion,
} from "@/lib/schemas/tracker";
import { StreamingText } from "@/components/ui/StreamingText";
import { SlackScrapeEvidencePreview } from "./SlackScrapeEvidencePreview";
import {
  approveSlackSuggestion,
  updateSlackSuggestionPayload,
} from "@/server/actions/slackSuggestions";
import { useRouter } from "next/navigation";
import { slackSuggestionKindTitle } from "@/lib/slackSuggestionKindTitle";

type Message = { role: "user" | "assistant"; content: string };

function stripJsonFence(text: string): string {
  return text.replace(/```json[\s\S]*?```/, "").trim();
}

function splitLeadInAndFencedBlock(text: string): {
  leadIn: string;
  fenced: string;
} {
  const idx = text.indexOf("```");
  if (idx === -1) {
    return { leadIn: text, fenced: "" };
  }
  return {
    leadIn: text.slice(0, idx).trimEnd(),
    fenced: text.slice(idx).trimStart(),
  };
}

function tryParseSlackScrapeSuggestion(
  text: string,
  expectedKind: SlackScrapeSuggestion["kind"]
): SlackScrapeSuggestion | null {
  let jsonText: string | null = null;
  const closed = text.match(/```json\s*([\s\S]*?)```/);
  if (closed) jsonText = closed[1]!.trim();
  else {
    const open = text.match(/```json\s*([\s\S]*)$/);
    if (open) jsonText = open[1]!.replace(/```\s*$/, "").trim();
  }
  if (!jsonText) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      const slice = text.slice(first, last + 1).trim();
      if (/"(?:kind|evidence)"\s*:/.test(slice)) jsonText = slice;
    }
  }
  if (!jsonText) return null;
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const r = SlackScrapeSuggestionSchema.safeParse(raw);
    if (!r.success) return null;
    if (r.data.kind !== expectedKind) return null;
    return r.data;
  } catch {
    return null;
  }
}

export function SlackSuggestionReviseDialog({
  rec,
  people,
  onClose,
  onApproved,
}: {
  rec: SlackSuggestionRecord;
  people: Person[];
  onClose: () => void;
  onApproved?: () => void;
}) {
  const router = useRouter();
  const expectedKind = rec.payload.kind;
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<SlackScrapeSuggestion>(rec.payload);
  const [didRevise, setDidRevise] = useState(false);
  const [reviseFeedback, setReviseFeedback] = useState("");
  const [isRevising, setIsRevising] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const jsonStreamScrollRef = useRef<HTMLDivElement>(null);
  const reviseInputRef = useRef<HTMLInputElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const titleRec = { ...rec, payload: proposal };

  useEffect(() => {
    const id = window.setTimeout(() => reviseInputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, loading]);

  useEffect(() => {
    const el = jsonStreamScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streaming]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading && !applying) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading, applying]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;

      setLoading(true);
      setError(null);
      setStreaming("");

      const newMessages: Message[] = userMessage
        ? [...messages, { role: "user" as const, content: userMessage }]
        : [...messages];

      if (userMessage) {
        setMessages(newMessages);
      }

      if (userMessage) {
        setIsRevising(true);
      }

      const history = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const res = await fetch("/api/slack-suggestions/revise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: rec.id,
            message: userMessage,
            history: userMessage ? history.slice(0, -1) : history,
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!ac.signal.aborted) {
            setError(errJson?.error ?? `Request failed (${res.status})`);
          }
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError("No response body");
          return;
        }

        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          if (!ac.signal.aborted) {
            setStreaming(full);
          }
        }

        if (ac.signal.aborted) return;

        const parsed = tryParseSlackScrapeSuggestion(full, expectedKind);
        if (parsed) {
          setProposal(parsed);
          setDidRevise(true);
        } else if (userMessage) {
          setError(
            "Could not parse a revised suggestion from the response. The previous proposal is unchanged."
          );
        }
        setReviseFeedback("");

        setMessages((prev) => [...prev, { role: "assistant", content: full }]);
        setStreaming("");
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (!ac.signal.aborted) {
          setError(e instanceof Error ? e.message : "Something went wrong");
        }
      } finally {
        if (streamAbortRef.current !== ac) return;
        setLoading(false);
        setIsRevising(false);
        setTimeout(() => reviseInputRef.current?.focus(), 0);
      }
    },
    [messages, rec.id, expectedKind]
  );

  const handleRevise = useCallback(() => {
    const q = reviseFeedback.trim();
    if (!q || loading) return;
    setError(null);
    void sendMessage(q);
  }, [reviseFeedback, loading, sendMessage]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      if (didRevise) {
        const u = await updateSlackSuggestionPayload(rec.id, proposal);
        if (!u.ok) {
          toast.error(u.error);
          return;
        }
      }
      const a = await approveSlackSuggestion(rec.id);
      if (a && typeof a === "object" && "ok" in a && a.ok === false) {
        toast.error((a as { error?: string }).error ?? "Approve failed");
        return;
      }
      toast.success(didRevise ? "Approved revised suggestion" : "Approved");
      onApproved?.();
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  }, [didRevise, proposal, rec.id, onApproved, onClose, router]);

  const currentStreaming = streaming;
  const streamingProposal = currentStreaming
    ? tryParseSlackScrapeSuggestion(currentStreaming, expectedKind)
    : null;
  const displayProposal = isRevising
    ? (streamingProposal ?? proposal)
    : (streamingProposal ?? proposal);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Revise Slack suggestion with AI"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(760px,92vh)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Sparkles className="h-4 w-4 text-amber-400/90" aria-hidden />
            AI · Revise Slack suggestion
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
        >
          <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2">
            <p className="text-xs font-medium text-zinc-200">
              {slackSuggestionKindTitle(titleRec, people)}
            </p>
            {rec.rationale ? (
              <p className="mt-1 text-xs text-zinc-500">{rec.rationale}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Evidence
            </p>
            {rec.payload.evidence.map((ev, i) => (
              <SlackScrapeEvidencePreview
                key={`${ev.ts}-${i}`}
                evidence={ev}
                people={people}
                channelLabel={ev.channel}
              />
            ))}
          </div>

          {messages.map((m, i) => {
            if (m.role === "assistant") {
              const leadIn = stripJsonFence(m.content);
              if (!leadIn) return null;
              return (
                <div key={i}>
                  <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-zinc-300">
                    <span
                      className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                      aria-hidden
                    >
                      AI
                    </span>
                    <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                      {leadIn}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={i}>
                <div className="flex gap-2.5 rounded-md bg-zinc-800/70 px-3 py-2 text-zinc-200">
                  <span
                    className="shrink-0 select-none font-semibold tabular-nums text-zinc-400"
                    aria-hidden
                  >
                    You
                  </span>
                  <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                    {m.content}
                  </div>
                </div>
              </div>
            );
          })}

          {loading &&
            currentStreaming &&
            (() => {
              const { leadIn, fenced } =
                splitLeadInAndFencedBlock(currentStreaming);
              const leadStreaming = !fenced;
              const leadText = leadStreaming ? currentStreaming : leadIn;
              return (
                <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-zinc-300">
                  <span
                    className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                    aria-hidden
                  >
                    AI
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <StreamingText
                      text={leadText}
                      isStreaming={loading && leadStreaming}
                      className="min-w-0 whitespace-pre-wrap break-words [text-wrap:pretty]"
                      caretClassName="bg-amber-400/70"
                    />
                    {fenced ? (
                      <div
                        ref={jsonStreamScrollRef}
                        className="max-h-[min(260px,38vh)] overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-900/80 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-400"
                      >
                        <StreamingText
                          text={fenced}
                          isStreaming={loading}
                          className="block min-w-0 whitespace-pre-wrap break-words"
                          caretClassName="bg-amber-400/70"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })()}

          {loading && !currentStreaming && (
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}

          <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2.5">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-500/80">
              Current proposal (JSON)
            </div>
            <pre className="max-h-[min(220px,32vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(displayProposal, null, 2)}
            </pre>
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-zinc-700/80 px-4 py-2.5">
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Revise with AI
              </p>
              <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-stretch">
                <input
                  ref={reviseInputRef}
                  type="text"
                  value={reviseFeedback}
                  onChange={(e) => setReviseFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void handleRevise();
                  }}
                  placeholder="e.g. Narrow the goal, change priority to P0, fix project names…"
                  disabled={loading || applying}
                  className="min-h-11 min-w-0 flex-1 self-stretch rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  aria-label="Feedback to revise the suggestion"
                />
                <button
                  type="button"
                  disabled={loading || applying || !reviseFeedback.trim()}
                  onClick={() => void handleRevise()}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-stretch rounded-md border px-4 text-sm font-medium sm:min-w-[7.5rem]",
                    loading
                      ? "cursor-wait border-zinc-500 bg-zinc-800 text-zinc-200"
                      : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                  )}
                >
                  {loading ? (
                    <>
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-zinc-400"
                        aria-hidden
                      />
                      Revising…
                    </>
                  ) : (
                    "Revise"
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={applying || loading}
                className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Apply &amp; approve
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={applying || loading}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
