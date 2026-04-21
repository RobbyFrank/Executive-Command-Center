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
  NewPilotProjectProposal,
  OnboardingRecommendation,
} from "@/lib/schemas/onboarding";
import {
  Check,
  CircleHelp,
  Hash,
  Info,
  Loader2,
  Plus,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { SlackChannel } from "@/lib/slack";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateProject } from "@/server/actions/tracker";
import { AiCreateDialog } from "@/components/tracker/AiCreateDialog";
import { PriorityPillInline } from "@/components/tracker/PriorityPillInline";
import { MultiPersonPicker } from "@/components/team/MultiPersonPicker";
import { AddChannelPicker } from "@/components/team/AddChannelPicker";
import { CreatePrivateChannelDialog } from "@/components/team/CreatePrivateChannelDialog";
import { useSmoothText } from "@/hooks/useSmoothText";
import { clampAutonomy, isFounderPerson } from "@/lib/autonomyRoster";
import {
  ONBOARDING_RECOMMEND_STATUS_PREFIX,
  ONBOARDING_RECOMMEND_STREAM_DONE,
} from "@/lib/onboarding-recommend-stream";

const ONBOARDING_STREAM_MODEL_PROGRESS_BASE = 0.3;
const ONBOARDING_STREAM_MODEL_PROGRESS_MAX = 0.99;
/** Pilot JSON is much shorter than Slack scrape (a few cards vs 6–7 suggestions); saturate the bar sooner. */
const ONBOARDING_STREAM_CHARS_ROUGH_MAX = 3_200;
const STREAMING_FILL_SPEED = 2.5;

function onboardingStreamBarFraction(opts: {
  streamingLen: number;
  streamStatus: string;
  streamLive: boolean;
}): number {
  const { streamingLen, streamStatus, streamLive } = opts;
  const base = ONBOARDING_STREAM_MODEL_PROGRESS_BASE;
  const max = ONBOARDING_STREAM_MODEL_PROGRESS_MAX;
  if (streamingLen === 0) {
    if (streamStatus.trim()) return 0.14;
    return streamLive ? 0.1 : 0.08;
  }
  const fromLength = Math.min(
    streamingLen / ONBOARDING_STREAM_CHARS_ROUGH_MAX,
    1
  );
  const blended = Math.min(1, STREAMING_FILL_SPEED * fromLength);
  return base + blended * (max - base);
}

function PersonAvatarThumb({
  person,
  size = 28,
  subtle = false,
}: {
  person: Person;
  size?: number;
  /** Softer ring and fill — for header accents next to titles. */
  subtle?: boolean;
}) {
  const path = person.profilePicturePath?.trim() ?? "";
  const initial = (person.name?.trim().slice(0, 1) || "?").toUpperCase();
  const dim = { width: size, height: size };
  if (path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={path}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover ring-1",
          subtle
            ? "opacity-90 ring-zinc-600/25"
            : "ring-zinc-800"
        )}
        style={dim}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold ring-1",
        subtle
          ? "bg-zinc-800/45 text-zinc-500 ring-zinc-700/25 text-[9px]"
          : "bg-zinc-800 text-[10px] text-zinc-400 ring-zinc-700"
      )}
      style={dim}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function projectRosterPeople(
  project: Project,
  peopleById: Map<string, Person>
): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    const t = id?.trim();
    if (!t) return;
    const p = peopleById.get(t);
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  push(project.ownerId);
  for (const a of project.assigneeIds ?? []) push(a);
  return out.slice(0, 5);
}

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

const PLACEHOLDER_SNIP = 96;

function truncatePlaceholderSnippet(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Placeholder for founder-direction textarea: same two-part shape as the static copy, tuned to roster role/dept. */
function founderDirectionPlaceholder(person: Person): string {
  const rawName = person.name?.trim() ?? "";
  const first = rawName.split(/\s+/).filter(Boolean)[0] ?? "This hire";
  const role = truncatePlaceholderSnippet(person.role ?? "", PLACEHOLDER_SNIP);
  const dept = truncatePlaceholderSnippet(person.department ?? "", 48);

  let mandate: string;
  if (role && dept) {
    mandate = `${first} is joining as ${role} on the ${dept} team`;
  } else if (role) {
    mandate = `${first} is joining as ${role}`;
  } else if (dept) {
    mandate = `${first} is joining the ${dept} team`;
  } else {
    mandate = `${first} is onboarding`;
  }

  return `e.g. "${mandate} — give them a pilot that fits that mandate (right lane and metrics), not busywork in the wrong area." or "Keep the first assignment low-risk so we can gauge autonomy before putting them on customer-facing work."`;
}

const FOUNDER_CONTEXT_PLACEHOLDER_TTL_MS = 24 * 60 * 60 * 1000;
const FOUNDER_CONTEXT_PLACEHOLDER_LS_PREFIX =
  "ecc:founder-context-placeholder:v1:";

function placeholderSignature(person: Person): string {
  const name = person.name?.trim() ?? "";
  const role = (person.role ?? "").trim();
  const dept = (person.department ?? "").trim();
  let h = 5381;
  const s = `${name}\n${role}\n${dept}`;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return `${h >>> 0}`;
}

function readCachedFounderContextPlaceholder(
  storageKey: string
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text?: unknown; expiresAt?: unknown };
    if (typeof parsed.text !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    if (Date.now() >= parsed.expiresAt) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.text;
  } catch {
    return null;
  }
}

function writeCachedFounderContextPlaceholder(storageKey: string, text: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        text,
        expiresAt: Date.now() + FOUNDER_CONTEXT_PLACEHOLDER_TTL_MS,
      })
    );
  } catch {
    /* quota / private mode */
  }
}

/**
 * Role/dept-personalized textarea placeholder, cached in localStorage for 24h per hire + roster signature.
 */
function getCachedFounderContextPlaceholder(person: Person): string {
  const storageKey = `${FOUNDER_CONTEXT_PLACEHOLDER_LS_PREFIX}${person.id}:${placeholderSignature(person)}`;
  const hit = readCachedFounderContextPlaceholder(storageKey);
  if (hit !== null) return hit;
  const text = founderDirectionPlaceholder(person);
  writeCachedFounderContextPlaceholder(storageKey, text);
  return text;
}

export type SelectedBuddy = {
  personId: string;
  slackUserId: string;
  name: string;
  rationale?: string;
};

export type SelectedChannel = {
  channelId: string;
  channelName: string;
  rationale: string;
  /** True if user added it via the dropdown rather than the AI list. */
  isManual: boolean;
};

/**
 * One assigned pilot project, as emitted by {@link RecommendPilotDialog} when the founder
 * clicks Continue. Projects are either existing tracker cards (owner set to the new hire)
 * or freshly-created new projects (via AiCreateDialog).
 */
export type AssignedPilotProject = {
  projectId: string;
  /** "owner" for existing cards, "new_project" for ones we AI-created during the flow. */
  assignmentKind: "owner" | "new_project";
};

export function RecommendPilotDialog({
  open,
  onClose,
  newHire,
  people,
  projects,
  hierarchy,
  onBatchAssigned,
}: {
  open: boolean;
  onClose: () => void;
  newHire: Person;
  people: Person[];
  projects: Project[];
  hierarchy: CompanyWithGoals[];
  /**
   * Fires once with every project the founder assigned in this recommender run. Parent is
   * expected to queue an {@link AssignmentMessageDialog} per project (multi-project flow).
   */
  onBatchAssigned: (ctx: {
    newHire: Person;
    assigned: AssignedPilotProject[];
    recommendation: OnboardingRecommendation;
    buddies: SelectedBuddy[];
    channels: SelectedChannel[];
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
  /**
   * Existing-project ids the founder has selected from the recommender cards. Multi-select:
   * clicking a card toggles membership. When they click Continue we set `ownerId` on every
   * selected project and emit a single batch callback for the parent to queue assignment
   * messages.
   */
  const [selectedExistingProjectIds, setSelectedExistingProjectIds] =
    useState<Set<string>>(new Set());
  /**
   * Projects we created via AiCreateDialog during this recommender session. Already have
   * `ownerId` set (the dialog sets it on creation) so Continue just forwards the ids.
   */
  const [createdProjectIds, setCreatedProjectIds] = useState<string[]>([]);
  /** Loading state for the final batch assignment (while we setOwnerId on each existing). */
  const [continuing, setContinuing] = useState(false);

  /**
   * Pre-flight founder context the user types before the AI run. This is the highest-priority
   * signal for both the pilot prompt and the onboarding-partner prompt (see their server actions).
   */
  const [founderContext, setFounderContext] = useState("");
  /** True once the user hits Start or Skip; gates the auto-fetch effect. */
  const [hasStarted, setHasStarted] = useState(false);

  /** Personalized example copy for the founder-direction field (cached client-side 24h). */
  const [founderContextPlaceholder, setFounderContextPlaceholder] = useState(
    () => founderDirectionPlaceholder(newHire)
  );

  /** Extra AI-generated new-project proposals, fetched when no existing cards passed the fit floor. */
  const [extraProposals, setExtraProposals] = useState<NewPilotProjectProposal[]>(
    []
  );
  /** Loading state for the extra proposal backfill (shows skeleton cards). */
  const [extraLoading, setExtraLoading] = useState(false);
  /** Surfaced backfill error so users know "Create with AI…" is the only path forward. */
  const [extraError, setExtraError] = useState<string | null>(null);
  const extraAbortRef = useRef<AbortController | null>(null);
  /**
   * One-shot latch per recommendation run. Prevents the backfill effect from re-firing when its
   * state deps change (loading → false, proposals stay [] on a 429 / empty AI response, etc.).
   * Cleared in the `open=false` reset and when a fresh recommendation arrives.
   */
  const extraAttemptedRef = useRef(false);

  /** Channel ids the founder has deselected from the AI suggestions. */
  const [unselectedAiChannelIds, setUnselectedAiChannelIds] = useState<
    Set<string>
  >(new Set());
  /** Channels manually added via the dropdown (dedup'd against AI picks in the merged list). */
  const [manualChannels, setManualChannels] = useState<SelectedChannel[]>([]);
  /** Controls the Create private channel modal (conversations.create). */
  const [createChannelOpen, setCreateChannelOpen] = useState(false);

  const [aiCreate, setAiCreate] = useState<{
    goalId: string;
    seedName: string;
    seedDod: string;
  } | null>(null);
  /** Raw model output while `/api/onboarding/recommend/stream` is in flight. */
  const [streaming, setStreaming] = useState("");
  /** True until the HTTP stream has finished reading (drives the pulsing caret). */
  const [streamLive, setStreamLive] = useState(false);
  /** Latest pre-AI status line from the server (e.g. "Loading Slack DM context…"). */
  const [streamStatus, setStreamStatus] = useState<string>("");
  const modelStreamRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const smoothedStreaming = useSmoothText(streaming, streamLive, {
    charsPerSecond: 80,
  });
  const scanBarFraction = useMemo(
    () =>
      onboardingStreamBarFraction({
        streamingLen: streaming.length,
        streamStatus,
        streamLive,
      }),
    [streaming.length, streamStatus, streamLive]
  );

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
      extraAbortRef.current?.abort();
      setLoading(false);
      setStreamLive(false);
      setStreaming("");
      setStreamStatus("");
      setExtraProposals([]);
      setExtraLoading(false);
      setExtraError(null);
      extraAttemptedRef.current = false;
      setHasStarted(false);
      setFounderContext("");
      setUnselectedAiChannelIds(new Set());
      setManualChannels([]);
      setCreateChannelOpen(false);
      setSelectedExistingProjectIds(new Set());
      setCreatedProjectIds([]);
      setContinuing(false);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    setFounderContextPlaceholder(getCachedFounderContextPlaceholder(newHire));
  }, [open, newHire.id, newHire.name, newHire.role, newHire.department]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useLayoutEffect(() => {
    const el = modelStreamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [smoothedStreaming]);

  /**
   * Stable ref to the latest people list so the fetch callback can read it without
   * re-creating itself (which would re-trigger the open effect and double-charge AI).
   */
  const peopleRef = useRef(people);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  /**
   * Stable ref to the current founder context so `fetchRecommendation` does NOT depend on it.
   * Editing the textarea before Start must not recreate the callback (which would otherwise
   * re-run the auto-start effect). After Start the textarea is gone, so the ref is stable too.
   */
  const founderContextRef = useRef(founderContext);
  useEffect(() => {
    founderContextRef.current = founderContext;
  }, [founderContext]);

  const fetchRecommendation = useCallback(async (contextOverride?: string) => {
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
      const contextForCall =
        contextOverride ?? founderContextRef.current;
      const res = await fetch("/api/onboarding/recommend/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: newHire.id,
          founderContext: contextForCall.trim() || undefined,
        }),
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
      setUnselectedAiChannelIds(new Set());
      setManualChannels([]);
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
    if (!hasStarted) return;
    setRecommendation(null);
    setBuddies(null);
    setBuddiesError(null);
    setSelectedBuddyIds(new Set());
    setError(null);
    setExtraProposals([]);
    setExtraLoading(false);
    setExtraError(null);
    extraAttemptedRef.current = false;
    setUnselectedAiChannelIds(new Set());
    setManualChannels([]);
    void fetchRecommendation();
  }, [open, hasStarted, fetchRecommendation]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const visibleExistingCandidates = useMemo(() => {
    if (!recommendation) return [];
    return recommendation.existingProjectCandidates.filter((c) => {
      const pid = c.projectId.trim();
      if (!pid) return false;
      const proj = projects.find((p) => p.id === pid);
      if (!proj) return false;
      if ((proj.ownerId ?? "").trim()) return false;
      return c.fitScore >= 4;
    });
  }, [recommendation, projects]);

  /**
   * When the stream finishes and no existing-project card survived the fit floor, we only have the
   * single baked-in `newProjectProposal`. Kick a backfill request for 2 more so the user has 3
   * distinct new-project options. Skeleton cards show in the meantime.
   *
   * CRITICAL: this effect is gated by `extraAttemptedRef` so it fires **exactly once** per
   * recommendation run. We previously listed `extraLoading` / `extraProposals.length` / `extraError`
   * as deps which caused a runaway loop when the server returned `{ ok: true, proposals: [] }`
   * (e.g. after a rate-limit inside the server action): none of the guards tripped, `setExtraLoading(false)`
   * re-ran the effect, another request went out, and so on.
   */
  useEffect(() => {
    if (!open) return;
    if (!recommendation) return;
    if (visibleExistingCandidates.length > 0) return;
    if (extraAttemptedRef.current) return;

    extraAttemptedRef.current = true;
    const ac = new AbortController();
    extraAbortRef.current?.abort();
    extraAbortRef.current = ac;
    setExtraLoading(true);
    setExtraError(null);

    const alreadyProposed: NewPilotProjectProposal[] = [
      {
        suggestedCompanyId: recommendation.newProjectProposal.suggestedCompanyId,
        suggestedGoalId: recommendation.newProjectProposal.suggestedGoalId,
        suggestedName: recommendation.newProjectProposal.suggestedName,
        suggestedDefinitionOfDone:
          recommendation.newProjectProposal.suggestedDefinitionOfDone,
        rationale: recommendation.newProjectProposal.rationale,
      },
    ];

    (async () => {
      try {
        const res = await fetch("/api/onboarding/recommend/additional", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personId: newHire.id,
            count: 2,
            alreadyProposed,
            founderContext: founderContext.trim() || undefined,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            errJson?.error ?? `Request failed (${res.status})`
          );
        }
        const payload = (await res.json()) as {
          ok?: boolean;
          error?: string;
          proposals?: NewPilotProjectProposal[];
        };
        if (!payload.ok || !payload.proposals) {
          throw new Error(payload.error ?? "No proposals returned");
        }
        if (ac.signal.aborted) return;
        setExtraProposals(payload.proposals);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setExtraError(e instanceof Error ? e.message : String(e));
      } finally {
        if (extraAbortRef.current === ac) {
          setExtraLoading(false);
        }
      }
    })();

    return () => {
      ac.abort();
    };
    // Intentionally reading `founderContext` from closure at fire time, NOT as a dep — the preflight
    // context is locked the moment we kick the backfill; re-editing the textarea mid-run (there is
    // no textarea once started, but being defensive) should never retrigger a second paid AI call.
    // Also intentionally NOT depending on extraLoading / extraProposals.length / extraError: the
    // one-shot `extraAttemptedRef` latch is the single source of truth for "have we already tried?".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recommendation, visibleExistingCandidates.length, newHire.id]);

  /**
   * Buddies the user has manually added via the "Pick your own buddy" dropdown.
   * Stored as ids; de-duped against the AI-returned list in `displayedBuddyCandidates`.
   */
  const [manualBuddyIds, setManualBuddyIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) setManualBuddyIds([]);
  }, [open]);

  /**
   * Merged buddy list rendered by the dialog: AI candidates first, then manual picks. Manual picks
   * are treated as high-fit so they sort naturally and get a fixed "Manually selected" rationale.
   */
  const displayedBuddyCandidates = useMemo(() => {
    const aiCandidates = buddies?.candidates ?? [];
    const aiIds = new Set(aiCandidates.map((c) => c.personId));
    const manualEntries = manualBuddyIds
      .filter((id) => !aiIds.has(id))
      .map((id) => ({
        personId: id,
        rationale: "Manually selected by you.",
        fitScore: 5 as const,
        sameDepartment:
          (peopleById.get(id)?.department ?? "").trim().toLowerCase() ===
            (newHire.department ?? "").trim().toLowerCase() &&
          (newHire.department ?? "").trim().length > 0,
        sharesPilotContext: false,
        isManual: true as const,
      }));
    return [
      ...aiCandidates.map((c) => ({ ...c, isManual: false as const })),
      ...manualEntries,
    ];
  }, [buddies, manualBuddyIds, peopleById, newHire.department]);

  const selectedBuddiesList = useMemo<SelectedBuddy[]>(() => {
    if (displayedBuddyCandidates.length === 0) return [];
    return displayedBuddyCandidates
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
  }, [displayedBuddyCandidates, peopleById, selectedBuddyIds]);

  /** Channels passed through to the assignment dialog for `conversations.invite` after post. */
  const selectedChannelsForAssignment = useMemo((): SelectedChannel[] => {
    if (!recommendation) return [];
    const ai = (recommendation.suggestedChannels ?? [])
      .filter((c) => !unselectedAiChannelIds.has(c.channelId))
      .map(
        (c): SelectedChannel => ({
          channelId: c.channelId,
          channelName: c.channelName,
          rationale: c.rationale,
          isManual: false,
        })
      );
    const aiIds = new Set(ai.map((x) => x.channelId));
    const manual = manualChannels.filter((m) => !aiIds.has(m.channelId));
    return [...ai, ...manual];
  }, [recommendation, unselectedAiChannelIds, manualChannels]);

  const toggleAiSuggestedChannel = useCallback((channelId: string) => {
    const id = channelId.trim();
    if (!id) return;
    setUnselectedAiChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addChannelFromPicker = useCallback(
    (ch: SlackChannel) => {
      const id = ch.id.trim();
      if (!id) return;
      const isAiSuggested =
        recommendation?.suggestedChannels.some((s) => s.channelId === id) ??
        false;
      if (isAiSuggested) {
        setUnselectedAiChannelIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      setManualChannels((prev) => {
        if (prev.some((x) => x.channelId === id)) return prev;
        return [
          ...prev,
          {
            channelId: id,
            channelName: ch.name,
            rationale: "Added manually.",
            isManual: true,
          },
        ];
      });
    },
    [recommendation]
  );

  const removeManualChannelRow = useCallback((channelId: string) => {
    setManualChannels((prev) => prev.filter((x) => x.channelId !== channelId));
  }, []);

  const selectedChannelIdsSet = useMemo(
    () => new Set(selectedChannelsForAssignment.map((c) => c.channelId)),
    [selectedChannelsForAssignment]
  );

  /**
   * Suggested name for the Create-private-channel modal. Slugifies the new hire's first
   * name so the founder just has to confirm or tweak. Matches Slack's channel-name rules
   * (lowercase, hyphens).
   */
  const privateChannelSeedName = useMemo(() => {
    const first = (newHire.name ?? "").trim().split(/\s+/)[0] ?? "";
    const slug = first
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `onboarding-${slug}` : "onboarding";
  }, [newHire.name]);

  const toggleBuddy = useCallback((personId: string) => {
    setSelectedBuddyIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }, []);

  const addManualBuddy = useCallback(
    (personId: string) => {
      const pid = personId.trim();
      if (!pid) return;
      const p = peopleById.get(pid);
      if (!p) return;
      setManualBuddyIds((prev) =>
        prev.includes(pid) ? prev : [...prev, pid]
      );
      if (p.slackHandle?.trim()) {
        setSelectedBuddyIds((prev) => {
          if (prev.has(pid)) return prev;
          const next = new Set(prev);
          next.add(pid);
          return next;
        });
      }
    },
    [peopleById]
  );

  const manualBuddyIdsSet = useMemo(
    () => new Set(manualBuddyIds),
    [manualBuddyIds]
  );

  /**
   * Rows rendered as disabled in the add-partner picker. No Slack id → their checkbox can't
   * actually be toggled into the MPIM flow, but we still show them so the founder can see
   * they exist (in case they want to fix the profile first).
   */
  const buddyPickerDisabledReasons = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people) {
      if (!p.slackHandle?.trim()) map.set(p.id, "No Slack id");
    }
    return map;
  }, [people]);

  const removeManualBuddy = useCallback((personId: string) => {
    setManualBuddyIds((prev) => prev.filter((id) => id !== personId));
    setSelectedBuddyIds((prev) => {
      if (!prev.has(personId)) return prev;
      const next = new Set(prev);
      next.delete(personId);
      return next;
    });
  }, []);

  /**
   * Eligible roster for the "Pick your own buddy" dropdown: same rules as the server buddy prompt
   * (exclude founders / Founders department / the new hire / other new hires / autonomy < 3) so
   * user-picked buddies stay consistent with AI-picked ones.
   */
  const buddyOverrideChoices = useMemo(() => {
    const currentIds = new Set(displayedBuddyCandidates.map((c) => c.personId));
    return people
      .filter((p) => {
        if (p.id === newHire.id) return false;
        if (currentIds.has(p.id)) return false;
        if (isFounderPerson(p)) return false;
        if ((p.department ?? "").trim().toLowerCase() === "founders") return false;
        const a = clampAutonomy(p.autonomyScore);
        if (a < 3) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, newHire.id, displayedBuddyCandidates]);

  const toggleExistingProjectSelection = useCallback(
    (projectId: string) => {
      const pid = projectId.trim();
      if (!pid) return;
      setSelectedExistingProjectIds((prev) => {
        const next = new Set(prev);
        if (next.has(pid)) next.delete(pid);
        else next.add(pid);
        return next;
      });
    },
    []
  );

  const totalSelectedProjectCount =
    selectedExistingProjectIds.size + createdProjectIds.length;

  const continueWithSelectedProjects = useCallback(async () => {
    if (!recommendation) return;
    if (totalSelectedProjectCount === 0) {
      toast.error("Select at least one project to continue.");
      return;
    }
    setContinuing(true);
    try {
      const assigned: AssignedPilotProject[] = [];
      /**
       * Existing projects first (ownerId update), then AI-created ones (already owned by
       * the new hire). Preserves the visual order so the assignment queue matches what the
       * founder saw.
       */
      for (const pid of selectedExistingProjectIds) {
        try {
          await updateProject(pid, { ownerId: newHire.id });
          assigned.push({ projectId: pid, assignmentKind: "owner" });
        } catch (e) {
          toast.error(
            `Could not assign project ${pid}: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
        }
      }
      for (const pid of createdProjectIds) {
        assigned.push({ projectId: pid, assignmentKind: "new_project" });
      }
      if (assigned.length === 0) {
        toast.error("No projects were assigned.");
        return;
      }
      toast.success(
        assigned.length === 1
          ? "Pilot assignment saved"
          : `Assigned ${assigned.length} pilots`
      );
      const buddiesSnapshot = selectedBuddiesList;
      const channelsSnapshot = selectedChannelsForAssignment;
      onClose();
      onBatchAssigned({
        newHire,
        assigned,
        recommendation,
        buddies: buddiesSnapshot,
        channels: channelsSnapshot,
      });
      router.refresh();
    } finally {
      setContinuing(false);
    }
  }, [
    createdProjectIds,
    newHire,
    onBatchAssigned,
    onClose,
    recommendation,
    router,
    selectedBuddiesList,
    selectedChannelsForAssignment,
    selectedExistingProjectIds,
    totalSelectedProjectCount,
  ]);

  const openNewProjectAi = useCallback(
    (rec: OnboardingRecommendation, proposal?: NewPilotProjectProposal) => {
      const np = proposal ?? rec.newProjectProposal;
      const goalId = resolveGoalIdForNewProject(
        hierarchy,
        np.suggestedCompanyId,
        np.suggestedGoalId
      );
      if (!goalId) {
        toast.error("Could not find a goal under the suggested company.");
        return;
      }
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
            /** Queue the new project into the batch instead of firing the assignment dialog immediately. */
            setCreatedProjectIds((prev) =>
              prev.includes(projectId) ? prev : [...prev, projectId]
            );
            setAiCreate(null);
            toast.success("New pilot added to queue");
            router.refresh();
          }}
          onClose={() => {
            setAiCreate(null);
          }}
        />
      ) : null}

      <CreatePrivateChannelDialog
        open={createChannelOpen}
        onClose={() => setCreateChannelOpen(false)}
        seedName={privateChannelSeedName}
        onCreated={(ch) => addChannelFromPicker(ch)}
      />

      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-2 sm:p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommend-pilot-title"
      >
        <div
          className={cn(
            "absolute inset-0",
            !hasStarted && "cursor-pointer"
          )}
          aria-hidden
          onClick={() => {
            if (!hasStarted) onClose();
          }}
        />
        <div className="relative z-10 flex min-h-0 max-h-[min(94vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <PersonAvatarThumb person={newHire} size={22} subtle />
                <h2
                  id="recommend-pilot-title"
                  className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-100"
                >
                  Pilot project for {newHire.name}
                </h2>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                AI suggestions — pick an existing project or generate a new one
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {recommendation?.dmContextSummary?.trim() ? (
                <button
                  type="button"
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  title={recommendation.dmContextSummary.trim()}
                  aria-label="DM context summary from recommender"
                >
                  <Info className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
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

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-5 sm:py-4">
            {!hasStarted ? (
              <div className="flex min-h-[min(52vh,400px)] flex-1 flex-col gap-3 overflow-hidden">
                <div className="shrink-0 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    What direction do you want for {newHire.name}?
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    This is the strongest signal the AI will use when drafting
                    pilot projects and onboarding partners. Skip if you want the
                    AI to infer from the Slack DM and role alone.
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/40">
                  <textarea
                    value={founderContext}
                    onChange={(e) => setFounderContext(e.target.value)}
                    placeholder={founderContextPlaceholder}
                    className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    maxLength={2000}
                    aria-label="Founder direction for the AI recommender"
                    autoFocus
                  />
                  <div className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-800/80 px-3 py-2">
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      {founderContext.trim().length}/2000
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFounderContext("");
                          setHasStarted(true);
                        }}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        onClick={() => setHasStarted(true)}
                        disabled={founderContext.trim().length === 0}
                        className="rounded-md bg-emerald-800/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Start with direction
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : loading && !recommendation ? (
              <div className="flex min-h-[min(52vh,400px)] flex-1 flex-col gap-3 overflow-hidden">
                <div className="shrink-0 space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-200">
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-sky-400"
                        aria-hidden
                      />
                      <span className="truncate">
                        {streaming.length === 0
                          ? streamStatus || "Connecting…"
                          : "Working…"}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {Math.round(scanBarFraction * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-600 transition-[width] duration-100 ease-out motion-reduce:transition-none"
                      style={{
                        width: `${Math.max(2, Math.round(scanBarFraction * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/40">
                  <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                    <span>Analyzing</span>
                  </div>
                  <div
                    ref={modelStreamRef}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400"
                  >
                    {smoothedStreaming ? (
                      <>
                        <span className="whitespace-pre-wrap break-words">
                          {smoothedStreaming}
                        </span>
                        {streamLive ? (
                          <span
                            className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-sky-400 align-[-1px]"
                            aria-hidden
                          />
                        ) : null}
                      </>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="h-2 w-5/6 animate-pulse rounded bg-zinc-800" />
                        <div className="h-2 w-2/3 animate-pulse rounded bg-zinc-800" />
                        <div className="h-2 w-4/5 animate-pulse rounded bg-zinc-800" />
                        <div className="h-2 w-1/2 animate-pulse rounded bg-zinc-800" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {hasStarted ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {error ? (
                  <p className="text-sm text-red-400/90 py-6 text-center">
                    {error}
                  </p>
                ) : null}

                {recommendation ? (
                <>
                  {displayedBuddyCandidates.length > 0 ||
                  buddyOverrideChoices.length > 0 ? (
                    <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/35 px-3 py-3">
                      <div className="mb-2 flex items-center gap-1.5">
                        <Users
                          className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                          aria-hidden
                        />
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                          Onboarding partners
                        </p>
                        <button
                          type="button"
                          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                          title={[
                            "Optional accountability partners. Selected people (with Slack ids) can be added to a group DM with you, the new hire, and Nadav when you send the assignment message.",
                            buddies?.summary?.trim()
                              ? `Pairing note: ${buddies.summary.trim()}`
                              : "",
                            "You can also pick a different teammate from the dropdown below (autonomy 3+ non-founders).",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-label="About onboarding partners"
                        >
                          <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      {displayedBuddyCandidates.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {displayedBuddyCandidates.map((c) => {
                            const p = peopleById.get(c.personId);
                            const checked = selectedBuddyIds.has(c.personId);
                            const noSlack = !p?.slackHandle?.trim();
                            return (
                              <label
                                key={c.personId}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                                  checked
                                    ? "border-zinc-600 bg-zinc-900/60"
                                    : "border-zinc-800 bg-zinc-950/30 hover:border-zinc-700"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={noSlack}
                                  onChange={() => toggleBuddy(c.personId)}
                                  className="mt-2 h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-emerald-600"
                                />
                                {p ? (
                                  <PersonAvatarThumb person={p} size={28} />
                                ) : (
                                  <span
                                    className="h-7 w-7 shrink-0 rounded-full bg-zinc-800"
                                    aria-hidden
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="truncate text-sm font-medium text-zinc-100">
                                      {p?.name ?? c.personId}
                                      {p?.role ? (
                                        <span className="ml-1 text-xs font-normal text-zinc-500">
                                          · {p.role}
                                        </span>
                                      ) : null}
                                    </p>
                                    {c.isManual ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          removeManualBuddy(c.personId);
                                        }}
                                        className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                                        title="Remove onboarding partner"
                                        aria-label={`Remove ${p?.name ?? c.personId} from onboarding partners`}
                                      >
                                        <X className="h-3 w-3" aria-hidden />
                                      </button>
                                    ) : null}
                                  </div>
                                  <p
                                    className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500"
                                    title={c.rationale}
                                  >
                                    {c.rationale}
                                  </p>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                                    {c.isManual ? (
                                      <span className="rounded bg-emerald-950/60 px-1 py-px text-emerald-300">
                                        Manual pick
                                      </span>
                                    ) : (
                                      <span
                                        title="How well this person fits as an onboarding partner (1 weak, 5 strong)."
                                      >
                                        Fit {c.fitScore}/5
                                      </span>
                                    )}
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
                      ) : null}
                      {buddyOverrideChoices.length > 0 ? (
                        <div className="mt-2">
                          <MultiPersonPicker
                            people={buddyOverrideChoices}
                            selectedIds={manualBuddyIdsSet}
                            onToggle={(pid) => {
                              if (manualBuddyIdsSet.has(pid)) {
                                removeManualBuddy(pid);
                              } else {
                                addManualBuddy(pid);
                              }
                            }}
                            disabledReasons={buddyPickerDisabledReasons}
                            label="Add onboarding partner…"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : buddiesError ? (
                    <p className="mb-3 text-xs text-amber-400/80">
                      Could not generate onboarding partner suggestions: {buddiesError}
                    </p>
                  ) : null}

                  {recommendation ? (
                    <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/35 px-3 py-3">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <Hash
                          className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                          aria-hidden
                        />
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                          Slack channel invites
                        </p>
                        <button
                          type="button"
                          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                          title="Optional: invite the new hire to public or private channels for extra context (product, sales, company-specific). Invites run after you post the assignment message via Slack conversations.invite. You must already be a member of each channel."
                          aria-label="About Slack channel invites"
                        >
                          <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
                        AI suggestions use role, pilot company, and channels your teammates are in.
                        Uncheck any you do not want. Add more from the workspace list.
                      </p>
                      {(recommendation.suggestedChannels ?? []).length > 0 ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {(recommendation.suggestedChannels ?? []).map((c) => {
                            const checked = !unselectedAiChannelIds.has(
                              c.channelId
                            );
                            return (
                              <label
                                key={c.channelId}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                                  checked
                                    ? "border-zinc-600 bg-zinc-900/60"
                                    : "border-zinc-800 bg-zinc-950/30 opacity-70"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-950 text-emerald-600"
                                  checked={checked}
                                  onChange={() =>
                                    toggleAiSuggestedChannel(c.channelId)
                                  }
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-zinc-100">
                                    #{c.channelName || c.channelId}
                                    {c.isPrivate ? (
                                      <span className="ml-1.5 text-[10px] font-normal text-zinc-500">
                                        Private
                                      </span>
                                    ) : null}
                                  </p>
                                  <p
                                    className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500"
                                    title={c.rationale}
                                  >
                                    {c.rationale}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          No channel suggestions this run (Slack catalog or signals may be
                          unavailable).
                        </p>
                      )}
                      {manualChannels.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {manualChannels.map((m) => (
                            <li
                              key={m.channelId}
                              className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-xs"
                            >
                              <span className="min-w-0 truncate text-zinc-200">
                                #{m.channelName}
                                <span className="ml-2 text-[10px] text-zinc-500">
                                  Manual
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => removeManualChannelRow(m.channelId)}
                                className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                                aria-label={`Remove #${m.channelName}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <AddChannelPicker
                          selectedChannelIds={selectedChannelIdsSet}
                          onPick={(ch) => addChannelFromPicker(ch)}
                          onCreateNew={() => setCreateChannelOpen(true)}
                          label="Add channel…"
                        />
                      </div>
                    </div>
                  ) : null}

                  {visibleExistingCandidates.length === 0 ? (
                    <p className="mb-3 text-xs text-zinc-500">
                      No strong-fit existing projects with an open owner slot
                      (fit 4+). Pick one of the new pilot ideas below
                      {extraLoading
                        ? " — generating two more with AI…"
                        : extraError
                          ? ` — AI could not draft extras (${extraError}).`
                          : "."}
                    </p>
                  ) : null}

                  <div
                    className={cn(
                      "grid grid-cols-1 gap-3",
                      (() => {
                        const base =
                          visibleExistingCandidates.length === 0
                            ? 1 + extraProposals.length + (extraLoading ? 2 : 0)
                            : visibleExistingCandidates.length + 1;
                        if (base >= 4) {
                          return "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
                        }
                        if (base === 3) return "md:grid-cols-3";
                        if (base === 2) return "md:grid-cols-2";
                        return "mx-auto w-full max-w-lg";
                      })()
                    )}
                  >
                    {visibleExistingCandidates.map((c) => {
                      const proj = projects.find((p) => p.id === c.projectId.trim());
                      const roster = proj
                        ? projectRosterPeople(proj, peopleById)
                        : [];
                      const rosterTitle =
                        roster.map((x) => x.name).join(", ") ||
                        "No people on this card yet";
                      const isSelected = selectedExistingProjectIds.has(
                        c.projectId.trim()
                      );
                      return (
                        <button
                          key={c.projectId}
                          type="button"
                          disabled={!proj || continuing}
                          onClick={() =>
                            toggleExistingProjectSelection(c.projectId)
                          }
                          aria-pressed={isSelected}
                          className={cn(
                            "flex min-h-0 flex-col overflow-hidden rounded-lg border p-3 text-left transition-colors",
                            "disabled:cursor-not-allowed disabled:opacity-40",
                            isSelected
                              ? "border-emerald-600/70 bg-emerald-950/20 ring-1 ring-emerald-500/40"
                              : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/60"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 min-h-[2.5rem] flex-1 text-sm font-medium text-zinc-100">
                              {proj?.name ?? "(No match)"}
                            </p>
                            <span
                              className={cn(
                                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                                isSelected
                                  ? "border-emerald-500/80 bg-emerald-600/80"
                                  : "border-zinc-600 bg-zinc-900/70"
                              )}
                              aria-hidden
                            >
                              {isSelected ? (
                                <Check className="h-3 w-3 text-white" aria-hidden />
                              ) : null}
                            </span>
                          </div>
                          <div className="mt-2 flex min-h-[1.25rem] flex-wrap items-center gap-2">
                            {proj ? (
                              <PriorityPillInline priority={proj.priority} />
                            ) : null}
                            {proj ? (
                              <span className="text-[10px] text-zinc-500">
                                Complexity {proj.complexityScore}
                              </span>
                            ) : null}
                            {roster.length > 0 ? (
                              <span
                                className="inline-flex shrink-0 -space-x-1.5"
                                title={rosterTitle}
                              >
                                {roster.map((person) => (
                                  <span
                                    key={person.id}
                                    className="inline-block ring-2 ring-zinc-900"
                                  >
                                    <PersonAvatarThumb person={person} size={22} />
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </div>
                          <p
                            className="mt-2 line-clamp-3 text-xs leading-snug text-zinc-500"
                            title={c.rationale}
                          >
                            {c.rationale}
                          </p>
                          <p
                            className="mt-auto pt-3 text-[10px] text-zinc-500"
                            title="Model-assessed match strength for this pilot (only cards scoring 4+ are shown)."
                          >
                            Fit {c.fitScore}/5 ·{" "}
                            <span
                              className={
                                isSelected ? "text-emerald-400/90" : "text-zinc-400"
                              }
                            >
                              {isSelected ? "Selected" : "Click to select"}
                            </span>
                          </p>
                        </button>
                      );
                    })}

                    {(() => {
                      const baseProposal: NewPilotProjectProposal = {
                        suggestedCompanyId:
                          recommendation.newProjectProposal.suggestedCompanyId,
                        suggestedGoalId:
                          recommendation.newProjectProposal.suggestedGoalId,
                        suggestedName:
                          recommendation.newProjectProposal.suggestedName,
                        suggestedDefinitionOfDone:
                          recommendation.newProjectProposal
                            .suggestedDefinitionOfDone,
                        rationale:
                          recommendation.newProjectProposal.rationale,
                      };
                      const newCards: NewPilotProjectProposal[] = [
                        baseProposal,
                        ...extraProposals,
                      ];
                      return newCards.map((proposal, idx) => (
                        <div
                          key={`new-${idx}-${proposal.suggestedName}`}
                          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                        >
                          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                            <Sparkles
                              className="h-3 w-3 text-zinc-500"
                              aria-hidden
                            />
                            {idx === 0 ? "New project" : `New project ${idx + 1}`}
                          </p>
                          <p className="line-clamp-2 text-sm font-medium text-zinc-100">
                            {proposal.suggestedName}
                          </p>
                          <p
                            className="mt-2 line-clamp-3 text-xs leading-snug text-zinc-500"
                            title={proposal.rationale}
                          >
                            {proposal.rationale}
                          </p>
                          <button
                            type="button"
                            disabled={continuing || aiCreate !== null}
                            onClick={() =>
                              openNewProjectAi(recommendation, proposal)
                            }
                            className="mt-3 w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
                          >
                            Create with AI…
                          </button>
                        </div>
                      ));
                    })()}

                    {extraLoading &&
                    visibleExistingCandidates.length === 0 &&
                    extraProposals.length === 0
                      ? Array.from({ length: 2 }).map((_, i) => (
                          <div
                            key={`new-skeleton-${i}`}
                            className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                            aria-busy="true"
                            aria-live="polite"
                          >
                            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                              <Loader2
                                className="h-3 w-3 shrink-0 animate-spin text-sky-400"
                                aria-hidden
                              />
                              New project {i + 2}
                            </p>
                            <div className="space-y-2">
                              <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-800" />
                              <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
                              <div className="h-2 w-full animate-pulse rounded bg-zinc-800/70" />
                              <div className="h-2 w-11/12 animate-pulse rounded bg-zinc-800/70" />
                              <div className="h-2 w-2/3 animate-pulse rounded bg-zinc-800/70" />
                            </div>
                            <div className="mt-auto pt-3">
                              <div className="h-8 w-full animate-pulse rounded-md bg-zinc-800/80" />
                            </div>
                          </div>
                        ))
                      : null}
                  </div>

                  <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur-sm supports-[backdrop-filter]:bg-zinc-950/80 sm:-mx-5 sm:px-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-zinc-400">
                        {totalSelectedProjectCount === 0 ? (
                          <>
                            Select one or more existing pilots (click cards) and/or use{" "}
                            <span className="text-zinc-300">Create with AI…</span>, then
                            continue.
                          </>
                        ) : (
                          <>
                            <span className="font-medium tabular-nums text-zinc-200">
                              {totalSelectedProjectCount}
                            </span>{" "}
                            pilot
                            {totalSelectedProjectCount === 1 ? "" : "s"} queued
                            {createdProjectIds.length > 0 ? (
                              <span className="text-zinc-500">
                                {" "}
                                ({createdProjectIds.length} new via AI)
                              </span>
                            ) : null}
                            . You will draft one assignment message per pilot.
                          </>
                        )}
                      </p>
                      <button
                        type="button"
                        disabled={
                          continuing ||
                          totalSelectedProjectCount === 0 ||
                          !recommendation
                        }
                        onClick={() => void continueWithSelectedProjects()}
                        className={cn(
                          "inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold text-white",
                          "bg-emerald-700 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        )}
                      >
                        {continuing ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : null}
                        Continue to assignment…
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(layer, document.body);
}
