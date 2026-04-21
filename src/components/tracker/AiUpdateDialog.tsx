"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  createMilestone,
  deleteMilestone,
  updateGoal,
  updateMilestone,
  updateProject,
} from "@/server/actions/tracker";
import { StreamingText } from "@/components/ui/StreamingText";
import { PriorityPillInline } from "@/components/tracker/PriorityPillInline";
import type { Milestone, Priority } from "@/lib/types/tracker";

type MessageRole = "user" | "assistant";
interface Message {
  role: MessageRole;
  content: string;
}

/** Same shape as "Draft a new goal with AI" / `GOAL_AI_PROPOSAL_FIELDS_BLOCK`. */
interface GoalFullProposal {
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

interface ProjectFullProposal {
  name: string;
  priority: string;
  description: string;
  definitionOfDone: string;
  complexityScore: number;
  milestones?: ProposedMilestone[];
}

function tryParseGoalFullProposal(text: string): GoalFullProposal | null {
  let jsonText: string | null = null;
  const closed = text.match(/```json\s*([\s\S]*?)```/);
  if (closed) {
    jsonText = closed[1].trim();
  } else {
    const open = text.match(/```json\s*([\s\S]*)$/);
    if (open) jsonText = open[1].replace(/```\s*$/, "").trim();
  }
  if (!jsonText) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      const slice = text.slice(first, last + 1).trim();
      if (/"(?:description|measurableTarget|whyItMatters)"\s*:/.test(slice)) {
        jsonText = slice;
      }
    }
  }
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const description = String(parsed.description ?? "").trim();
    if (!description) return null;
    return {
      description,
      priority: String(parsed.priority ?? "P2"),
      measurableTarget: String(parsed.measurableTarget ?? ""),
      whyItMatters: String(parsed.whyItMatters ?? ""),
      currentValue: String(parsed.currentValue ?? ""),
    };
  } catch {
    return null;
  }
}

/** Same fenced-json parsing strategy as {@link AiCreateDialog}. */
function tryParseProjectFullProposal(text: string): ProjectFullProposal | null {
  let jsonText: string | null = null;
  const closed = text.match(/```json\s*([\s\S]*?)```/);
  if (closed) {
    jsonText = closed[1].trim();
  } else {
    const open = text.match(/```json\s*([\s\S]*)$/);
    if (open) jsonText = open[1].replace(/```\s*$/, "").trim();
  }
  if (!jsonText) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      const slice = text.slice(first, last + 1).trim();
      if (/"(?:name|description|milestones)"\s*:/.test(slice)) {
        jsonText = slice;
      }
    }
  }
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const name = String(parsed.name ?? "");
    if (!name.trim()) return null;
    const rawMs = parsed.milestones;
    let milestones: ProposedMilestone[] | undefined;
    if (rawMs === undefined) {
      milestones = undefined;
    } else if (Array.isArray(rawMs)) {
      milestones = [];
      for (const item of rawMs) {
        if (!item || typeof item !== "object") continue;
        const m = item as { name?: unknown; targetDate?: unknown };
        const mn = typeof m.name === "string" ? m.name.trim() : "";
        if (!mn) continue;
        milestones.push({
          name: mn,
          targetDate:
            typeof m.targetDate === "string" ? m.targetDate.trim() : "",
        });
      }
    } else {
      milestones = undefined;
    }
    const rawCx = parsed.complexityScore;
    let complexityScore = 3;
    if (typeof rawCx === "number" && Number.isFinite(rawCx)) {
      complexityScore = Math.min(5, Math.max(1, Math.round(rawCx)));
    } else if (typeof rawCx === "string" && rawCx.trim() !== "") {
      const n = Number(rawCx.trim());
      if (Number.isFinite(n)) {
        complexityScore = Math.min(5, Math.max(1, Math.round(n)));
      }
    }
    return {
      name,
      priority: String(parsed.priority ?? "P2"),
      description: String(parsed.description ?? ""),
      definitionOfDone: String(parsed.definitionOfDone ?? ""),
      complexityScore,
      milestones,
    };
  } catch {
    return null;
  }
}

function stripJsonFence(text: string): string {
  return text.replace(/```json[\s\S]*?```/, "").trim();
}

function splitLeadInAndFencedBlock(text: string): { leadIn: string; fenced: string } {
  const idx = text.indexOf("```");
  if (idx === -1) {
    return { leadIn: text, fenced: "" };
  }
  return {
    leadIn: text.slice(0, idx).trimEnd(),
    fenced: text.slice(idx).trimStart(),
  };
}

const GOAL_FULL_FIELD_LABELS: Record<string, string> = {
  description: "Goal name",
  priority: "Priority",
  measurableTarget: "Description",
  whyItMatters: "Why",
  currentValue: "Current value",
};

const PROJECT_FULL_FIELD_LABELS: Record<string, string> = {
  name: "Project name",
  priority: "Priority",
  description: "Description",
  definitionOfDone: "Done when",
  complexityScore: "Complexity",
};

function normalize(s: string): string {
  return String(s ?? "").replace(/\r\n/g, "\n").trim();
}

function fieldChanged(before: string, after: string): boolean {
  return normalize(before) !== normalize(after);
}

function coercePriority(p: string): Priority {
  const s = p.trim().toUpperCase();
  if (s === "P0" || s === "P1" || s === "P2" || s === "P3") {
    return s as Priority;
  }
  return "P2";
}

type AiUpdateDialogProps =
  | {
      type: "goal";
      goalId: string;
      description: string;
      priority: Priority;
      measurableTarget: string;
      whyItMatters: string;
      currentValue: string;
      onClose: () => void;
    }
  | {
      type: "project";
      projectId: string;
      name: string;
      priority: Priority;
      description: string;
      definitionOfDone: string;
      complexityScore: number;
      milestones: Milestone[];
      onClose: () => void;
    };

export function AiUpdateDialog(props: AiUpdateDialogProps) {
  const { type, onClose } = props;

  const initialGoal: GoalFullProposal =
    props.type === "goal"
      ? {
          description: props.description,
          priority: props.priority,
          measurableTarget: props.measurableTarget,
          whyItMatters: props.whyItMatters,
          currentValue: props.currentValue,
        }
      : {
          description: "",
          priority: "P2",
          measurableTarget: "",
          whyItMatters: "",
          currentValue: "",
        };

  const goalCurrentFields =
    type === "goal"
      ? {
          description: initialGoal.description,
          priority: initialGoal.priority,
          measurableTarget: initialGoal.measurableTarget,
          whyItMatters: initialGoal.whyItMatters,
          currentValue: initialGoal.currentValue,
        }
      : null;

  const projectCurrentFields = useMemo(() => {
    if (props.type !== "project") return null;
    return {
      name: props.name,
      priority: props.priority,
      description: props.description,
      definitionOfDone: props.definitionOfDone,
      complexityScore: props.complexityScore,
      milestones: props.milestones.map((m) => ({
        name: m.name,
        targetDate: m.targetDate ?? "",
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- type-guarded fields on discriminated union; narrow deps to avoid rebuild-per-render from the whole props object
  }, [
    props.type,
    props.type === "project" ? props.name : "",
    props.type === "project" ? props.priority : "",
    props.type === "project" ? props.description : "",
    props.type === "project" ? props.definitionOfDone : "",
    props.type === "project" ? props.complexityScore : 0,
    props.type === "project" ? props.milestones : null,
  ]);

  /**
   * Seed the proposal with the current entity's fields so the dialog opens
   * showing it as-is (no AI call, no streaming). The AI only runs after the
   * user types a revision and clicks **Revise**.
   */
  const initialGoalProposal: GoalFullProposal | null =
    props.type === "goal" ? initialGoal : null;

  const initialProjectProposal: ProjectFullProposal | null =
    props.type === "project"
      ? {
          name: props.name,
          priority: props.priority,
          description: props.description,
          definitionOfDone: props.definitionOfDone,
          complexityScore: props.complexityScore,
          milestones: props.milestones.map((m) => ({
            name: m.name,
            targetDate: m.targetDate ?? "",
          })),
        }
      : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goalProposal, setGoalProposal] = useState<GoalFullProposal | null>(
    initialGoalProposal,
  );
  const [projectProposal, setProjectProposal] =
    useState<ProjectFullProposal | null>(initialProjectProposal);
  const [reviseFeedback, setReviseFeedback] = useState("");
  const [isRevising, setIsRevising] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const jsonStreamScrollRef = useRef<HTMLDivElement>(null);
  const reviseInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

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

  // Dialog opens with the current entity as the proposal and only calls the AI
  // when the user clicks Revise — no auto-start for either goals or projects.

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

      if (userMessage && (goalProposal || projectProposal)) {
        setIsRevising(true);
      }

      const history = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const currentFields =
        type === "goal"
          ? goalCurrentFields!
          : projectCurrentFields!;

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

        if (type === "goal") {
          const parsed = tryParseGoalFullProposal(full);
          if (parsed) {
            setGoalProposal(parsed);
          } else if (userMessage) {
            setError(
              "Could not parse a revised proposal from the response. The previous proposal is unchanged.",
            );
          }
        } else {
          const parsed = tryParseProjectFullProposal(full);
          if (parsed) {
            setProjectProposal(parsed);
          } else if (userMessage && projectProposal != null) {
            setError(
              "Could not parse a revised proposal from the response. The previous proposal is unchanged.",
            );
          }
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
    [
      messages,
      type,
      props,
      goalCurrentFields,
      projectCurrentFields,
      goalProposal,
      projectProposal,
    ],
  );

  const handleRevise = useCallback(() => {
    const q = reviseFeedback.trim();
    if (!q || loading) return;
    setError(null);
    void sendMessage(q);
  }, [reviseFeedback, loading, sendMessage]);

  const handleApply = useCallback(async () => {
    if (type === "goal") {
      if (!goalProposal || props.type !== "goal") return;
      setApplying(true);
      setError(null);
      try {
        const p = goalProposal;
        const pr = coercePriority(p.priority);
        const patch: Partial<{
          description: string;
          priority: Priority;
          measurableTarget: string;
          whyItMatters: string;
          currentValue: string;
        }> = {};
        if (fieldChanged(props.description, p.description)) {
          patch.description = p.description.trim() || props.description;
        }
        if (props.priority !== pr) {
          patch.priority = pr;
        }
        if (fieldChanged(props.measurableTarget, p.measurableTarget)) {
          patch.measurableTarget = p.measurableTarget;
        }
        if (fieldChanged(props.whyItMatters, p.whyItMatters)) {
          patch.whyItMatters = p.whyItMatters;
        }
        if (fieldChanged(props.currentValue, p.currentValue)) {
          patch.currentValue = p.currentValue;
        }
        let didPersist = Object.keys(patch).length > 0;
        if (Object.keys(patch).length > 0) {
          await updateGoal(props.goalId, patch);
        }
        if (didPersist) {
          toast.success("AI updates applied");
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to apply");
      } finally {
        setApplying(false);
      }
      return;
    }

    if (!projectProposal || props.type !== "project") return;
    setApplying(true);
    setError(null);
    try {
      const p = projectProposal;
      const pr = coercePriority(p.priority);
      const patch: Partial<{
        name: string;
        priority: Priority;
        description: string;
        definitionOfDone: string;
        complexityScore: number;
      }> = {};
      if (fieldChanged(props.name, p.name)) patch.name = p.name;
      if (props.priority !== pr) patch.priority = pr;
      if (fieldChanged(props.description, p.description)) {
        patch.description = p.description;
      }
      if (fieldChanged(props.definitionOfDone, p.definitionOfDone)) {
        patch.definitionOfDone = p.definitionOfDone;
      }
      if (props.complexityScore !== p.complexityScore) {
        patch.complexityScore = p.complexityScore;
      }
      let didPersist = Object.keys(patch).length > 0;
      if (Object.keys(patch).length > 0) {
        await updateProject(props.projectId, patch);
      }

      const proposedMs = p.milestones;
      if (proposedMs !== undefined) {
        const existing = [...props.milestones];

        for (let i = 0; i < proposedMs.length; i++) {
          const pm = proposedMs[i]!;
          if (i < existing.length) {
            const em = existing[i]!;
            const nameCh = fieldChanged(em.name, pm.name);
            const dateCh =
              normalize(em.targetDate ?? "") !== normalize(pm.targetDate);
            if (nameCh || dateCh) {
              await updateMilestone(em.id, {
                name: pm.name,
                targetDate: pm.targetDate ?? "",
              });
              didPersist = true;
            }
          } else {
            await createMilestone({
              projectId: props.projectId,
              name: pm.name,
              status: "Not Done",
              targetDate: pm.targetDate ?? "",
            });
            didPersist = true;
          }
        }

        for (let j = proposedMs.length; j < existing.length; j++) {
          const em = existing[j]!;
          if (em.status !== "Done") {
            await deleteMilestone(em.id);
            didPersist = true;
          }
        }
      }

      if (didPersist) {
        toast.success("AI updates applied");
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  }, [type, goalProposal, projectProposal, props, onClose]);

  if (type === "goal") {
    const currentStreaming = streaming;
    const streamingProposal = currentStreaming
      ? tryParseGoalFullProposal(currentStreaming)
      : null;
    const displayProposal = isRevising
      ? streamingProposal
      : (streamingProposal ?? goalProposal);

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
          aria-label="AI update goal"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(760px,92vh)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-100">
              AI &middot; Update goal
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

            {loading && currentStreaming && (() => {
              const { leadIn, fenced } = splitLeadInAndFencedBlock(currentStreaming);
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

            {displayProposal && (
              <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2.5">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-500/80">
                  Proposed goal
                </div>
                <dl className="space-y-1.5">
                  {Object.entries(GOAL_FULL_FIELD_LABELS).map(([key, label]) => {
                    const value =
                      (displayProposal as unknown as Record<string, unknown>)[
                        key
                      ];
                    const str = String(value ?? "");
                    return (
                      <div key={key}>
                        <dt className="text-xs text-zinc-500">{label}</dt>
                        <dd className="text-zinc-200">
                          {key === "priority" ? (
                            str.trim() ? (
                              <PriorityPillInline
                                priority={coercePriority(str)}
                              />
                            ) : (
                              <span className="text-zinc-500">—</span>
                            )
                          ) : (
                            str || "—"
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}

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
                    placeholder="e.g. Rename the goal, set priority to Urgent, tighten the measurable outcome…"
                    disabled={loading || applying}
                    className="min-h-11 min-w-0 flex-1 self-stretch rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    aria-label="Feedback to revise the proposal"
                  />
                  <button
                    type="button"
                    disabled={loading || applying || !reviseFeedback.trim()}
                    onClick={() => void handleRevise()}
                    className={cn(
                      "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-stretch rounded-md border px-4 text-sm font-medium sm:min-w-[7.5rem]",
                      loading
                        ? "cursor-wait border-zinc-500 bg-zinc-800 text-zinc-200"
                        : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40",
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
              <div className="flex items-center gap-2">
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
                  Apply changes
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

  /* --- Project: same proposal + revise loop as Draft a new project with AI --- */
  const currentStreaming = streaming;
  const streamingProposal = currentStreaming
    ? tryParseProjectFullProposal(currentStreaming)
    : null;
  const displayProposal = isRevising
    ? streamingProposal
    : (streamingProposal ?? projectProposal);

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
        aria-label="AI update project"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(760px,92vh)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            AI &middot; Update project
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
          {messages.map((m, i) => {
            if (m.role === "assistant") {
              const leadIn = stripJsonFence(m.content);
              // After the JSON has been applied to the proposal, the
              // assistant's raw reply adds no information — skip the
              // otherwise-empty bubble.
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

          {loading && currentStreaming && (() => {
            const { leadIn, fenced } = splitLeadInAndFencedBlock(currentStreaming);
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

          {displayProposal && (
            <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2.5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-500/80">
                Proposed project
              </div>
              <dl className="space-y-1.5">
                {Object.entries(PROJECT_FULL_FIELD_LABELS).map(([key, label]) => {
                  const value =
                    (displayProposal as unknown as Record<string, unknown>)[
                      key
                    ];
                  const str = String(value ?? "");
                  return (
                    <div key={key}>
                      <dt className="text-xs text-zinc-500">{label}</dt>
                      <dd className="text-zinc-200">
                        {key === "priority" ? (
                          str.trim() ? (
                            <PriorityPillInline
                              priority={coercePriority(str)}
                            />
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )
                        ) : key === "complexityScore" ? (
                          str
                        ) : (
                          str || "—"
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {displayProposal.milestones?.length ? (
                <div className="mt-3 border-t border-emerald-800/30 pt-2.5">
                  <div className="mb-1.5 text-xs text-zinc-500">Milestones</div>
                  <ol className="space-y-1">
                    {displayProposal.milestones.map((m, i) => (
                      <li
                        key={i}
                        className="flex items-baseline gap-2 text-zinc-200"
                      >
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                          {i + 1}.
                        </span>
                        <span className="min-w-0 flex-1">{m.name}</span>
                        {m.targetDate ? (
                          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                            {m.targetDate}
                          </span>
                        ) : null}
                      </li>
                    ))}
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
                  placeholder="e.g. Make priority Urgent, shorten the title, add a milestone for QA…"
                  disabled={loading || applying}
                  className="min-h-11 min-w-0 flex-1 self-stretch rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  aria-label="Feedback to revise the proposal"
                />
                <button
                  type="button"
                  disabled={loading || applying || !reviseFeedback.trim()}
                  onClick={() => void handleRevise()}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-stretch rounded-md border px-4 text-sm font-medium sm:min-w-[7.5rem]",
                    loading
                      ? "cursor-wait border-zinc-500 bg-zinc-800 text-zinc-200"
                      : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40",
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
            <div className="flex items-center gap-2">
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
                Apply changes
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
