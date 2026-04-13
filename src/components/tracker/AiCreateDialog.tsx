"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { X, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { createGoal, createProject, createMilestone } from "@/server/actions/tracker";

type MessageRole = "user" | "assistant";
interface Message {
  role: MessageRole;
  content: string;
}

interface GoalProposal {
  description: string;
  priority: string;
  measurableTarget: string;
  whyItMatters: string;
  currentValue: string;
}

interface ProposedMilestone {
  name: string;
  targetDate: string;
}

interface ProjectProposal {
  name: string;
  priority: string;
  description: string;
  definitionOfDone: string;
  complexityScore: number;
  milestones?: ProposedMilestone[];
}

type Proposal = GoalProposal | ProjectProposal;

function tryParseProposal(text: string): Proposal | null {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (!fenceMatch) return null;
  try {
    return JSON.parse(fenceMatch[1].trim()) as Proposal;
  } catch {
    return null;
  }
}

function stripJsonFence(text: string): string {
  return text.replace(/```json[\s\S]*?```/, "").trim();
}

const GOAL_FIELD_LABELS: Record<string, string> = {
  description: "Goal name",
  priority: "Priority",
  measurableTarget: "Description",
  whyItMatters: "Why it matters",
  currentValue: "Current state",
};

const PROJECT_FIELD_LABELS: Record<string, string> = {
  name: "Project name",
  priority: "Priority",
  description: "Description",
  definitionOfDone: "Done when",
  complexityScore: "Complexity",
};

interface AiCreateDialogProps {
  type: "goal" | "project";
  companyId?: string;
  goalId?: string;
  onCreated?: (id: string) => void;
  onClose: () => void;
}

export function AiCreateDialog({
  type,
  companyId,
  goalId,
  onCreated,
  onClose,
}: AiCreateDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, loading]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-start: send initial request on mount so AI asks its first question
  const hasStarted = useRef(false);
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void sendMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      setLoading(true);
      setError(null);
      setStreaming("");

      const newMessages: Message[] = userMessage
        ? [...messages, { role: "user" as const, content: userMessage }]
        : [...messages];

      if (userMessage) {
        setMessages(newMessages);
      }

      const history = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const res = await fetch("/api/ai-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            companyId,
            goalId,
            message: userMessage || undefined,
            history: userMessage ? history.slice(0, -1) : history,
          }),
        });

        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(errJson?.error ?? `Request failed (${res.status})`);
          setLoading(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError("No response body");
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

        const parsed = tryParseProposal(full);
        if (parsed) {
          setProposal(parsed);
        }

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: full },
        ]);
        setStreaming("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [messages, type, companyId, goalId],
  );

  const handleSend = useCallback(() => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    void sendMessage(q);
  }, [input, loading, sendMessage]);

  const handleCreate = useCallback(async () => {
    if (!proposal) return;
    setCreating(true);
    setError(null);
    try {
      if (type === "goal" && companyId) {
        const p = proposal as GoalProposal;
        const goal = await createGoal({
          companyId,
          description: p.description || "New goal",
          measurableTarget: p.measurableTarget || "",
          whyItMatters: p.whyItMatters || "",
          currentValue: p.currentValue || "",
          priority: (p.priority as "P0" | "P1" | "P2" | "P3") || "P2",
          impactScore: 3,
          confidenceScore: 0,
          costOfDelay: 3,
          ownerId: "",
          executionMode: "Async",
          slackChannel: "",
          status: "Not Started",
          atRisk: false,
          spotlight: false,
          reviewLog: [],
        });
        onCreated?.(goal.id);
      } else if (type === "project" && goalId) {
        const p = proposal as ProjectProposal;
        const project = await createProject({
          goalId,
          name: p.name || "New project",
          description: p.description || "",
          definitionOfDone: p.definitionOfDone || "",
          priority: (p.priority as "P0" | "P1" | "P2" | "P3") || "P2",
          complexityScore: p.complexityScore || 3,
          ownerId: "",
          assigneeIds: [],
          type: "Engineering",
          status: "Pending",
          startDate: "",
          targetDate: "",
          slackUrl: "",
          atRisk: false,
          spotlight: false,
          reviewLog: [],
        });
        if (p.milestones?.length) {
          for (const m of p.milestones) {
            await createMilestone({
              projectId: project.id,
              name: m.name,
              status: "Not Done",
              targetDate: m.targetDate || "",
            });
          }
        }
        onCreated?.(project.id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }, [proposal, type, companyId, goalId, onCreated, onClose]);

  const fieldLabels =
    type === "goal" ? GOAL_FIELD_LABELS : PROJECT_FIELD_LABELS;

  const currentStreaming = streaming;
  const streamingProposal = currentStreaming
    ? tryParseProposal(currentStreaming)
    : null;
  const displayProposal = proposal ?? streamingProposal;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`AI create ${type}`}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(600px,85vh)] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            AI &middot; New {type}
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

        {/* Chat area */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
        >
          {messages.map((m, i) => (
            <div key={i}>
              {m.role === "user" ? (
                <div className="flex gap-2.5 rounded-md bg-zinc-800/70 px-3 py-2 text-zinc-200">
                  <span
                    className="shrink-0 select-none font-semibold tabular-nums text-zinc-400"
                    aria-hidden
                  >
                    A
                  </span>
                  <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-zinc-300">
                  <span
                    className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                    aria-hidden
                  >
                    Q
                  </span>
                  <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                    {stripJsonFence(m.content) || (proposal ? null : m.content)}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Streaming text (before it's committed to messages) */}
          {loading && currentStreaming && (
            <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-zinc-300">
              <span
                className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                aria-hidden
              >
                Q
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                {stripJsonFence(currentStreaming)}
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {loading && !currentStreaming && (
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}

          {/* Proposal card */}
          {displayProposal && (
            <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2.5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-500/80">
                Proposed {type}
              </div>
              <dl className="space-y-1.5">
                {Object.entries(fieldLabels).map(([key, label]) => {
                    const value =
                    (displayProposal as unknown as Record<string, unknown>)[key] ?? "";
                  return (
                    <div key={key}>
                      <dt className="text-xs text-zinc-500">{label}</dt>
                      <dd className="text-zinc-200">
                        {String(value) || "—"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {type === "project" &&
                (displayProposal as ProjectProposal).milestones?.length ? (
                <div className="mt-3 border-t border-emerald-800/30 pt-2.5">
                  <div className="mb-1.5 text-xs text-zinc-500">
                    Milestones
                  </div>
                  <ol className="space-y-1">
                    {(displayProposal as ProjectProposal).milestones!.map(
                      (m, i) => (
                        <li
                          key={i}
                          className="flex items-baseline gap-2 text-zinc-200"
                        >
                          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                            {i + 1}.
                          </span>
                          <span className="min-w-0 flex-1">{m.name}</span>
                          {m.targetDate && (
                            <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                              {m.targetDate}
                            </span>
                          )}
                        </li>
                      ),
                    )}
                  </ol>
                </div>
              ) : null}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Input / action footer */}
        <div className="border-t border-zinc-700/80 px-4 py-2.5">
          {proposal ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Create {type}
                {type === "project" &&
                  (proposal as ProjectProposal | null)?.milestones?.length
                  ? ` + ${(proposal as ProjectProposal).milestones!.length} milestones`
                  : ""}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="relative min-w-0 flex-1">
                <label htmlFor="ai-create-answer" className="sr-only">
                  Your answer (Shift+Enter for a new line)
                </label>
                <textarea
                  id="ai-create-answer"
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={4}
                  placeholder="Your answer… (Shift+Enter for a new line)"
                  disabled={loading}
                  spellCheck
                  className="min-h-[5.5rem] max-h-48 w-full resize-y rounded-md border border-zinc-600 bg-zinc-950 px-2.5 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="shrink-0 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
