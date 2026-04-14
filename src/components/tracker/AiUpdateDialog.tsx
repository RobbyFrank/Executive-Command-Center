"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateGoal, updateProject } from "@/server/actions/tracker";

type MessageRole = "user" | "assistant";
interface Message {
  role: MessageRole;
  content: string;
}

interface GoalFieldProposal {
  measurableTarget: string;
  whyItMatters: string;
  currentValue: string;
}

interface ProjectFieldProposal {
  description: string;
  definitionOfDone: string;
}

type FieldProposal = GoalFieldProposal | ProjectFieldProposal;

function tryParseProposal(
  text: string,
  type: "goal" | "project",
): FieldProposal | null {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (!fenceMatch) return null;
  try {
    const parsed = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    if (type === "goal") {
      return {
        measurableTarget: String(parsed.measurableTarget ?? ""),
        whyItMatters: String(parsed.whyItMatters ?? ""),
        currentValue: String(parsed.currentValue ?? ""),
      };
    }
    return {
      description: String(parsed.description ?? ""),
      definitionOfDone: String(parsed.definitionOfDone ?? ""),
    };
  } catch {
    return null;
  }
}

function stripJsonFence(text: string): string {
  return text.replace(/```json[\s\S]*?```/, "").trim();
}

const GOAL_FIELD_LABELS: Record<keyof GoalFieldProposal, string> = {
  measurableTarget: "Description",
  whyItMatters: "Why",
  currentValue: "Current value",
};

const PROJECT_FIELD_LABELS: Record<keyof ProjectFieldProposal, string> = {
  description: "Description",
  definitionOfDone: "Done when",
};

function normalize(s: string): string {
  return String(s ?? "").replace(/\r\n/g, "\n").trim();
}

function fieldChanged(before: string, after: string): boolean {
  return normalize(before) !== normalize(after);
}

type AiUpdateDialogProps =
  | {
      type: "goal";
      goalId: string;
      measurableTarget: string;
      whyItMatters: string;
      currentValue: string;
      onClose: () => void;
    }
  | {
      type: "project";
      projectId: string;
      description: string;
      definitionOfDone: string;
      onClose: () => void;
    };

export function AiUpdateDialog(props: AiUpdateDialogProps) {
  const { type, onClose } = props;

  const initialGoal: GoalFieldProposal =
    props.type === "goal"
      ? {
          measurableTarget: props.measurableTarget,
          whyItMatters: props.whyItMatters,
          currentValue: props.currentValue,
        }
      : {
          measurableTarget: "",
          whyItMatters: "",
          currentValue: "",
        };

  const initialProject: ProjectFieldProposal =
    props.type === "project"
      ? {
          description: props.description,
          definitionOfDone: props.definitionOfDone,
        }
      : { description: "", definitionOfDone: "" };

  const currentFields =
    type === "goal"
      ? {
          measurableTarget: initialGoal.measurableTarget,
          whyItMatters: initialGoal.whyItMatters,
          currentValue: initialGoal.currentValue,
        }
      : {
          description: initialProject.description,
          definitionOfDone: initialProject.definitionOfDone,
        };

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<FieldProposal | null>(null);

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

      const body =
        type === "goal"
          ? {
              type: "goal" as const,
              goalId: props.goalId,
              currentFields,
              message: userMessage || undefined,
              history: userMessage ? history.slice(0, -1) : history,
            }
          : {
              type: "project" as const,
              projectId: props.projectId,
              currentFields,
              message: userMessage || undefined,
              history: userMessage ? history.slice(0, -1) : history,
            };

      try {
        const res = await fetch("/api/ai-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

        const parsed = tryParseProposal(full, type);
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
    [messages, type, props, currentFields],
  );

  const handleSend = useCallback(() => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    void sendMessage(q);
  }, [input, loading, sendMessage]);

  const handleApply = useCallback(async () => {
    if (!proposal) return;
    setApplying(true);
    setError(null);
    try {
      if (type === "goal" && props.type === "goal") {
        const p = proposal as GoalFieldProposal;
        const patch: Partial<{
          measurableTarget: string;
          whyItMatters: string;
          currentValue: string;
        }> = {};
        if (fieldChanged(props.measurableTarget, p.measurableTarget)) {
          patch.measurableTarget = p.measurableTarget;
        }
        if (fieldChanged(props.whyItMatters, p.whyItMatters)) {
          patch.whyItMatters = p.whyItMatters;
        }
        if (fieldChanged(props.currentValue, p.currentValue)) {
          patch.currentValue = p.currentValue;
        }
        if (Object.keys(patch).length > 0) {
          await updateGoal(props.goalId, patch);
        }
      } else if (type === "project" && props.type === "project") {
        const p = proposal as ProjectFieldProposal;
        const patch: Partial<{
          description: string;
          definitionOfDone: string;
        }> = {};
        if (fieldChanged(props.description, p.description)) {
          patch.description = p.description;
        }
        if (fieldChanged(props.definitionOfDone, p.definitionOfDone)) {
          patch.definitionOfDone = p.definitionOfDone;
        }
        if (Object.keys(patch).length > 0) {
          await updateProject(props.projectId, patch);
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  }, [proposal, type, props, onClose]);

  const fieldLabels =
    type === "goal" ? GOAL_FIELD_LABELS : PROJECT_FIELD_LABELS;

  const currentStreaming = streaming;
  const streamingProposal = currentStreaming
    ? tryParseProposal(currentStreaming, type)
    : null;
  const displayProposal = proposal ?? streamingProposal;

  const beforeRecord =
    type === "goal"
      ? (initialGoal as unknown as Record<string, string>)
      : (initialProject as unknown as Record<string, string>);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`AI update ${type}`}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(640px,90vh)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            AI &middot; Update {type} fields
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
          {messages.map((m, i) => (
            <div key={i}>
              {m.role === "user" ? (
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
              ) : (
                <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-zinc-300">
                  <span
                    className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                    aria-hidden
                  >
                    AI
                  </span>
                  <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                    {stripJsonFence(m.content) || (proposal ? null : m.content)}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && currentStreaming && (
            <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-zinc-300">
              <span
                className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                aria-hidden
              >
                AI
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap break-words [text-wrap:pretty]">
                {stripJsonFence(currentStreaming)}
              </div>
            </div>
          )}

          {loading && !currentStreaming && (
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}

          {displayProposal && (
            <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2.5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-500/80">
                Review changes
              </div>
              <div className="space-y-3">
                {Object.entries(fieldLabels).map(([key, label]) => {
                  const after = String(
                    (displayProposal as unknown as Record<string, unknown>)[
                      key
                    ] ?? "",
                  );
                  const before = beforeRecord[key] ?? "";
                  const changed = fieldChanged(before, after);
                  return (
                    <div
                      key={key}
                      className={cn(
                        "rounded border border-zinc-800/80 bg-zinc-950/40 p-2",
                        !changed && "opacity-60",
                      )}
                    >
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        {label}
                        {!changed && (
                          <span className="ml-2 font-normal normal-case text-zinc-600">
                            (unchanged)
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="mb-0.5 text-[10px] text-zinc-600">
                            Before
                          </div>
                          <div className="whitespace-pre-wrap text-xs text-zinc-400">
                            {before.trim() ? before : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] text-emerald-600/90">
                            After
                          </div>
                          <div
                            className={cn(
                              "whitespace-pre-wrap text-xs",
                              changed
                                ? "text-emerald-100/95"
                                : "text-zinc-500",
                            )}
                          >
                            {after.trim() ? after : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-zinc-700/80 px-4 py-2.5">
          {proposal ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={applying}
                className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Apply changes
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
                <label htmlFor="ai-update-answer" className="sr-only">
                  Your answer (Shift+Enter for a new line)
                </label>
                <textarea
                  id="ai-update-answer"
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
