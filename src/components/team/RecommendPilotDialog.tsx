"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { CompanyWithGoals, Person, Project } from "@/lib/types/tracker";
import type {
  BuddyRecommendation,
  OnboardingRecommendation,
} from "@/lib/schemas/onboarding";
import { X, Loader2, RefreshCw, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateProject } from "@/server/actions/tracker";
import { AiCreateDialog } from "@/components/tracker/AiCreateDialog";
import { StreamingText } from "@/components/ui/StreamingText";
import {
  ONBOARDING_RECOMMEND_STATUS_PREFIX,
  ONBOARDING_RECOMMEND_STREAM_DONE,
} from "@/lib/onboarding-recommend-stream";

function resolveGoalIdForNewProject(
  hierarchy: CompanyWithGoals[],
  companyId: string,
  suggestedGoalId: string
): string | null {
  const co = hierarchy.find((c) => c.id === companyId);
  if (!co) return null;
  const gid = suggestedGoalId.trim();
  if (gid) {
    const g = co.goals.find((x) => x.id === gid);
    if (g) return g.id;
  }
  return co.goals[0]?.id ?? null;
}

export type SelectedBuddy = {
  personId: string;
  slackUserId: string;
  name: string;
  rationale?: string;
};

export function RecommendPilotDialog({
  open,
  onClose,
  newHire,
  people,
  projects,
  hierarchy,
  onAssignedExisting,
  onNewProjectCreated,
}: {
  open: boolean;
  onClose: () => void;
  newHire: Person;
  people: Person[];
  projects: Project[];
  hierarchy: CompanyWithGoals[];
  onAssignedExisting: (ctx: {
    newHire: Person;
    projectId: string;
    assignmentKind: "owner" | "assignee";
    recommendation: OnboardingRecommendation;
    buddies: SelectedBuddy[];
  }) => void;
  onNewProjectCreated: (ctx: {
    newHire: Person;
    projectId: string;
    recommendation: OnboardingRecommendation;
    buddies: SelectedBuddy[];
  }) => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] =
    useState<OnboardingRecommendation | null>(null);
  const [buddies, setBuddies] = useState<BuddyRecommendation | null>(null);
  const [buddiesError, setBuddiesError] = useState<string | null>(null);
  /** personIds of buddies currently selected (defaults to all returned candidates). */
  const [selectedBuddyIds, setSelectedBuddyIds] = useState<Set<string>>(
    new Set()
  );
  const [applying, setApplying] = useState<string | null>(null);

  const [aiCreate, setAiCreate] = useState<{
    goalId: string;
    seedName: string;
    seedDod: string;
  } | null>(null);
  const [pendingRecForNew, setPendingRecForNew] =
    useState<OnboardingRecommendation | null>(null);
  /** Raw model output while `/api/onboarding/recommend/stream` is in flight. */
  const [streaming, setStreaming] = useState("");
  /** True until the HTTP stream has finished reading (caret on {@link StreamingText}). */
  const [streamLive, setStreamLive] = useState(false);
  /** Latest pre-AI status line from the server (e.g. "Loading Slack DM context…"). */
  const [streamStatus, setStreamStatus] = useState<string>("");
  const streamScrollRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      streamAbortRef.current?.abort();
      setLoading(false);
      setStreamLive(false);
      setStreaming("");
      setStreamStatus("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useLayoutEffect(() => {
    const el = streamScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streaming]);

  /**
   * Stable ref to the latest people list so the fetch callback can read it without
   * re-creating itself (which would re-trigger the open effect and double-charge AI).
   */
  const peopleRef = useRef(people);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  const fetchRecommendation = useCallback(async () => {
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;

    setLoading(true);
    setError(null);
    setBuddiesError(null);
    setStreaming("");
    setStreamLive(false);
    setStreamStatus("Connecting…");
    try {
      const res = await fetch("/api/onboarding/recommend/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: newHire.id }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(errJson?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let raw = "";
      /** Text emitted *before* the footer delimiter, with status lines stripped. */
      let displayBuffer = "";
      /** Substring consumed from `raw` so far (status lines + model deltas). */
      let consumed = 0;
      const marker = ONBOARDING_RECOMMEND_STREAM_DONE;
      setStreamLive(true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });

        const footerIdx = raw.indexOf(marker);
        const parseEnd = footerIdx === -1 ? raw.length : footerIdx;
        /** Process any newly-arrived pre-footer bytes. */
        while (consumed < parseEnd) {
          const statusPrefixLen = ONBOARDING_RECOMMEND_STATUS_PREFIX.length;
          const isStatusStart =
            raw.startsWith(ONBOARDING_RECOMMEND_STATUS_PREFIX, consumed);
          if (isStatusStart) {
            const newlineIdx = raw.indexOf("\n", consumed + statusPrefixLen);
            if (newlineIdx === -1 || newlineIdx >= parseEnd) {
              /** Status line is not yet fully received in this chunk; wait. */
              break;
            }
            const statusText = raw.slice(consumed + statusPrefixLen, newlineIdx);
            setStreamStatus(statusText);
            consumed = newlineIdx + 1;
          } else {
            /** Everything from here until the next status line / footer is model text. */
            let nextStatusIdx = raw.indexOf(
              ONBOARDING_RECOMMEND_STATUS_PREFIX,
              consumed
            );
            if (nextStatusIdx === -1 || nextStatusIdx > parseEnd) {
              nextStatusIdx = parseEnd;
            }
            displayBuffer += raw.slice(consumed, nextStatusIdx);
            consumed = nextStatusIdx;
            setStreaming(displayBuffer);
            /** Once model text actually starts arriving, replace the status text. */
            if (displayBuffer.trim().length > 0) {
              setStreamStatus("");
            }
          }
        }

        if (footerIdx !== -1) {
          /** Keep reading until stream ends so the footer JSON is fully buffered. */
        }
      }

      setStreamLive(false);

      const idx = raw.indexOf(marker);
      if (idx === -1) {
        throw new Error("Incomplete response from server.");
      }

      const jsonStr = raw.slice(idx + marker.length);
      const payload = JSON.parse(jsonStr) as {
        ok?: boolean;
        error?: string;
        recommendation?: OnboardingRecommendation;
        buddies?: BuddyRecommendation | null;
        buddiesError?: string;
      };

      if (!payload.ok) {
        throw new Error(payload.error ?? "Recommendation failed");
      }
      if (!payload.recommendation) {
        throw new Error("No recommendation in response");
      }

      setRecommendation(payload.recommendation);
      setBuddies(payload.buddies ?? null);
      setBuddiesError(payload.buddiesError ?? null);
      setStreamStatus("");
      /** Only pre-select buddies who actually have a Slack id (others can't be added to the MPIM). */
      const peopleByIdLocal = new Map(
        peopleRef.current.map((p) => [p.id, p])
      );
      setSelectedBuddyIds(
        new Set(
          (payload.buddies?.candidates ?? [])
            .filter((b) =>
              (peopleByIdLocal.get(b.personId)?.slackHandle ?? "").trim().length >
              0
            )
            .map((b) => b.personId)
        )
      );
      setStreaming("");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return;
      }
      setRecommendation(null);
      setBuddies(null);
      setSelectedBuddyIds(new Set());
      setError(e instanceof Error ? e.message : String(e));
      setStreaming("");
      setStreamStatus("");
    } finally {
      if (streamAbortRef.current === ac) {
        setLoading(false);
        setStreamLive(false);
      }
    }
  }, [newHire.id]);

  useEffect(() => {
    if (!open) return;
    setRecommendation(null);
    setBuddies(null);
    setBuddiesError(null);
    setSelectedBuddyIds(new Set());
    setError(null);
    void fetchRecommendation();
  }, [open, fetchRecommendation]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const selectedBuddiesList = useMemo<SelectedBuddy[]>(() => {
    if (!buddies) return [];
    return buddies.candidates
      .filter((c) => selectedBuddyIds.has(c.personId))
      .map((c) => {
        const p = peopleById.get(c.personId);
        return {
          personId: c.personId,
          slackUserId: (p?.slackHandle ?? "").trim(),
          name: p?.name ?? c.personId,
          rationale: c.rationale,
        };
      })
      .filter((b) => b.slackUserId.length > 0);
  }, [buddies, peopleById, selectedBuddyIds]);

  const toggleBuddy = useCallback((personId: string) => {
    setSelectedBuddyIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }, []);

  const applyExisting = useCallback(
    async (
      projectId: string,
      assignmentKind: "owner" | "assignee",
      rec: OnboardingRecommendation
    ) => {
      const pid = projectId.trim();
      if (!pid) {
        toast.error("No project selected.");
        return;
      }
      const proj = projects.find((p) => p.id === pid);
      if (!proj) {
        toast.error("Project not found in tracker.");
        return;
      }

      setApplying(pid);
      try {
        if (assignmentKind === "owner") {
          await updateProject(pid, { ownerId: newHire.id });
        } else {
          const ids = [...(proj.assigneeIds ?? [])];
          if (!ids.includes(newHire.id)) ids.push(newHire.id);
          await updateProject(pid, { assigneeIds: ids });
        }
        toast.success("Pilot assignment saved");
        const buddiesSnapshot = selectedBuddiesList;
        onClose();
        onAssignedExisting({
          newHire,
          projectId: pid,
          assignmentKind,
          recommendation: rec,
          buddies: buddiesSnapshot,
        });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update project");
      } finally {
        setApplying(null);
      }
    },
    [newHire, onAssignedExisting, onClose, projects, router, selectedBuddiesList]
  );

  const openNewProjectAi = useCallback(
    (rec: OnboardingRecommendation) => {
      const np = rec.newProjectProposal;
      const goalId = resolveGoalIdForNewProject(
        hierarchy,
        np.suggestedCompanyId,
        np.suggestedGoalId
      );
      if (!goalId) {
        toast.error("Could not find a goal under the suggested company.");
        return;
      }
      setPendingRecForNew(rec);
      setAiCreate({
        goalId,
        seedName: np.suggestedName,
        seedDod: np.suggestedDefinitionOfDone,
      });
    },
    [hierarchy]
  );

  if (!mounted || !open) return null;

  const layer = (
    <>
      {aiCreate ? (
        <AiCreateDialog
          type="project"
          goalId={aiCreate.goalId}
          projectSeed={{
            suggestedName: aiCreate.seedName,
            suggestedDefinitionOfDone: aiCreate.seedDod,
          }}
          onCreated={async (projectId) => {
            try {
              await updateProject(projectId, { ownerId: newHire.id });
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : "Could not set project owner"
              );
            }
            const rec = pendingRecForNew;
            const buddiesSnapshot = selectedBuddiesList;
            setPendingRecForNew(null);
            setAiCreate(null);
            onClose();
            if (rec) {
              onNewProjectCreated({
                newHire,
                projectId,
                recommendation: rec,
                buddies: buddiesSnapshot,
              });
            }
            router.refresh();
          }}
          onClose={() => {
            setAiCreate(null);
            setPendingRecForNew(null);
          }}
        />
      ) : null}

      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-3 sm:p-6 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommend-pilot-title"
      >
        <div className="absolute inset-0 cursor-pointer" onClick={() => onClose()} />
        <div
          className="relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <h2
                id="recommend-pilot-title"
                className="text-base font-semibold text-zinc-100 truncate"
              >
                Pilot project for {newHire.name}
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                AI suggestions — pick an existing project or generate a new one
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void fetchRecommendation()}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                title="Refresh recommendations"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Refresh
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {loading && !recommendation ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                <div className="border-b border-zinc-800/80 px-3 py-2.5 bg-zinc-900/60">
                  <div className="flex items-start gap-2">
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin text-zinc-500 shrink-0 mt-0.5"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                          {streaming.length > 0 ? "Model output" : "Progress"}
                        </p>
                        {streaming.length > 0 && streamLive ? (
                          <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
                            Streaming…
                          </span>
                        ) : null}
                      </div>
                      {streaming.length === 0 ? (
                        <p className="text-xs text-zinc-300 leading-snug break-words">
                          {streamStatus || "Connecting…"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                {streaming.length > 0 ? (
                  <div
                    ref={streamScrollRef}
                    className="max-h-[min(40vh,280px)] overflow-y-auto px-3 py-3"
                  >
                    <StreamingText
                      text={streaming}
                      isStreaming={streamLive}
                      className="text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="text-sm text-red-400/90 py-6 text-center">{error}</p>
            ) : null}

            {recommendation ? (
              <>
                {recommendation.dmContextSummary ? (
                  <p className="text-xs text-zinc-500 mb-4 border border-zinc-800 rounded-md px-3 py-2 bg-zinc-900/50">
                    <span className="font-medium text-zinc-400">DM context: </span>
                    {recommendation.dmContextSummary}
                  </p>
                ) : null}

                {buddies && buddies.candidates.length > 0 ? (
                  <div className="mb-4 rounded-md border border-sky-900/45 bg-sky-950/20 px-3 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Users className="h-3.5 w-3.5 text-sky-400/90" aria-hidden />
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/90">
                        Suggested buddies
                      </p>
                      <span className="text-[10px] text-zinc-500">
                        Selected buddies will be looped in (group DM with you, the new hire, Nadav, and the buddies).
                      </span>
                    </div>
                    {buddies.summary ? (
                      <p className="text-xs text-zinc-400 mb-2">{buddies.summary}</p>
                    ) : null}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {buddies.candidates.map((c) => {
                        const p = peopleById.get(c.personId);
                        const checked = selectedBuddyIds.has(c.personId);
                        const noSlack = !p?.slackHandle?.trim();
                        return (
                          <label
                            key={c.personId}
                            className={cn(
                              "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                              checked
                                ? "border-sky-700/70 bg-sky-950/40"
                                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={noSlack}
                              onChange={() => toggleBuddy(c.personId)}
                              className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-sky-500"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-100 truncate">
                                {p?.name ?? c.personId}
                                {p?.role ? (
                                  <span className="ml-1 text-xs font-normal text-zinc-500">
                                    · {p.role}
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">
                                {c.rationale}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                                <span>Fit {c.fitScore}/5</span>
                                {c.sameDepartment ? (
                                  <span className="rounded bg-zinc-800 px-1 py-px text-zinc-300">
                                    Same dept
                                  </span>
                                ) : null}
                                {c.sharesPilotContext ? (
                                  <span className="rounded bg-zinc-800 px-1 py-px text-zinc-300">
                                    Pilot overlap
                                  </span>
                                ) : null}
                                {noSlack ? (
                                  <span className="rounded bg-amber-950/60 px-1 py-px text-amber-300">
                                    No Slack ID
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : buddiesError ? (
                  <p className="text-xs text-amber-400/80 mb-3">
                    Could not generate buddy suggestions: {buddiesError}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {recommendation.existingProjectCandidates.map((c, idx) => {
                    const proj = c.projectId.trim()
                      ? projects.find((p) => p.id === c.projectId.trim())
                      : undefined;
                    const disabled = !c.projectId.trim() || !proj;
                    return (
                      <div
                        key={`${c.projectId}-${idx}`}
                        className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                          Existing project {idx + 1}
                        </p>
                        <p className="text-sm font-medium text-zinc-100 line-clamp-2 min-h-[2.5rem]">
                          {proj?.name ?? "(No match)"}
                        </p>
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-4 flex-1">
                          {c.rationale}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                          <span>Fit {c.fitScore}/5</span>
                          <span className="text-zinc-700">·</span>
                          <span className="capitalize">{c.suggestedRole}</span>
                        </div>
                        <button
                          type="button"
                          disabled={disabled || applying !== null}
                          onClick={() =>
                            void applyExisting(
                              c.projectId,
                              c.suggestedRole,
                              recommendation
                            )
                          }
                          className="mt-3 w-full rounded-md bg-emerald-700/90 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {applying === c.projectId.trim() ? (
                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          ) : (
                            "Assign pilot"
                          )}
                        </button>
                      </div>
                    );
                  })}

                  <div className="flex flex-col rounded-lg border border-violet-900/50 bg-violet-950/20 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-400/90 mb-2 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      New project
                    </p>
                    <p className="text-sm font-medium text-zinc-100 line-clamp-2">
                      {recommendation.newProjectProposal.suggestedName}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-4 flex-1">
                      {recommendation.newProjectProposal.rationale}
                    </p>
                    <button
                      type="button"
                      disabled={applying !== null}
                      onClick={() => openNewProjectAi(recommendation)}
                      className="mt-3 w-full rounded-md border border-violet-600/60 bg-violet-950/40 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-900/50 disabled:opacity-40"
                    >
                      Create with AI…
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(layer, document.body);
}
