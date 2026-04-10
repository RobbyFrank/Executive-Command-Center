"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyWithGoals, Person } from "@/lib/types/tracker";
import { firstNameFromFullName } from "@/lib/personDisplayName";
import { clampAutonomy, isFounderPersonId } from "@/lib/autonomyRoster";
import type { Priority, Status } from "@/lib/types/tracker";
import { StatusEnum } from "@/lib/schemas/tracker";
import {
  updateGoal,
  updateProject,
  markGoalReviewed,
  markProjectReviewed,
} from "@/server/actions/tracker";
import {
  computeGoalConfidence,
  computeProjectConfidenceFromProject,
  explainGoalConfidence,
  explainProjectConfidence,
  fallbackConfidenceExplanation,
} from "@/lib/confidenceScore";
import { formatLastReviewedHint, isReviewStale } from "@/lib/reviewStaleness";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { ExecFlagMenu } from "./ExecFlagMenu";
import { cn } from "@/lib/utils";
import { Building2, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";

const REVIEW_INDEX_STORAGE_KEY = "ecc-review-mode-index";

function clearReviewIndexStorage() {
  try {
    sessionStorage.removeItem(REVIEW_INDEX_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type ReviewItem =
  | {
      kind: "goal";
      id: string;
      companyId: string;
      companyName: string;
      companyShortName: string;
      name: string;
      ownerId: string;
      priority: Priority;
      status: Status;
      lastReviewed: string;
      atRisk: boolean;
      spotlight: boolean;
      confidence: number;
    }
  | {
      kind: "project";
      id: string;
      goalId: string;
      companyId: string;
      companyName: string;
      companyShortName: string;
      goalLabel: string;
      name: string;
      ownerId: string;
      priority: Priority;
      status: Status;
      lastReviewed: string;
      atRisk: boolean;
      spotlight: boolean;
      confidence: number;
    };

function itemReviewStale(
  item: ReviewItem,
  peopleById: Map<string, Person>
): boolean {
  const ownerId = item.ownerId.trim();
  const autonomy = ownerId
    ? peopleById.get(ownerId)?.autonomyScore
    : undefined;
  return isReviewStale(
    item.lastReviewed,
    item.kind === "goal" ? "goal" : "project",
    autonomy
  );
}

/** YYYY-MM-DD or empty → label + overdue hint vs today (local). */
function projectTargetDatePresentation(iso: string): {
  label: string;
  overdue: boolean;
} {
  const t = iso.trim();
  if (!t) return { label: "—", overdue: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { label: t, overdue: false };
  const [y, mo, d] = t.split("-").map(Number);
  const target = new Date(y, mo - 1, d);
  const today = new Date();
  const startToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const overdue = target.getTime() < startToday.getTime();
  return {
    label: target.toLocaleDateString(undefined, {
      dateStyle: "medium",
    }),
    overdue,
  };
}

function ReviewCompanyLogo({
  logoPath,
  title,
  size = "md",
}: {
  logoPath?: string;
  title: string;
  size?: "sm" | "md";
}) {
  const path = logoPath?.trim();
  const box = size === "sm" ? "h-5 w-5 rounded-md" : "h-9 w-9 rounded-lg";
  const iconClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  if (path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local uploads under /public
      <img
        src={path}
        alt=""
        title={title}
        className={cn(
          "shrink-0 object-cover ring-1 ring-zinc-700",
          box
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-zinc-800 ring-1 ring-zinc-700",
        box
      )}
      title={title}
      aria-hidden
    >
      <Building2 className={cn("text-zinc-500", iconClass)} />
    </span>
  );
}

function ReviewOwnerAvatar({
  person,
  ownerId,
}: {
  person: Person | undefined;
  ownerId: string;
}) {
  const id = ownerId.trim();
  if (!id) {
    return (
      <span className="shrink-0 text-xs text-zinc-500" title="Unassigned">
        —
      </span>
    );
  }
  if (!person) {
    return (
      <span
        className="shrink-0 max-w-[7rem] truncate text-xs text-zinc-500"
        title={ownerId}
      >
        ?
      </span>
    );
  }
  const path = person.profilePicturePath?.trim();
  const display = firstNameFromFullName(person.name);
  const title = person.name;
  const autonomyRing =
    !isFounderPersonId(person.id) && clampAutonomy(person.autonomyScore) <= 2;

  if (path) {
    return (
      <span
        className="inline-flex max-w-[11rem] shrink-0 items-center gap-2"
        title={title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={path}
          alt=""
          className={cn(
            "h-8 w-8 shrink-0 rounded-full object-cover ring-2",
            autonomyRing ? "ring-amber-500/75" : "ring-zinc-700"
          )}
        />
        <span className="truncate text-sm text-zinc-200">{display}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex max-w-[11rem] shrink-0 items-center gap-1.5"
      title={title}
    >
      {autonomyRing ? (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-amber-500/90 ring-1 ring-amber-400/50"
          aria-hidden
        />
      ) : null}
      <span className="truncate text-sm text-zinc-200">{display}</span>
    </span>
  );
}

function collectP0P1Items(
  hierarchy: CompanyWithGoals[],
  peopleById: Map<string, Person>
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const c of hierarchy) {
    for (const g of c.goals) {
      if (g.priority === "P0" || g.priority === "P1") {
        out.push({
          kind: "goal",
          id: g.id,
          companyId: c.id,
          companyName: c.name,
          companyShortName: c.shortName,
          name: g.description,
          ownerId: g.ownerId,
          priority: g.priority,
          status: g.status,
          lastReviewed: g.lastReviewed,
          atRisk: g.atRisk,
          spotlight: g.spotlight,
          confidence: computeGoalConfidence(g.projects, peopleById),
        });
      }
      for (const p of g.projects) {
        if (p.priority === "P0" || p.priority === "P1") {
          out.push({
            kind: "project",
            id: p.id,
            goalId: g.id,
            companyId: c.id,
            companyName: c.name,
            companyShortName: c.shortName,
            goalLabel: g.description,
            name: p.name,
            ownerId: p.ownerId,
            priority: p.priority,
            status: p.status,
            lastReviewed: p.lastReviewed,
            atRisk: p.atRisk,
            spotlight: p.spotlight,
            confidence: computeProjectConfidenceFromProject(p, peopleById),
          });
        }
      }
    }
  }

  const prOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  out.sort((a, b) => {
    const pa = prOrder[a.priority] ?? 9;
    const pb = prOrder[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    const staleA = itemReviewStale(a, peopleById) ? 0 : 1;
    const staleB = itemReviewStale(b, peopleById) ? 0 : 1;
    if (staleA !== staleB) return staleA - staleB;
    const ca = a.companyName.localeCompare(b.companyName);
    if (ca !== 0) return ca;
    return a.name.localeCompare(b.name);
  });
  return out;
}

interface ReviewModeProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
}

export function ReviewMode({ hierarchy, people }: ReviewModeProps) {
  const router = useRouter();
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );

  const companyById = useMemo(
    () => new Map(hierarchy.map((c) => [c.id, c])),
    [hierarchy]
  );

  const items = useMemo(
    () => collectP0P1Items(hierarchy, peopleById),
    [hierarchy, peopleById]
  );

  const [index, setIndex] = useState(0);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [done, setDone] = useState(false);

  const current = items[index];
  const total = items.length;
  const currentCompany = current
    ? companyById.get(current.companyId)
    : undefined;

  const currentConfidenceExplanation = useMemo(() => {
    if (!current) return null;
    if (current.kind === "goal") {
      for (const c of hierarchy) {
        const g = c.goals.find((x) => x.id === current.id);
        if (g) return explainGoalConfidence(g, peopleById);
      }
      return null;
    }
    for (const c of hierarchy) {
      for (const g of c.goals) {
        const p = g.projects.find((x) => x.id === current.id);
        if (p) return explainProjectConfidence(p, peopleById);
      }
    }
    return null;
  }, [current, hierarchy, peopleById]);

  const currentGoalFromHierarchy = useMemo(() => {
    if (!current || current.kind !== "goal") return null;
    for (const c of hierarchy) {
      const g = c.goals.find((x) => x.id === current.id);
      if (g) return g;
    }
    return null;
  }, [current, hierarchy]);

  const currentProjectFromHierarchy = useMemo(() => {
    if (!current || current.kind !== "project") return null;
    for (const c of hierarchy) {
      for (const g of c.goals) {
        const p = g.projects.find((x) => x.id === current.id);
        if (p) return p;
      }
    }
    return null;
  }, [current, hierarchy]);

  const p0p1ProjectsUnderGoal = useMemo(() => {
    if (!currentGoalFromHierarchy) return [];
    return currentGoalFromHierarchy.projects.filter(
      (p) => p.priority === "P0" || p.priority === "P1"
    );
  }, [currentGoalFromHierarchy]);

  const nextPendingMilestone = useMemo(() => {
    if (!currentProjectFromHierarchy) return undefined;
    return getNextPendingMilestone(currentProjectFromHierarchy.milestones);
  }, [currentProjectFromHierarchy]);

  const isCurrentStale = useMemo(
    () => (current ? itemReviewStale(current, peopleById) : false),
    [current, peopleById]
  );

  const projectTargetPresentation = useMemo(() => {
    if (!currentProjectFromHierarchy) return null;
    return projectTargetDatePresentation(currentProjectFromHierarchy.targetDate);
  }, [currentProjectFromHierarchy]);

  const milestoneProgress = useMemo(() => {
    if (!currentProjectFromHierarchy) return null;
    const m = currentProjectFromHierarchy.milestones;
    const doneCount = m.filter((x) => x.status === "Done").length;
    return { doneCount, milestoneCount: m.length };
  }, [currentProjectFromHierarchy]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  const restoredIndexRef = useRef(false);
  useEffect(() => {
    if (restoredIndexRef.current || total === 0) return;
    restoredIndexRef.current = true;
    try {
      const raw = sessionStorage.getItem(REVIEW_INDEX_STORAGE_KEY);
      if (raw == null) return;
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) return;
      setIndex(Math.min(Math.max(0, n), Math.max(0, total - 1)));
    } catch {
      /* ignore */
    }
  }, [total]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, total - 1)));
  }, [total]);

  const isFirstPersist = useRef(true);
  useEffect(() => {
    if (total === 0) return;
    if (isFirstPersist.current) {
      isFirstPersist.current = false;
      return;
    }
    try {
      sessionStorage.setItem(REVIEW_INDEX_STORAGE_KEY, String(index));
    } catch {
      /* ignore */
    }
  }, [index, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done || total === 0) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("select, input, textarea, [contenteditable=true]")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, done, total]);

  const onMarkReviewed = useCallback(async () => {
    if (!current) return;
    if (current.kind === "goal") {
      await markGoalReviewed(current.id);
    } else {
      await markProjectReviewed(current.id);
    }
    router.refresh();
    setSessionReviewed((n) => n + 1);
    if (index < total - 1) setIndex((i) => i + 1);
    else {
      clearReviewIndexStorage();
      setDone(true);
    }
  }, [current, index, total, router]);

  const bulkMarkAllReviewed = useCallback(async () => {
    for (const it of items) {
      if (it.kind === "goal") {
        await markGoalReviewed(it.id);
      } else {
        await markProjectReviewed(it.id);
      }
    }
    router.refresh();
    setSessionReviewed(items.length);
    clearReviewIndexStorage();
    setDone(true);
  }, [items, router]);

  if (total === 0) {
    return (
      <div className="px-6 py-12">
        <p className="text-zinc-500 text-sm">
          No P0 or P1 goals or projects in the portfolio.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="px-6 py-12 max-w-lg">
        <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-6 py-8 text-center">
          <ClipboardCheck className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-zinc-100">Review complete</h2>
          <p className="text-sm text-zinc-400 mt-2">
            Marked {sessionReviewed} of {total} items as reviewed this session.
          </p>
          <button
            type="button"
            onClick={() => {
              clearReviewIndexStorage();
              setDone(false);
              setIndex(0);
              setSessionReviewed(0);
              restoredIndexRef.current = false;
            }}
            className="mt-6 text-sm text-cyan-400 hover:text-cyan-300 cursor-pointer"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  const statusOptions = StatusEnum.options.map((s) => ({ value: s, label: s }));

  return (
    <div className="px-6 pb-10 max-w-3xl">
      <header className="mb-8">
        <h1 className="text-xl font-bold text-zinc-100">Review mode</h1>
        <p className="text-sm text-zinc-500 mt-1">
          P0/P1 items are ordered with stale reviews first. Path: company → goal → project; milestones
          appear on project steps. Keyboard:{" "}
          <kbd className="rounded border border-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
            ←
          </kbd>{" "}
          <kbd className="rounded border border-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
            →
          </kbd>{" "}
          between items (not while a dropdown is focused).
        </p>
      </header>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/75 transition-[width] duration-300 ease-out"
          style={{ width: `${((index + 1) / total) * 100}%` }}
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Review progress: item ${index + 1} of ${total}`}
        />
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-sm text-zinc-400 tabular-nums">
          {index + 1} of {total}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-800/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-900"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={index >= total - 1}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-800/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-900"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <details className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/25 px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-300">
          Jump to item ({total})
        </summary>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
          {items.map((it, i) => {
            const co = companyById.get(it.companyId);
            return (
              <li key={`${it.kind}-${it.id}`}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                    i === index
                      ? "bg-zinc-800 text-zinc-100 ring-1 ring-inset ring-zinc-600"
                      : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  )}
                >
                  <ReviewCompanyLogo
                    size="sm"
                    logoPath={co?.logoPath}
                    title={it.companyName}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-zinc-500">{it.priority}</span>
                    <span className="text-zinc-600"> · </span>
                    <span className="text-zinc-400">{it.companyShortName}</span>
                    {it.kind === "project" ? (
                      <>
                        <span className="text-zinc-600"> · </span>
                        <span className="text-zinc-500">{it.goalLabel}</span>
                        <span className="text-zinc-600"> · </span>
                        <span className="font-medium text-cyan-400/90">
                          {it.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-zinc-600"> · </span>
                        <span className="font-medium text-violet-400/90">
                          {it.name}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </details>

      {current ? (
        <div
          className={cn(
            "group rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-5",
            current.kind === "goal" ? "border-l-4 border-l-violet-500/50" : "border-l-4 border-l-cyan-500/40",
            isCurrentStale && "ring-1 ring-amber-500/20"
          )}
        >
          {isCurrentStale ? (
            <div className="rounded-md border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs text-amber-100/90">
              Review is past cadence for this owner’s lane (autonomy-based window).
            </div>
          ) : null}

          <nav
            aria-label="Portfolio context"
            className="flex flex-wrap items-start gap-3 sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <ReviewCompanyLogo
                logoPath={currentCompany?.logoPath}
                title={current.companyName}
              />
              <p className="min-w-0 flex-1 text-sm leading-snug text-balance">
                <span className="font-mono tabular-nums text-zinc-500">
                  {current.priority}
                </span>
                <span className="text-zinc-600"> · </span>
                <span className="text-zinc-300">{current.companyShortName}</span>
                {current.kind === "project" ? (
                  <>
                    <span className="text-zinc-600"> · </span>
                    <span className="text-zinc-400">{current.goalLabel}</span>
                    <span className="text-zinc-600"> · </span>
                    <span className="font-semibold text-zinc-100">{current.name}</span>
                    {projectTargetPresentation &&
                    projectTargetPresentation.label !== "—" ? (
                      <>
                        <span className="text-zinc-600"> · </span>
                        <span
                          className={cn(
                            "text-zinc-400",
                            projectTargetPresentation.overdue &&
                              "font-medium text-amber-400/95"
                          )}
                        >
                          {projectTargetPresentation.label}
                          {projectTargetPresentation.overdue ? " (overdue)" : ""}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="text-zinc-600"> · </span>
                    <span className="font-semibold text-zinc-100">{current.name}</span>
                  </>
                )}
              </p>
            </div>
            <ReviewOwnerAvatar
              person={
                current.ownerId.trim()
                  ? peopleById.get(current.ownerId.trim())
                  : undefined
              }
              ownerId={current.ownerId}
            />
          </nav>

          {current.kind === "goal" && p0p1ProjectsUnderGoal.length > 0 ? (
            <p className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-xs leading-relaxed text-zinc-300">
              {p0p1ProjectsUnderGoal.map((p) => p.name).join(" · ")}
            </p>
          ) : null}

          {current.kind === "project" && currentProjectFromHierarchy ? (
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5 text-xs">
              {milestoneProgress && milestoneProgress.milestoneCount > 0 ? (
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500/60 transition-[width]"
                      style={{
                        width: `${(milestoneProgress.doneCount / milestoneProgress.milestoneCount) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 tabular-nums text-[10px] text-zinc-500">
                    {milestoneProgress.doneCount}/{milestoneProgress.milestoneCount} done
                  </span>
                </div>
              ) : null}
              {currentProjectFromHierarchy.milestones.length === 0 ? (
                <p className="text-zinc-500">
                  None yet — add milestones from the main tracker under this project.
                </p>
              ) : (
                <ul className="space-y-1 text-zinc-300">
                  {currentProjectFromHierarchy.milestones.slice(0, 10).map((m) => (
                    <li key={m.id} className="flex gap-2">
                      <span
                        className={cn(
                          "shrink-0 text-[10px] font-mono uppercase",
                          m.status === "Done" ? "text-emerald-500/80" : "text-amber-500/85"
                        )}
                      >
                        {m.status === "Done" ? "Done" : "Open"}
                      </span>
                      <span
                        className={cn(
                          "min-w-0",
                          m.status === "Done" && "text-zinc-500 line-through decoration-zinc-600"
                        )}
                      >
                        {m.name}
                      </span>
                    </li>
                  ))}
                  {currentProjectFromHierarchy.milestones.length > 10 ? (
                    <li className="text-zinc-500 pt-0.5">
                      …and {currentProjectFromHierarchy.milestones.length - 10} more
                    </li>
                  ) : null}
                </ul>
              )}
              {nextPendingMilestone ? (
                <p className="mt-2 border-t border-zinc-800/80 pt-2 text-sm text-zinc-400">
                  Next:{" "}
                  <span className="font-medium text-zinc-200">
                    {nextPendingMilestone.name}
                  </span>
                </p>
              ) : currentProjectFromHierarchy.milestones.length > 0 ? (
                <p className="mt-2 border-t border-zinc-800/80 pt-2 text-sm text-emerald-500/80">
                  All milestones done.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="sr-only" htmlFor="review-status-select">
                Delivery status
              </label>
              <select
                id="review-status-select"
                value={current.status}
                onChange={(e) => {
                  const v = e.target.value as Status;
                  if (current.kind === "goal") {
                    void updateGoal(current.id, { status: v }).then(() =>
                      router.refresh()
                    );
                  } else {
                    void updateProject(current.id, { status: v }).then(() =>
                      router.refresh()
                    );
                  }
                }}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="sr-only">Confidence (automatic)</span>
              <AutoConfidencePercent
                score={current.confidence}
                explanation={
                  currentConfidenceExplanation ??
                  fallbackConfidenceExplanation(
                    "Confidence could not be resolved for this item."
                  )
                }
              />
            </div>
          </div>

          <p className="text-sm text-zinc-400">
            {current.lastReviewed.trim()
              ? formatLastReviewedHint(current.lastReviewed)
              : "—"}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <ExecFlagMenu
              atRisk={current.atRisk}
              spotlight={current.spotlight}
              entityLabel={current.kind === "goal" ? "Goal" : "Project"}
              onCommit={(flags) => {
                if (current.kind === "goal") {
                  void updateGoal(current.id, flags).then(() => router.refresh());
                } else {
                  void updateProject(current.id, flags).then(() =>
                    router.refresh()
                  );
                }
              }}
            />
            <button
              type="button"
              onClick={() => void onMarkReviewed()}
              className="inline-flex cursor-pointer items-center rounded-md bg-zinc-100 text-zinc-900 px-4 py-2 text-sm font-medium hover:bg-white"
            >
              Mark reviewed &amp; next
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-10 pt-6 border-t border-zinc-800">
        <button
          type="button"
          onClick={() => void bulkMarkAllReviewed()}
          className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline"
        >
          Mark all {total} as reviewed (bulk)
        </button>
      </div>
    </div>
  );
}
