"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Person } from "@/lib/types/tracker";
import type {
  SlackSuggestionRecord,
  SlackScrapeSuggestion,
} from "@/lib/schemas/tracker";
import { SlackScrapeEvidencePreview } from "./SlackScrapeEvidencePreview";
import { PriorityPillInline } from "./PriorityPillInline";
import { SlackSuggestionReviseDialog } from "./SlackSuggestionReviseDialog";
import { CollapsePanel } from "./CollapsePanel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  approveSlackSuggestion,
  rejectSlackSuggestion,
} from "@/server/actions/slackSuggestions";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Check,
  ChevronDown,
  Cog,
  Flag,
  Loader2,
  Sparkles,
  Target,
  User,
  X,
} from "lucide-react";
import { displayInitials } from "@/lib/displayInitials";

/** Project draft inside Slack-scraped suggestions (no exported type, derive locally). */
type SlackScrapeProjectDraft = Extract<
  SlackScrapeSuggestion,
  { kind: "newProjectOnExistingGoal" }
>["project"];
type SlackScrapeMilestoneDraft = SlackScrapeProjectDraft["milestones"][number];

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function formatTargetDate(targetDate: string): string {
  const d = new Date(targetDate);
  if (Number.isNaN(d.getTime())) return targetDate;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

/** Tiny inline avatar + first name chip — keeps person mentions visually scannable. */
function PersonInlineChip({ person }: { person: Person | null }) {
  if (!person) {
    return <span className="text-zinc-500">—</span>;
  }
  const photo = person.profilePicturePath?.trim();
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 align-baseline"
      title={person.name}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- local /uploads + remote URLs
        <img
          src={photo}
          alt=""
          className="h-4 w-4 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/70"
        />
      ) : (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[8px] font-semibold text-zinc-300 ring-1 ring-zinc-700/70"
          aria-hidden
        >
          {displayInitials(person.name)}
        </span>
      )}
      <span className="truncate text-zinc-100">{person.name}</span>
    </span>
  );
}

type TitleParts = {
  /** Lead label like "New goal", "Update project", etc. */
  label: string;
  /** Inline body (project name, fields changed, person chips, etc.). */
  body: ReactNode;
  /** Color tone for the lead label. */
  tone: "create" | "edit" | "milestone";
  /** Optional sub-line context, e.g. "in goal: …" — rendered under the title. */
  context?: ReactNode;
};

function findPerson(people: Person[], id: string | undefined): Person | null {
  if (!id) return null;
  const v = id.trim();
  if (!v) return null;
  return people.find((p) => p.id === v) ?? null;
}

function buildTitleParts(
  rec: SlackSuggestionRecord,
  people: Person[],
  goalNamesById: Record<string, string>,
  projectGoalById: Record<string, { projectName: string; goalName: string }>
): TitleParts {
  const p: SlackScrapeSuggestion = rec.payload;
  switch (p.kind) {
    case "newGoalWithProjects": {
      const projectsCount = p.projects?.length ?? 0;
      return {
        label: "New goal",
        tone: "create",
        body: <span className="text-zinc-100">{p.goal.description}</span>,
        context:
          projectsCount > 0 ? (
            <span className="text-zinc-500">
              {projectsCount} project{projectsCount === 1 ? "" : "s"} included
            </span>
          ) : undefined,
      };
    }
    case "newProjectOnExistingGoal": {
      const goalName = goalNamesById[p.existingGoalId];
      return {
        label: "New project",
        tone: "create",
        body: <span className="text-zinc-100">{p.project.name}</span>,
        context: goalName ? (
          <span className="inline-flex items-center gap-1 text-zinc-500">
            <Target className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
            <span className="truncate">
              <span className="text-zinc-500">in goal: </span>
              <span className="text-zinc-300">{goalName}</span>
            </span>
          </span>
        ) : undefined,
      };
    }
    case "editGoal": {
      const goalName = goalNamesById[p.existingGoalId];
      const fields: ReactNode[] = [];
      if (p.patch.description !== undefined)
        fields.push(<span key="title">title</span>);
      if (p.patch.ownerPersonId) {
        const owner = findPerson(people, p.patch.ownerPersonId);
        fields.push(
          <span key="owner" className="inline-flex items-center gap-1">
            <span className="text-zinc-500">owner →</span>
            <PersonInlineChip person={owner} />
          </span>
        );
      }
      if (p.patch.slackChannelId)
        fields.push(<span key="channel">Slack channel</span>);
      if (p.patch.measurableTarget !== undefined)
        fields.push(<span key="target">target</span>);
      return {
        label: "Update goal",
        tone: "edit",
        body: (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-300">
            {fields.length > 0 ? joinNodes(fields, ", ") : "fields"}
          </span>
        ),
        context: goalName ? (
          <span className="inline-flex items-center gap-1 text-zinc-500">
            <Target className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
            <span className="truncate text-zinc-300">{goalName}</span>
          </span>
        ) : undefined,
      };
    }
    case "editProject": {
      const ctx = projectGoalById[p.existingProjectId];
      const fields: ReactNode[] = [];
      if (p.patch.name !== undefined)
        fields.push(<span key="name">name</span>);
      if (p.patch.status)
        fields.push(
          <span key="status">
            <span className="text-zinc-500">status →</span>{" "}
            <span className="text-zinc-200">{p.patch.status}</span>
          </span>
        );
      if (p.patch.priority)
        fields.push(
          <span key="priority" className="inline-flex items-center gap-1">
            <span className="text-zinc-500">priority →</span>
            <PriorityPillInline priority={p.patch.priority} />
          </span>
        );
      if (p.patch.assigneePersonId) {
        const a = findPerson(people, p.patch.assigneePersonId);
        fields.push(
          <span key="assignee" className="inline-flex items-center gap-1">
            <span className="text-zinc-500">assignee →</span>
            <PersonInlineChip person={a} />
          </span>
        );
      }
      return {
        label: "Update project",
        tone: "edit",
        body: (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-300">
            {fields.length > 0 ? joinNodes(fields, ", ") : "fields"}
          </span>
        ),
        context: ctx ? (
          <span className="inline-flex items-center gap-1 text-zinc-500">
            <Target className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
            <span className="truncate">
              <span className="text-zinc-300">{ctx.projectName}</span>
              <span className="text-zinc-600"> · </span>
              <span className="text-zinc-500">{ctx.goalName}</span>
            </span>
          </span>
        ) : undefined,
      };
    }
    case "addMilestoneToExistingProject": {
      const ctx = projectGoalById[p.existingProjectId];
      return {
        label: "Add milestone",
        tone: "milestone",
        body: (
          <span className="text-zinc-100">
            {p.milestone.name}{" "}
            <span className="text-zinc-500">
              ({formatTargetDate(p.milestone.targetDate)})
            </span>
          </span>
        ),
        context: ctx ? (
          <span className="inline-flex items-center gap-1 text-zinc-500">
            <Target className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
            <span className="truncate">
              <span className="text-zinc-300">{ctx.projectName}</span>
              <span className="text-zinc-600"> · </span>
              <span className="text-zinc-500">{ctx.goalName}</span>
            </span>
          </span>
        ) : undefined,
      };
    }
    case "editMilestone": {
      const fields = [p.patch.name, p.patch.targetDate]
        .filter(Boolean)
        .join(" · ");
      return {
        label: "Update milestone",
        tone: "milestone",
        body: <span className="text-zinc-200">{fields || "fields"}</span>,
      };
    }
    default: {
      const _e: never = p;
      return { label: "Suggestion", tone: "edit", body: String(_e) };
    }
  }
}

function joinNodes(nodes: ReactNode[], sep: string): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((n, i) => {
    if (i > 0) out.push(<span key={`s${i}`} className="text-zinc-600">{sep}</span>);
    out.push(n);
  });
  return out;
}

const TONE_STYLES: Record<TitleParts["tone"], string> = {
  create: "border-emerald-600/30 bg-emerald-950/40 text-emerald-200",
  edit: "border-cyan-600/30 bg-cyan-950/40 text-cyan-200",
  milestone: "border-violet-600/30 bg-violet-950/40 text-violet-200",
};

/** One milestone row used inside the project preview. */
function MilestoneItem({ m }: { m: SlackScrapeMilestoneDraft }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-[11px]">
      <Calendar className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-zinc-200">{m.name}</span>
      <span className="shrink-0 tabular-nums text-zinc-500">
        {formatTargetDate(m.targetDate)}
      </span>
    </li>
  );
}

/** Compact preview of a project draft — name, type/priority/complexity, assignee, description, milestones. */
function ProjectDraftPreview({
  project,
  people,
  showHeader = true,
}: {
  project: SlackScrapeProjectDraft;
  people: Person[];
  /** Hide the project name when used inside `newProjectOnExistingGoal` (already in title). */
  showHeader?: boolean;
}) {
  const assignee = findPerson(people, project.assigneePersonId);
  const description = project.description?.trim();
  const dod = project.definitionOfDone?.trim();

  return (
    <div className="space-y-1.5 rounded-md border border-zinc-800/70 bg-zinc-950/50 p-2.5">
      {showHeader ? (
        <p className="truncate text-xs font-medium text-zinc-100">
          {project.name}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Flag className="h-3 w-3 shrink-0" aria-hidden />
          <PriorityPillInline priority={project.priority} />
        </span>
        <span className="inline-flex items-center gap-1 text-zinc-400">
          <Cog className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
          <span>{project.type}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-zinc-400">
          <span className="text-zinc-500">Complexity</span>
          <span className="tabular-nums">{project.complexityScore}/5</span>
        </span>
        {assignee ? (
          <span className="inline-flex items-center gap-1 text-[10px] normal-case tracking-normal">
            <User className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
            <PersonInlineChip person={assignee} />
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="whitespace-pre-wrap text-[11px] leading-snug text-zinc-300">
          {description}
        </p>
      ) : null}
      {dod ? (
        <p className="text-[11px] leading-snug text-zinc-400">
          <span className="text-zinc-500">Done when: </span>
          {dod}
        </p>
      ) : null}
      {project.milestones.length > 0 ? (
        <div className="space-y-0.5 pt-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Milestones · {project.milestones.length}
          </p>
          <ul className="space-y-0.5">
            {project.milestones.map((m, i) => (
              <MilestoneItem key={`${m.name}-${i}`} m={m} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Project / goal details body shown inside the expanded section. Returns null when there's nothing to show. */
function SuggestionDetailsBody({
  rec,
  people,
}: {
  rec: SlackSuggestionRecord;
  people: Person[];
}) {
  const p = rec.payload;
  if (p.kind === "newProjectOnExistingGoal") {
    return <ProjectDraftPreview project={p.project} people={people} showHeader={false} />;
  }
  if (p.kind === "newGoalWithProjects") {
    const owner = findPerson(people, p.goal.ownerPersonId);
    const target = p.goal.measurableTarget?.trim();
    const why = p.goal.whyItMatters?.trim();
    const current = p.goal.currentValue?.trim();
    return (
      <div className="space-y-2.5">
        {target || why || current || owner ? (
          <div className="space-y-1.5 rounded-md border border-zinc-800/70 bg-zinc-950/50 p-2.5 text-[11px] leading-snug">
            {target ? (
              <p>
                <span className="text-zinc-500">Target: </span>
                <span className="text-zinc-200">{target}</span>
              </p>
            ) : null}
            {why ? (
              <p>
                <span className="text-zinc-500">Why: </span>
                <span className="text-zinc-300">{why}</span>
              </p>
            ) : null}
            {current ? (
              <p>
                <span className="text-zinc-500">Current value: </span>
                <span className="text-zinc-300">{current}</span>
              </p>
            ) : null}
            {owner ? (
              <p className="inline-flex items-center gap-1.5">
                <span className="text-zinc-500">Owner:</span>
                <PersonInlineChip person={owner} />
              </p>
            ) : null}
          </div>
        ) : null}
        {p.projects.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Projects · {p.projects.length}
            </p>
            <div className="space-y-1.5">
              {p.projects.map((pr, i) => (
                <ProjectDraftPreview key={`${pr.name}-${i}`} project={pr} people={people} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  if (p.kind === "addMilestoneToExistingProject") {
    return (
      <div className="rounded-md border border-zinc-800/70 bg-zinc-950/50 p-2.5">
        <ul className="space-y-0.5">
          <MilestoneItem m={p.milestone} />
        </ul>
      </div>
    );
  }
  return null;
}

/** Returns true when there's enough non-evidence detail to render in the expand section. */
function suggestionHasDetails(rec: SlackSuggestionRecord): boolean {
  const k = rec.payload.kind;
  return (
    k === "newProjectOnExistingGoal" ||
    k === "newGoalWithProjects" ||
    k === "addMilestoneToExistingProject"
  );
}

/**
 * Compact decision menu — one button replaces the old triplet of
 * Reject / Revise with AI / Approve. Approve is the primary action and the
 * remaining options live in a dropdown under the chevron. Clicks here are
 * stopped from bubbling so the parent row doesn't toggle expand.
 */
function DecideMenu({
  busy,
  onApprove,
  onReject,
  onRevise,
}: {
  busy: "a" | "r" | null;
  onApprove: () => void;
  onReject: () => void;
  onRevise: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative inline-flex shrink-0 items-stretch"
      // Stop the parent row from toggling when interacting with the action menu.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={busy !== null}
        onClick={onApprove}
        title="Approve suggestion"
        className="inline-flex items-center gap-1 rounded-l-md border border-r-0 border-emerald-600/50 bg-emerald-950/50 px-2.5 py-1 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-inset"
      >
        {busy === "a" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden />
        )}
        Approve
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        className={cn(
          "inline-flex items-center justify-center rounded-r-md border border-emerald-600/50 bg-emerald-950/50 px-1.5 text-emerald-100 transition-colors hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-inset",
          open && "bg-emerald-900/60"
        )}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl ring-1 ring-black/30"
        >
          <ul className="py-1">
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onRevise();
                }}
                disabled={busy !== null}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                Revise with AI
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onReject();
                }}
                disabled={busy !== null}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
              >
                {busy === "r" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                ) : (
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                Reject
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Single review card for a Slack-derived suggestion. The whole row is
 * clickable to expand a single accordion section that shows rationale,
 * project / goal / milestone details, and Slack evidence quotes — all in one
 * place. Expansion state is driven by the parent so only one row across the
 * page can be open at a time.
 */
export function SlackSuggestionRow({
  rec,
  people,
  onResolved,
  compact = false,
  goalNamesById = {},
  projectGoalById = {},
  expanded,
  onToggle,
}: {
  rec: SlackSuggestionRecord;
  people: Person[];
  onResolved?: () => void;
  compact?: boolean;
  goalNamesById?: Record<string, string>;
  projectGoalById?: Record<string, { projectName: string; goalName: string }>;
  /** Driven by parent for accordion behavior — only one row open at a time. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"a" | "r" | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);
  const days = daysSince(rec.firstSeenAt);

  const titleParts = useMemo(
    () => buildTitleParts(rec, people, goalNamesById, projectGoalById),
    [rec, people, goalNamesById, projectGoalById]
  );

  const hasDetails = useMemo(() => suggestionHasDetails(rec), [rec]);
  const evidenceCount = rec.payload.evidence.length;
  const hasRationale = (rec.rationale ?? "").trim().length > 0;
  const hasExpandable = hasDetails || evidenceCount > 0 || hasRationale;

  const run = async (fn: () => Promise<unknown>, label: "a" | "r") => {
    setBusy(label);
    try {
      const r = await fn();
      if (
        r &&
        typeof r === "object" &&
        "ok" in r &&
        (r as { ok: boolean }).ok === false
      ) {
        toast.error((r as { error?: string }).error ?? "Failed");
        return;
      }
      onResolved?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRowKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!hasExpandable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role={hasExpandable ? "button" : undefined}
      tabIndex={hasExpandable ? 0 : -1}
      aria-expanded={hasExpandable ? expanded : undefined}
      onClick={hasExpandable ? onToggle : undefined}
      onKeyDown={handleRowKey}
      className={cn(
        "rounded-lg border border-zinc-800 bg-zinc-950/60 transition-colors duration-150 motion-reduce:transition-none focus:outline-none",
        hasExpandable
          ? "cursor-pointer hover:border-zinc-700/80 hover:bg-zinc-950/85 focus-visible:ring-2 focus-visible:ring-zinc-500/40 focus-visible:ring-inset"
          : "",
        expanded && "border-zinc-700/80 bg-zinc-950/85"
      )}
    >
      <div className={cn("p-3", compact && "p-2.5")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  TONE_STYLES[titleParts.tone]
                )}
              >
                {titleParts.label}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm font-medium text-zinc-100 leading-snug">
                {titleParts.body}
              </span>
            </div>
            {titleParts.context ? (
              <p className="min-w-0 truncate text-[11px] leading-snug">
                {titleParts.context}
              </p>
            ) : null}
            <p className="text-[10px] text-zinc-600">
              First surfaced {days === 0 ? "today" : `${days}d ago`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasExpandable ? (
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ease-out motion-reduce:transition-none",
                  expanded && "rotate-180 text-zinc-300"
                )}
                aria-hidden
              />
            ) : null}
            <DecideMenu
              busy={busy}
              onApprove={() => run(() => approveSlackSuggestion(rec.id), "a")}
              onReject={() => run(() => rejectSlackSuggestion(rec.id), "r")}
              onRevise={() => setReviseOpen(true)}
            />
          </div>
        </div>
      </div>
      {hasExpandable ? (
        <CollapsePanel
          open={expanded}
          transitionClassName="duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-150"
          innerClassName={cn(
            "transition-opacity duration-[200ms] ease-out motion-reduce:transition-none motion-reduce:opacity-100",
            expanded ? "opacity-100" : "opacity-0"
          )}
        >
          <div
            className="space-y-3 border-t border-zinc-800/70 bg-zinc-950/40 p-3"
            // Inside content shouldn't toggle the row when clicked (e.g.
            // selecting text in the rationale or a quote).
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {hasRationale ? (
              <section>
                <p className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <Sparkles
                    className="h-3 w-3 text-amber-400/90"
                    aria-hidden
                  />
                  Why this suggestion?
                </p>
                <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-300">
                  {rec.rationale}
                </p>
              </section>
            ) : null}
            {hasDetails ? (
              <section>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Details
                </p>
                <SuggestionDetailsBody rec={rec} people={people} />
              </section>
            ) : null}
            {evidenceCount > 0 ? (
              <section>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Slack {evidenceCount === 1 ? "quote" : "quotes"} ·{" "}
                  {evidenceCount}
                </p>
                <div className="space-y-2">
                  {rec.payload.evidence.map((ev, i) => (
                    <SlackScrapeEvidencePreview
                      key={`${ev.ts}-${i}`}
                      evidence={ev}
                      people={people}
                      channelLabel={ev.channel}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </CollapsePanel>
      ) : null}
      {reviseOpen ? (
        <SlackSuggestionReviseDialog
          rec={rec}
          people={people}
          onClose={() => setReviseOpen(false)}
          onApproved={onResolved}
        />
      ) : null}
    </div>
  );
}
