"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createGoal, createProject, createMilestone } from "@/server/actions/tracker";
import { StreamingText } from "@/components/ui/StreamingText";
import {
  CATEGORY_META,
  normalizeIdeaCategory,
  type IdeaCategory,
} from "@/lib/ideaCategory";

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

interface Idea {
  title: string;
  rationale: string;
  category: IdeaCategory;
}

interface IdeaShortlist {
  ideas: Idea[];
}

type FencedPayload =
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "ideas"; ideas: IdeaShortlist["ideas"] }
  | null;

function tryParseFenced(text: string): FencedPayload {
  // Accept either a fully-closed ```json ... ``` block (the happy path)
  // or a fenced-open-but-unclosed tail (`max_tokens` truncation, dropped
  // trailing ticks). We also try bare JSON if no fence markers at all —
  // Claude occasionally forgets the fence when the system prompt is long.
  let jsonText: string | null = null;
  const closed = text.match(/```json\s*([\s\S]*?)```/);
  if (closed) {
    jsonText = closed[1].trim();
  } else {
    const open = text.match(/```json\s*([\s\S]*)$/);
    if (open) jsonText = open[1].replace(/```\s*$/, "").trim();
  }
  if (!jsonText) {
    // Bare JSON fallback: take the outermost {...} block if it looks
    // like an ideas/proposal object.
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      const slice = text.slice(first, last + 1).trim();
      if (/"(?:ideas|description|name)"\s*:/.test(slice)) {
        jsonText = slice;
      }
    }
  }
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { ideas?: unknown }).ideas)
    ) {
      const rawIdeas = (parsed as { ideas: unknown[] }).ideas;
      const ideas: Idea[] = [];
      for (const item of rawIdeas) {
        if (!item || typeof item !== "object") continue;
        const it = item as {
          title?: unknown;
          rationale?: unknown;
          category?: unknown;
        };
        if (typeof it.title !== "string" || !it.title.trim()) continue;
        ideas.push({
          title: it.title.trim(),
          rationale:
            typeof it.rationale === "string" ? it.rationale.trim() : "",
          category: normalizeIdeaCategory(it.category),
        });
      }
      if (!ideas.length) return null;
      return { kind: "ideas", ideas };
    }
    return { kind: "proposal", proposal: parsed as Proposal };
  } catch {
    return null;
  }
}

function tryParseProposal(text: string): Proposal | null {
  const payload = tryParseFenced(text);
  return payload && payload.kind === "proposal" ? payload.proposal : null;
}

function stripJsonFence(text: string): string {
  return text.replace(/```json[\s\S]*?```/, "").trim();
}

/**
 * Splits the model reply at the first fenced-code marker so the human lead-in
 * (e.g. "Here are a few directions…") can stay above the scrolling JSON
 * block while the fence is still open during streaming.
 */
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

/**
 * When the user clicks an idea from the Think-for-me shortlist, we send a
 * verbose instructional prompt so the model produces a full proposal. That
 * prompt is ugly in the chat transcript, so we detect it and render a short
 * "You picked: …" line instead.
 */
function extractPickedIdeaTitle(content: string): string | null {
  const m = content.match(/^I'll go with idea #\d+:\s*"([^"]+)"/);
  return m ? m[1] : null;
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
  /** When creating a project from onboarding, pre-seeds the first AI turn. */
  projectSeed?: {
    suggestedName?: string;
    suggestedDefinitionOfDone?: string;
  };
  onCreated?: (id: string) => void;
  onClose: () => void;
}

export function AiCreateDialog({
  type,
  companyId,
  goalId,
  projectSeed,
  onCreated,
  onClose,
}: AiCreateDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reviseFeedback, setReviseFeedback] = useState("");
  // True while a revision is in-flight so we hide the previous proposal card
  // and only show the new one as it streams in.
  const [isRevising, setIsRevising] = useState(false);
  // Shortlist from the initial auto-brainstorm stage. When non-null, the dialog
  // shows a picker and clicking one expands it into a full proposal.
  const [ideas, setIdeas] = useState<IdeaShortlist["ideas"] | null>(null);
  // Index of the idea currently being expanded (so we can show a spinner
  // on just that row instead of the whole list).
  const [expandingIdeaIndex, setExpandingIdeaIndex] = useState<number | null>(
    null,
  );
  // Soft-hides the shortlist while an expansion is streaming so the user
  // can focus on the proposal being generated. Re-shown automatically if
  // the stream fails before producing a parseable proposal.
  const [hideIdeas, setHideIdeas] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const jsonStreamScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reviseInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    const el = jsonStreamScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streaming]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading && !creating) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading, creating]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (
      userMessage: string,
      opts?: {
        autoMode?: "ideas" | "expand";
        resetConversation?: boolean;
      },
    ) => {
      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;

      setLoading(true);
      setError(null);
      setStreaming("");

      // When starting a fresh auto flow we restart the conversation even if
      // the user had answered a question or two. This guarantees the server
      // hits its "no history, no message" auto-seed branch.
      const resetHistory = opts?.resetConversation === true;
      const baseMessages: Message[] = resetHistory ? [] : messages;
      const newMessages: Message[] = userMessage
        ? [...baseMessages, { role: "user" as const, content: userMessage }]
        : [...baseMessages];

      if (resetHistory) {
        setMessages(userMessage ? newMessages : []);
      } else if (userMessage) {
        setMessages(newMessages);
      }

      const history = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let focusReviseAfter = false;

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
            // "Think for me" (stage A): tells the API to return a shortlist
            // of ideas instead of a full proposal. Stage B expansions are
            // plain follow-up messages with no autoMode.
            autoMode: opts?.autoMode,
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
          if (!ac.signal.aborted) {
            setError("No response body");
          }
          return;
        }

        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          if (!ac.signal.aborted) setStreaming(full);
        }

        if (ac.signal.aborted) return;

        const parsed = tryParseFenced(full);
        if (process.env.NODE_ENV !== "production") {
          // Dev-only: surface the raw Claude reply + parse result so it's
          // easy to see why an ideas/proposal didn't render.
          console.debug("[ai-create] reply", {
            autoMode: opts?.autoMode,
            length: full.length,
            parsedKind: parsed?.kind ?? null,
            preview: full.slice(0, 400),
          });
        }
        if (parsed?.kind === "ideas") {
          setIdeas(parsed.ideas);
          // Clear any previous proposal so the picker is the only thing visible.
          setProposal(null);
          focusReviseAfter = false;
        } else if (parsed?.kind === "proposal") {
          setProposal(parsed.proposal);
          // Once we expand into a proposal, the idea shortlist is no longer
          // relevant; hide it so the proposal card takes center stage.
          setIdeas(null);
          focusReviseAfter = true;
        } else if (userMessage && proposal) {
          setError(
            "Could not parse a revised proposal from the response. The previous proposal is unchanged.",
          );
          focusReviseAfter = true;
        } else if (opts?.autoMode === "ideas") {
          // Claude finished but didn't emit a parseable `{"ideas": [...]}`
          // block. Don't leave the user staring at an empty dialog —
          // surface the raw reply (so they can see what went wrong) and
          // an actionable error. The assistant message is still pushed
          // below, so `stripJsonFence(reply)` will render in the chat.
          setError(
            full.trim().length === 0
              ? "The AI returned an empty response. Close and reopen this dialog, or try again in a moment."
              : "The AI didn't return a usable shortlist. Close and reopen for a fresh brainstorm, or describe your own direction below and press Send.",
          );
        } else if (opts?.autoMode === "expand") {
          setError(
            "The AI didn't return a proposal for that idea. Pick another direction or describe your own below.",
          );
        }

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: full },
        ]);
        setStreaming("");

        if (userMessage) {
          setReviseFeedback("");
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        // Only touch loading/focus if this is still the active request.
        // A superseded call's finally must not clobber the new call's loading=true.
        if (streamAbortRef.current === ac) {
          setLoading(false);
          setIsRevising(false);
          setExpandingIdeaIndex(null);
          // Re-show the shortlist if we didn't successfully produce a
          // proposal (e.g. error / abort / unparseable response).
          setHideIdeas(false);
          setTimeout(() => {
            if (focusReviseAfter) {
              reviseInputRef.current?.focus();
            } else {
              inputRef.current?.focus();
            }
          }, 0);
        }
      }
    },
    [messages, type, companyId, goalId, proposal],
  );

  // Auto-start. React 18 Strict Mode runs setup → cleanup → setup;
  // cleanup aborts the in-flight request, so this must run again — do not use a "once" ref guard.
  //
  // Default behavior: jump straight into a shortlist of ideas so the user
  // sees concrete directions immediately. They can refine via the textarea,
  // press Send with an empty field while the list is visible for a fresh
  // shortlist, or pick a card. The exception is the onboarding project
  // seed path — when the caller passes a concrete pilot name + definition
  // of done, we respect that intent and draft a proposal from it instead.
  useEffect(() => {
    const seedName = projectSeed?.suggestedName?.trim();
    if (type === "project" && seedName) {
      const seeded = [
        "Please draft a project proposal aligned with this pilot idea:",
        `Name: ${seedName}`,
        `Definition of done: ${(projectSeed?.suggestedDefinitionOfDone ?? "").trim()}`,
        "Keep complexity low (1-2) and priority P1 or P2 unless the goal clearly requires otherwise.",
      ].join("\n");
      void sendMessage(seeded);
      return;
    }
    void sendMessage("", { autoMode: "ideas", resetConversation: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on mount; sendMessage changes with every message
  }, []);

  const handleSend = useCallback(() => {
    const q = input.trim();
    if (loading) return;
    if (!q && !ideas) return;
    setInput("");
    // Empty Send while the shortlist is up: new brainstorm (replaces the
    // old "Think for me" control).
    if (!q && ideas) {
      setError(null);
      setIdeas(null);
      setHideIdeas(false);
      setProposal(null);
      void sendMessage("", { autoMode: "ideas", resetConversation: true });
      return;
    }
    // If the shortlist is currently visible, soft-hide it during the
    // stream so the user can focus on the AI's response. `sendMessage`'s
    // finally block restores it if the stream doesn't produce a proposal.
    if (ideas) setHideIdeas(true);
    void sendMessage(q);
  }, [input, loading, ideas, sendMessage]);

  /**
   * Called when the user picks one of the AI's shortlisted ideas. Sends
   * a follow-up with `autoMode: "expand"` so the server skips questions and
   * emits the full proposal JSON directly.
   */
  const handleExpandIdea = useCallback(
    (index: number) => {
      if (loading || creating) return;
      const idea = ideas?.[index];
      if (!idea) return;
      setExpandingIdeaIndex(index);
      setHideIdeas(true);
      setError(null);
      const expandPrompt =
        `I'll go with idea #${index + 1}: "${idea.title}"` +
        (idea.rationale ? ` (${idea.rationale})` : "") +
        `. Expand this into a full ${type} proposal using the FINAL OUTPUT RULES. Do not ask any more questions; infer the remaining details from the tracker context.`;
      void sendMessage(expandPrompt, { autoMode: "expand" });
    },
    [ideas, loading, creating, sendMessage, type],
  );

  const handleRevise = useCallback(() => {
    const q = reviseFeedback.trim();
    if (!q || loading) return;
    setError(null);
    setIsRevising(true);
    void sendMessage(q);
  }, [reviseFeedback, loading, sendMessage]);

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
          slackChannel: "",
          slackChannelId: "",
          status: "Not Started",
          atRisk: false,
          spotlight: false,
          reviewLog: [],
        });
        onCreated?.(goal.id);
        toast.success("Goal created");
      } else if (type === "project" && goalId) {
        const p = proposal as ProjectProposal;
        const project = await createProject({
          goalId,
          mirroredGoalIds: [],
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
        toast.success("Project created");
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

  /** Same wording as `AddEntityMenuButton` so the dialog matches the entry point. */
  const dialogTitle =
    type === "goal"
      ? "Draft a new goal with AI…"
      : "Draft a new project with AI…";

  const currentStreaming = streaming;
  const streamingProposal = currentStreaming
    ? tryParseProposal(currentStreaming)
    : null;
  /**
   * Prefer live parse while streaming so revisions update the card as soon as JSON is complete.
   * While a revision is in-flight, hide the previous proposal entirely — only surface the new
   * one once its JSON has finished streaming (streamingProposal !== null).
   */
  const displayProposal = isRevising
    ? streamingProposal
    : (streamingProposal ?? proposal);

  const layer = (
    <>
      <div
        className="fixed inset-0 z-[220] bg-black/60 backdrop-blur-sm motion-reduce:backdrop-blur-none"
        aria-hidden
        onClick={onClose}
      />

      {/* Dialog — z above tracker hover tooltips (z~200) and inline popovers (z~210); portaled to body like SlackCreateThreadDialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        className="fixed left-1/2 top-1/2 z-[230] flex max-h-[min(760px,92vh)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            {dialogTitle}
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

        {/* Chat area — tightens spacing while the idea picker is visible, since
            each card is already its own distinct block and doesn't need the
            larger between-message gap. */}
        <div
          ref={scrollRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 text-sm",
            ideas && !displayProposal
              ? "space-y-2 py-2"
              : "space-y-3 py-3",
          )}
        >
          {messages.map((m, i) => {
            const pickedTitle =
              m.role === "user" ? extractPickedIdeaTitle(m.content) : null;
            // While the idea picker is visible, suppress the assistant's
            // "Here are a few directions…" lead-in: the "Pick a direction"
            // header above the grid already communicates the same thing and
            // the duplicated bubble eats vertical space.
            const hideAssistantBubble =
              m.role === "assistant" && ideas && !displayProposal && !hideIdeas;
            if (hideAssistantBubble) return null;
            return (
            <div key={i}>
              {m.role === "user" ? (
                pickedTitle ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Check className="h-3.5 w-3.5 text-emerald-500/80" aria-hidden />
                    <span>
                      You picked{" "}
                      <span className="font-medium text-zinc-300">
                        {pickedTitle}
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="flex gap-2.5 rounded-md bg-zinc-800 px-3 py-2 text-zinc-200">
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
                )
              ) : (
                <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950 px-3 py-2 text-zinc-300">
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
            );
          })}

          {/* Streaming text (before it's committed to messages). We show it
              during the ideas fetch too — the user should see Claude's
              lead-in streaming rather than a silent "Brainstorming…" that
              then disappears. Once a ``` fence opens, the lead-in stays
              above a scrollable fenced region so it does not scroll away
              with the JSON. */}
          {loading && currentStreaming && (() => {
            const { leadIn, fenced } = splitLeadInAndFencedBlock(currentStreaming);
            const leadStreaming = !fenced;
            const leadText = leadStreaming ? currentStreaming : leadIn;
            return (
            <div className="flex gap-2.5 rounded-md border border-zinc-700/60 bg-zinc-950 px-3 py-2 text-zinc-300">
              <span
                className="shrink-0 select-none font-semibold tabular-nums text-amber-500/90"
                aria-hidden
              >
                Q
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

          {/* Thinking indicator */}
          {loading && !currentStreaming && (
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}

          {/* Idea shortlist picker — shown after the auto-brainstorm returns a list.
              Hidden once an idea has been expanded into a proposal.
              Rationale appears in a hover/focus tooltip overlay on the card. */}
          {ideas && !displayProposal && !hideIdeas && (
            <div>
              <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-amber-400/90">
                <Wand2 className="h-3.5 w-3.5" aria-hidden />
                Pick a direction
              </div>
              <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-3">
                {ideas.map((idea, i) => {
                  const meta = CATEGORY_META[idea.category];
                  const Icon = meta.icon;
                  const isBusy = expandingIdeaIndex === i;
                  const disabled = loading || creating;
                  const ariaLabel = idea.rationale
                    ? `Expand idea: ${idea.title}. ${idea.rationale}`
                    : `Expand idea: ${idea.title}`;
                  return (
                    <li key={i} className="min-w-0 overflow-visible">
                      <div
                        role="button"
                        tabIndex={disabled ? -1 : 0}
                        aria-disabled={disabled || undefined}
                        aria-label={ariaLabel}
                        onClick={() => {
                          if (disabled) return;
                          handleExpandIdea(i);
                        }}
                        onKeyDown={(e) => {
                          if (disabled) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleExpandIdea(i);
                          }
                        }}
                        className={cn(
                          "group relative flex h-full w-full cursor-pointer flex-col overflow-visible rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400/45",
                          isBusy
                            ? "border-amber-500/60 bg-amber-950/30 ring-1 ring-amber-500/30"
                            : cn(
                                "border-zinc-800 bg-zinc-950/60 ring-1 ring-transparent",
                                meta.ring,
                              ),
                          disabled && !isBusy
                            ? "cursor-not-allowed opacity-50"
                            : "",
                        )}
                      >
                        <div className="flex items-center gap-3.5">
                          <span
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                              meta.tile,
                            )}
                            aria-hidden
                          >
                            {isBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <span
                              className={cn(
                                "inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                                meta.pill,
                              )}
                            >
                              {meta.label}
                            </span>
                            <span className="text-sm font-semibold leading-snug text-zinc-100 [text-wrap:balance]">
                              {idea.title}
                            </span>
                          </span>
                        </div>
                        {idea.rationale ? (
                          <div
                            role="tooltip"
                            className={cn(
                              // Below the card so the direction title is never covered (in-card overlay did).
                              "pointer-events-none absolute inset-x-2 top-full z-20 mt-1.5 max-h-[min(12rem,42vh)] overflow-y-auto rounded-md border border-zinc-700/85 bg-zinc-900/95 p-2.5 shadow-lg backdrop-blur-sm",
                              "opacity-0 transition-[opacity,box-shadow] duration-150 ease-out motion-reduce:transition-none",
                              "group-hover:opacity-100 group-hover:shadow-xl",
                              "group-focus-within:opacity-100 group-focus-within:shadow-xl",
                            )}
                          >
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                              Why it matters
                            </p>
                            <p className="text-xs leading-relaxed text-zinc-300 [text-wrap:pretty]">
                              {idea.rationale}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
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
                      handleRevise();
                    }}
                    placeholder="e.g. Make priority P0, shorten the title, add a milestone for QA…"
                    disabled={loading || creating}
                    className="min-h-11 min-w-0 flex-1 self-stretch rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    aria-label="Feedback to revise the proposal"
                  />
                  <button
                    type="button"
                    disabled={
                      loading || creating || !reviseFeedback.trim()
                    }
                    onClick={handleRevise}
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
                  onClick={() => void handleCreate()}
                  disabled={creating || loading}
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
                  disabled={creating || loading}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-stretch gap-2">
              <label htmlFor="ai-create-answer" className="sr-only">
                Direction or refinement for the AI (Shift+Enter for a new line)
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
                rows={ideas ? 1 : 3}
                placeholder={
                  ideas
                    ? "Refine these, ask for a different angle—or leave blank and Send for new directions…"
                    : "Describe the direction you want, or leave blank and hit Send to let AI propose…"
                }
                disabled={loading}
                spellCheck
                className={cn(
                  "box-border min-w-0 flex-1 resize-y self-stretch rounded-md border border-zinc-600 bg-zinc-950 px-2.5 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50",
                  ideas ? "min-h-11 max-h-40" : "min-h-[5.5rem] max-h-48",
                )}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || (!input.trim() && !ideas)}
                className="inline-flex min-h-11 min-w-[5.25rem] shrink-0 items-center justify-center self-stretch rounded-md bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(layer, document.body);
}
