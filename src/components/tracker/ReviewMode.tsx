"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CompanyWithGoals,
  GoalWithProjects,
  Person,
  GoalStatus,
  ProjectStatus,
  Priority,
  ProjectType,
} from "@/lib/types/tracker";
import {
  GoalStatusEnum,
  PriorityEnum,
  ProjectTypeEnum,
} from "@/lib/schemas/tracker";
import {
  updateGoal,
  updateProject,
  markGoalReviewed,
  markProjectReviewed,
  createMilestone,
} from "@/server/actions/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import { ReviewLogPanel } from "./ReviewLogPanel";
import { ProgressBar } from "./ProgressBar";
import {
  SCORE_BAND_OPTIONS,
  parseScoreBand,
  scoreBandLabel,
} from "@/lib/tracker-score-bands";
import { prioritySelectTextClass } from "@/lib/prioritySort";
import { SlackChannelPicker } from "./SlackChannelPicker";
import { Plus } from "lucide-react";
import {
  computeGoalConfidence,
  computeProjectConfidenceFromProject,
  explainGoalConfidence,
  explainProjectConfidence,
  fallbackConfidenceExplanation,
  type ConfidenceExplanation,
} from "@/lib/confidenceScore";
import {
  formatLastReviewedHint,
  getReviewStaleWindowHours,
  isReviewStale,
} from "@/lib/reviewStaleness";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { costOfDelayFormatDisplay } from "./CostOfDelayDisplay";
import { complexityFormatDisplay } from "./ComplexityBandDisplay";
import { ExecFlagMenu } from "./ExecFlagMenu";
import { MilestoneRow } from "./MilestoneRow";
import { WarningsBadge } from "./WarningsBadge";
import {
  getGoalHeaderWarnings,
  getTrackerProjectWarnings,
  type TrackerWarning,
} from "@/lib/tracker-project-warnings";
import { projectMatchesCloseWatch } from "@/lib/closeWatch";
import {
  AUTONOMY_GROUP_LABEL,
  clampAutonomy,
  isFounderPerson,
} from "@/lib/autonomyRoster";
import { cn } from "@/lib/utils";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
  formatRelativeCalendarDateCompact,
} from "@/lib/relativeCalendarDate";
import { PROJECT_STATUS_SELECT_OPTIONS } from "@/lib/projectStatus";
import { ProjectStatusPill } from "./ProjectStatusPill";
import { TRACKER_INLINE_TEXT_ACTION } from "./tracker-text-actions";
import {
  filterTrackerHierarchyByCompanyIds,
  filterTrackerHierarchyByOwner,
  filterTrackerHierarchyByPriority,
} from "@/lib/tracker-search-filter";
import { groupCompaniesByRevenueTier } from "@/lib/companyRevenueTiers";
import { sortPeopleLikeTeamRoster } from "@/lib/autonomyRoster";
import { CompanyFilterMultiSelect } from "./CompanyFilterMultiSelect";
import { OwnerFilterMultiSelect } from "./OwnerFilterMultiSelect";
import { PriorityFilterMultiSelect } from "./PriorityFilterMultiSelect";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FilterX,
  ScanEye,
} from "lucide-react";

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
      status: GoalStatus;
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
      status: ProjectStatus;
      lastReviewed: string;
      atRisk: boolean;
      spotlight: boolean;
      confidence: number;
    };

function ReviewItemContextBar({
  kind,
  goalLabel,
  atRisk,
  spotlight,
  showCloseWatch,
  warnings,
}: {
  kind: "goal" | "project";
  goalLabel?: string;
  atRisk: boolean;
  spotlight: boolean;
  showCloseWatch: boolean;
  warnings: TrackerWarning[];
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800/80 pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide ring-1",
            kind === "goal"
              ? "bg-violet-500/15 text-violet-100 ring-violet-500/45"
              : "bg-cyan-500/15 text-cyan-100 ring-cyan-500/45"
          )}
        >
          {kind === "goal" ? "Goal" : "Project"}
        </span>
        {kind === "project" && goalLabel ? (
          <span className="text-sm text-zinc-400">
            Under{" "}
            <span className="font-medium text-zinc-200">{goalLabel}</span>
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {atRisk && (
          <span
            className="whitespace-nowrap rounded-md border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/95"
            title="Marked at risk"
          >
            At risk
          </span>
        )}
        {spotlight && (
          <span
            className="whitespace-nowrap rounded-md border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95"
            title="Spotlight — win or momentum"
          >
            Spotlight
          </span>
        )}
        {kind === "project" && showCloseWatch && (
          <span
            className="whitespace-nowrap rounded-md border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/95"
            title="P0/P1 with owner autonomy 1–2 — stay closer on delivery"
          >
            Close watch
          </span>
        )}
        {warnings.length === 1 && (
          <span
            className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95"
            title={warnings[0].title}
          >
            {warnings[0].label}
          </span>
        )}
        {warnings.length > 1 && <WarningsBadge warnings={warnings} />}
      </div>
    </div>
  );
}

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

const PRIORITY_ORDER: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function priorityRank(priority: Priority): number {
  return PRIORITY_ORDER[priority];
}

/**
 * All goals plus projects that **need review** (stale vs last reviewed), ordered P0→P3
 * then stale-first within priority. Project cadence matches Roadmap **Need review**
 * (`getReviewStaleWindowHours` by owner autonomy), not raw P-tier.
 */
function collectReviewItems(
  hierarchy: CompanyWithGoals[],
  peopleById: Map<string, Person>
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const c of hierarchy) {
    for (const g of c.goals) {
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
        confidence: computeGoalConfidence(g.projects, peopleById, g.costOfDelay),
      });
      for (const p of g.projects) {
        /** One queue entry per project — mirrors are the same record under another goal. */
        if (p.isMirror) continue;
        const projectItem: ReviewItem = {
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
        };
        if (!itemReviewStale(projectItem, peopleById)) continue;
        out.push(projectItem);
      }
    }
  }

  out.sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
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

function ReviewEntityColumn({
  title,
  titleClassName,
  children,
}: {
  title: string;
  titleClassName: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-800/90 bg-zinc-950/40 p-4">
      <h3
        className={cn(
          "mb-3 shrink-0 text-xs font-bold uppercase tracking-wide",
          titleClassName
        )}
      >
        {title}
      </h3>
      <div className="min-h-0 min-w-0 flex-1 space-y-4">{children}</div>
    </section>
  );
}

function ReviewNotesScrollColumn({
  entryCount,
  children,
}: {
  entryCount: number;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Review notes"
      className="flex min-h-[min(36vh,20rem)] flex-col rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-9rem)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">
          Review notes
        </h3>
        {entryCount > 0 ? (
          <span className="text-[11px] tabular-nums text-zinc-500">
            {entryCount}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </section>
  );
}

function GoalFieldsEditor({
  goal,
  people,
  ownerWorkloadMap,
  priorityOptions,
  goalStatusOptions,
  confidenceScore,
  confidenceExplanation,
  projectNamesSummary,
  refresh,
}: {
  goal: GoalWithProjects;
  people: Person[];
  ownerWorkloadMap: Map<string, { total: number; p0: number; p1: number }>;
  priorityOptions: { value: string; label: string }[];
  goalStatusOptions: { value: string; label: string }[];
  confidenceScore: number;
  confidenceExplanation: ConfidenceExplanation | null;
  projectNamesSummary: string | null;
  refresh: () => void;
}) {
  return (
    <>
      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 mb-1">DRI</p>
        <OwnerPickerCell
          people={people}
          value={goal.ownerId}
          onSave={(ownerId) =>
            void updateGoal(goal.id, { ownerId }).then(refresh)
          }
          priority={goal.priority}
          workloadMap={ownerWorkloadMap}
          restrictToGoalDriEligible
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-500 mb-1">Priority</p>
          <InlineEditCell
            value={goal.priority}
            onSave={(priority) =>
              void updateGoal(goal.id, {
                priority: priority as Priority,
              }).then(refresh)
            }
            type="select"
            options={priorityOptions}
            displayClassName={cn(
              "font-medium",
              prioritySelectTextClass(goal.priority)
            )}
          />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-500 mb-1">Status</p>
          <InlineEditCell
            value={goal.status}
            onSave={(status) =>
              void updateGoal(goal.id, {
                status: status as GoalStatus,
              }).then(refresh)
            }
            type="select"
            options={goalStatusOptions}
          />
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 mb-1">Goal (title)</p>
        <InlineEditCell
          value={goal.description}
          onSave={(description) =>
            void updateGoal(goal.id, { description }).then(refresh)
          }
          displayClassName="font-medium text-zinc-100"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-500 mb-1">Target / scope</p>
          <InlineEditCell
            value={goal.measurableTarget}
            onSave={(measurableTarget) =>
              void updateGoal(goal.id, { measurableTarget }).then(refresh)
            }
            placeholder="Add description"
            displayClassName="text-left text-xs leading-normal text-zinc-500"
            displayTruncateSingleLine
            truncateTooltipAlwaysHover
            truncateSubduedPreview
          />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-500 mb-1">Current value</p>
          <InlineEditCell
            value={goal.currentValue}
            onSave={(currentValue) =>
              void updateGoal(goal.id, { currentValue }).then(refresh)
            }
            placeholder="Current value"
            displayClassName="text-left text-xs leading-normal text-zinc-500"
            displayTruncateSingleLine
            truncateTooltipAlwaysHover
            truncateSubduedPreview
          />
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 mb-1">Why it matters</p>
        <InlineEditCell
          value={goal.whyItMatters}
          onSave={(whyItMatters) =>
            void updateGoal(goal.id, { whyItMatters }).then(refresh)
          }
          placeholder="What we stand to gain if we achieve this"
          displayClassName="text-left text-xs leading-normal text-zinc-500"
          displayTruncateSingleLine
          truncateTooltipAlwaysHover
          truncateSubduedPreview
        />
      </div>

      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 mb-1">Cost of delay</p>
        <InlineEditCell
          value={String(goal.costOfDelay)}
          onSave={(v) =>
            void updateGoal(goal.id, {
              costOfDelay: parseScoreBand(v),
            }).then(refresh)
          }
          type="select"
          options={SCORE_BAND_OPTIONS}
          formatDisplay={costOfDelayFormatDisplay}
          displayTitle={`Cost of delay — ${scoreBandLabel(goal.costOfDelay)} (${goal.costOfDelay}/5)`}
        />
      </div>

      <div className="flex justify-end">
        <AutoConfidencePercent
          score={confidenceScore}
          explanation={
            confidenceExplanation ??
            fallbackConfidenceExplanation(
              "Confidence could not be resolved for this item."
            )
          }
        />
      </div>

      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 mb-1">Slack channel</p>
        <SlackChannelPicker
          channelName={goal.slackChannel}
          channelId={goal.slackChannelId ?? ""}
          onSave={({ name, id }) =>
            void updateGoal(goal.id, { slackChannel: name, slackChannelId: id }).then(refresh)
          }
        />
      </div>

      {projectNamesSummary ? (
        <p className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-xs leading-relaxed text-zinc-300">
          {projectNamesSummary}
        </p>
      ) : null}
    </>
  );
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

  const peopleSorted = useMemo(
    () => sortPeopleLikeTeamRoster(people),
    [people]
  );

  const companiesForFilter = useMemo(
    () =>
      groupCompaniesByRevenueTier(hierarchy)
        .flatMap((g) => g.companies)
        .map((c) => ({
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          logoPath: c.logoPath,
          revenue: c.revenue,
        })),
    [hierarchy]
  );

  const [companyFilterIds, setCompanyFilterIds] = useState<string[]>([]);
  const [ownerFilterIds, setOwnerFilterIds] = useState<string[]>([]);
  const [priorityFilterIds, setPriorityFilterIds] = useState<string[]>([]);

  const hierarchyAfterCompany = useMemo(
    () =>
      filterTrackerHierarchyByCompanyIds(
        hierarchy,
        companyFilterIds.length > 0 ? companyFilterIds : null
      ),
    [hierarchy, companyFilterIds]
  );

  const hierarchyAfterOwner = useMemo(
    () =>
      filterTrackerHierarchyByOwner(
        hierarchyAfterCompany,
        ownerFilterIds.length > 0 ? ownerFilterIds : null,
        people
      ),
    [hierarchyAfterCompany, ownerFilterIds, people]
  );

  const hierarchyFiltered = useMemo(
    () =>
      filterTrackerHierarchyByPriority(
        hierarchyAfterOwner,
        priorityFilterIds.length > 0 ? priorityFilterIds : null
      ),
    [hierarchyAfterOwner, priorityFilterIds]
  );

  const companyById = useMemo(
    () => new Map(hierarchy.map((c) => [c.id, c])),
    [hierarchy]
  );

  const ownerWorkloadMap = useMemo(() => {
    const m = new Map<string, { total: number; p0: number; p1: number }>();
    for (const company of hierarchy) {
      for (const goal of company.goals) {
        for (const project of goal.projects) {
          if (project.isMirror) continue;
          if (!project.ownerId) continue;
          let entry = m.get(project.ownerId);
          if (!entry) {
            entry = { total: 0, p0: 0, p1: 0 };
            m.set(project.ownerId, entry);
          }
          entry.total++;
          if (project.priority === "P0") entry.p0++;
          else if (project.priority === "P1") entry.p1++;
        }
      }
    }
    return m;
  }, [hierarchy]);

  const items = useMemo(
    () => collectReviewItems(hierarchyFiltered, peopleById),
    [hierarchyFiltered, peopleById]
  );

  const [index, setIndex] = useState(0);

  const reviewFiltersKey = useMemo(
    () =>
      JSON.stringify([companyFilterIds, ownerFilterIds, priorityFilterIds]),
    [companyFilterIds, ownerFilterIds, priorityFilterIds]
  );
  const prevReviewFiltersKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevReviewFiltersKey.current === null) {
      prevReviewFiltersKey.current = reviewFiltersKey;
      return;
    }
    if (prevReviewFiltersKey.current !== reviewFiltersKey) {
      prevReviewFiltersKey.current = reviewFiltersKey;
      setIndex(0);
    }
  }, [reviewFiltersKey]);

  const reviewFiltersActive =
    companyFilterIds.length > 0 ||
    ownerFilterIds.length > 0 ||
    priorityFilterIds.length > 0;

  const clearReviewFilters = useCallback(() => {
    setCompanyFilterIds([]);
    setOwnerFilterIds([]);
    setPriorityFilterIds([]);
  }, []);

  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [done, setDone] = useState(false);
  const [reviewNoteDraft, setReviewNoteDraft] = useState("");
  const [milestoneNameFocusId, setMilestoneNameFocusId] = useState<
    string | null
  >(null);

  const current = items[index];
  const total = items.length;

  useEffect(() => {
    setReviewNoteDraft("");
    setMilestoneNameFocusId(null);
  }, [current?.id, current?.kind]);

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

  const parentGoalForCurrentProject = useMemo((): GoalWithProjects | null => {
    if (!current || current.kind !== "project") return null;
    for (const c of hierarchy) {
      const g = c.goals.find((x) => x.id === current.goalId);
      if (g) return g;
    }
    return null;
  }, [current, hierarchy]);

  const goalReviewWarnings = useMemo(() => {
    if (!currentGoalFromHierarchy) return [];
    return getGoalHeaderWarnings(currentGoalFromHierarchy, people);
  }, [currentGoalFromHierarchy, people]);

  const projectReviewWarnings = useMemo(() => {
    if (!currentProjectFromHierarchy) return [];
    return getTrackerProjectWarnings(
      currentProjectFromHierarchy,
      parentGoalForCurrentProject?.costOfDelay,
      people
    );
  }, [currentProjectFromHierarchy, parentGoalForCurrentProject, people]);

  const projectCloseWatch = useMemo(() => {
    if (!currentProjectFromHierarchy) return false;
    return projectMatchesCloseWatch(currentProjectFromHierarchy, people);
  }, [currentProjectFromHierarchy, people]);

  const lowAutonomyProjectOwnerHint = useMemo(() => {
    if (!currentProjectFromHierarchy) return null;
    const ownerPerson = people.find(
      (p) => p.id === currentProjectFromHierarchy.ownerId
    );
    if (!ownerPerson || isFounderPerson(ownerPerson)) return null;
    const level = clampAutonomy(ownerPerson.autonomyScore);
    if (level > 2) return null;
    return AUTONOMY_GROUP_LABEL[level].title;
  }, [currentProjectFromHierarchy, people]);

  const parentProjectsSorted = useMemo(() => {
    if (!parentGoalForCurrentProject) return [];
    return [...parentGoalForCurrentProject.projects].sort((a, b) => {
      const d = priorityRank(a.priority) - priorityRank(b.priority);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
  }, [parentGoalForCurrentProject]);

  const parentGoalConfidence = useMemo(() => {
    if (!parentGoalForCurrentProject) return 0;
    return computeGoalConfidence(
      parentGoalForCurrentProject.projects,
      peopleById,
      parentGoalForCurrentProject.costOfDelay
    );
  }, [parentGoalForCurrentProject, peopleById]);

  const parentGoalConfidenceExplanation = useMemo(() => {
    if (!parentGoalForCurrentProject) return null;
    return explainGoalConfidence(parentGoalForCurrentProject, peopleById);
  }, [parentGoalForCurrentProject, peopleById]);

  const parentGoalHeaderWarnings = useMemo(() => {
    if (!parentGoalForCurrentProject) return [];
    return getGoalHeaderWarnings(parentGoalForCurrentProject, people);
  }, [parentGoalForCurrentProject, people]);

  const projectsUnderGoalByPriority = useMemo(() => {
    if (!currentGoalFromHierarchy) return [];
    return [...currentGoalFromHierarchy.projects].sort((a, b) => {
      const d = priorityRank(a.priority) - priorityRank(b.priority);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
  }, [currentGoalFromHierarchy]);

  const nextPendingMilestone = useMemo(() => {
    if (!currentProjectFromHierarchy) return undefined;
    return getNextPendingMilestone(currentProjectFromHierarchy.milestones);
  }, [currentProjectFromHierarchy]);

  const nextPendingMilestoneCompact = useMemo(() => {
    if (!nextPendingMilestone) return null;
    const td = nextPendingMilestone.targetDate.trim();
    return td ? formatRelativeCalendarDateCompact(td) : null;
  }, [nextPendingMilestone]);

  const isCurrentStale = useMemo(
    () => (current ? itemReviewStale(current, peopleById) : false),
    [current, peopleById]
  );

  /** Human-readable cadence for the stale banner (matches review window logic). */
  const staleWindowHint = useMemo(() => {
    if (!current) return null;
    const ownerId = current.ownerId.trim();
    const autonomy = ownerId
      ? peopleById.get(ownerId)?.autonomyScore
      : undefined;
    const hours = getReviewStaleWindowHours(
      current.kind === "goal" ? "goal" : "project",
      autonomy
    );
    if (hours < 48) {
      return `${hours} hours`;
    }
    const days = hours / 24;
    const rounded = Math.round(days * 10) / 10;
    const whole = Math.round(rounded) === rounded;
    if (whole && rounded === 1) return "1 day";
    if (whole) return `${rounded} days`;
    return `about ${rounded} days`;
  }, [current, peopleById]);

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

  const onMarkReviewed = useCallback(async (noteFromComposer?: string) => {
    if (!current) return;
    const trimmed = noteFromComposer?.trim();
    const note = trimmed && trimmed.length > 0 ? trimmed : undefined;
    if (current.kind === "goal") {
      await markGoalReviewed(current.id, note);
    } else {
      await markProjectReviewed(current.id, note);
    }
    setReviewNoteDraft("");
    router.refresh();
    setSessionReviewed((n) => n + 1);
    if (index < total - 1) setIndex((i) => i + 1);
    else {
      clearReviewIndexStorage();
      setDone(true);
    }
  }, [current, index, total, router]);

  if (hierarchy.length === 0) {
    return (
      <div className="px-6 py-12">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 px-6 py-20">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 mb-5">
            <ScanEye className="h-7 w-7 text-zinc-500" />
          </div>
          <h2 className="text-base font-semibold text-zinc-200 mb-1.5">Nothing in the review queue yet</h2>
          <p className="text-sm text-zinc-500 text-center max-w-md">
            When you have goals and projects, this page steps through them in priority order. Add companies and create goals on the{" "}
            <Link href="/" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">
              Roadmap
            </Link>{" "}
            to start reviewing.
          </p>
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-6 py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-xl font-bold text-zinc-100">Review <span className="ml-2 align-middle inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/25">Beta</span></h1>
          <div className="flex flex-wrap items-end gap-2 sm:gap-3">
            <div className="min-w-0 w-[min(100%,12rem)] sm:w-[12rem]">
              <CompanyFilterMultiSelect
                companies={companiesForFilter}
                selectedIds={companyFilterIds}
                onChange={setCompanyFilterIds}
              />
            </div>
            <div className="min-w-0 w-[min(100%,12rem)] sm:w-[12rem]">
              <OwnerFilterMultiSelect
                people={peopleSorted}
                selectedIds={ownerFilterIds}
                onChange={setOwnerFilterIds}
              />
            </div>
            <div className="min-w-0 w-[min(100%,10rem)] sm:w-[10rem]">
              <PriorityFilterMultiSelect
                selectedIds={priorityFilterIds}
                onChange={setPriorityFilterIds}
              />
            </div>
            {reviewFiltersActive ? (
              <button
                type="button"
                onClick={clearReviewFilters}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                title="Clear company, owner, and priority filters"
              >
                <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-zinc-500 text-sm">
          {reviewFiltersActive
            ? "No review items match the current filters. Adjust or clear filters to see the queue."
            : "No goals or projects in the portfolio."}
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

  const goalStatusOptions = GoalStatusEnum.options.map((s) => ({
    value: s,
    label: s,
  }));
  const priorityOptions = PriorityEnum.options.map((p) => ({ value: p, label: p }));
  const projectTypeOptions = ProjectTypeEnum.options.map((t) => ({
    value: t,
    label: t,
  }));

  return (
    <div className="mx-auto w-full max-w-7xl px-6 pt-8 pb-10 sm:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Review <span className="ml-2 align-middle inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/25">Beta</span></h1>
          <p className="text-sm text-zinc-500 tabular-nums mt-1">
            {index + 1} of {total}
            {sessionReviewed > 0 ? (
              <span className="text-zinc-600">
                {" "}· {sessionReviewed} reviewed
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">
          <div className="min-w-0 w-[min(100%,12rem)] sm:w-[12rem]">
            <CompanyFilterMultiSelect
              companies={companiesForFilter}
              selectedIds={companyFilterIds}
              onChange={setCompanyFilterIds}
            />
          </div>
          <div className="min-w-0 w-[min(100%,12rem)] sm:w-[12rem]">
            <OwnerFilterMultiSelect
              people={peopleSorted}
              selectedIds={ownerFilterIds}
              onChange={setOwnerFilterIds}
            />
          </div>
          <div className="min-w-0 w-[min(100%,10rem)] sm:w-[10rem]">
            <PriorityFilterMultiSelect
              selectedIds={priorityFilterIds}
              onChange={setPriorityFilterIds}
            />
          </div>
          {reviewFiltersActive ? (
            <button
              type="button"
              onClick={clearReviewFilters}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors mb-px"
              title="Clear company, owner, and priority filters"
            >
              <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Clear
            </button>
          ) : null}
          <div className="flex shrink-0 items-center gap-2 border-l border-zinc-800 pl-2 sm:pl-3">
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
      </div>

      <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/75 transition-[width] duration-300 ease-out"
          style={{ width: `${((index + 1) / total) * 100}%` }}
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
        />
      </div>

      <details className="mb-5 rounded-lg border border-zinc-800 bg-zinc-950/25 px-3 py-2 text-sm">
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
        <div className="space-y-5">
          <div
            className={cn(
              "rounded-xl border p-4 lg:p-5",
              current.atRisk &&
                "border-amber-700/50 border-l-4 border-l-amber-400 bg-amber-950/25 shadow-[inset_8px_0_0_0_rgba(251,191,36,0.1)] ring-1 ring-amber-500/25",
              !current.atRisk &&
                current.spotlight &&
                "border-emerald-800/50 border-l-4 border-l-emerald-400/80 bg-emerald-950/25 shadow-[inset_8px_0_0_0_rgba(52,211,153,0.1)] ring-1 ring-emerald-500/25",
              !current.atRisk &&
                !current.spotlight &&
                "border-zinc-800 bg-zinc-900/50",
              !current.atRisk &&
                !current.spotlight &&
                current.kind === "goal" &&
                "border-l-4 border-l-violet-500/55",
              !current.atRisk &&
                !current.spotlight &&
                current.kind === "project" &&
                "border-l-4 border-l-cyan-500/50",
              isCurrentStale && "ring-1 ring-amber-400/35"
            )}
          >
            {isCurrentStale ? (
              <p className="mb-4 rounded-md border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs text-amber-200/90">
                Check-in overdue{staleWindowHint ? ` (cadence: every ${staleWindowHint})` : ""}
              </p>
            ) : null}

            <ReviewItemContextBar
              kind={current.kind}
              goalLabel={current.kind === "project" ? current.goalLabel : undefined}
              atRisk={current.atRisk}
              spotlight={current.spotlight}
              showCloseWatch={current.kind === "project" ? projectCloseWatch : false}
              warnings={
                current.kind === "goal"
                  ? goalReviewWarnings
                  : projectReviewWarnings
              }
            />

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <ReviewCompanyLogo
                logoPath={currentCompany?.logoPath}
                title={current.companyName}
              />
              <span className="text-sm text-zinc-300">{current.companyShortName}</span>
            </div>

            {current.kind === "project" ? (
              <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
                <span className="font-semibold text-violet-400/95">Goal</span>
                <span className="mx-2 text-zinc-600">→</span>
                <span className="font-semibold text-cyan-400/95">Project</span>
                <span className="mx-2 text-zinc-600">→</span>
                <span className="text-zinc-500">Review notes</span>
              </p>
            ) : null}
          </div>

          {current.kind === "goal" && currentGoalFromHierarchy ? (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_min(20rem,32vw)] lg:items-stretch">
                <ReviewEntityColumn title="Goal" titleClassName="text-violet-300/95">
                  <GoalFieldsEditor
                    goal={currentGoalFromHierarchy}
                    people={people}
                    ownerWorkloadMap={ownerWorkloadMap}
                    priorityOptions={priorityOptions}
                    goalStatusOptions={goalStatusOptions}
                    confidenceScore={current.confidence}
                    confidenceExplanation={currentConfidenceExplanation}
                    projectNamesSummary={
                      projectsUnderGoalByPriority.length > 0
                        ? projectsUnderGoalByPriority.map((p) => p.name).join(" · ")
                        : null
                    }
                    refresh={() => router.refresh()}
                  />
                </ReviewEntityColumn>

                <ReviewNotesScrollColumn
                  entryCount={currentGoalFromHierarchy.reviewLog?.length ?? 0}
                >
                  <ReviewLogPanel
                    embedded
                    variant="sidebar"
                    entries={currentGoalFromHierarchy.reviewLog}
                    draft={reviewNoteDraft}
                    onDraftChange={setReviewNoteDraft}
                    onMarkReviewed={onMarkReviewed}
                  />
                </ReviewNotesScrollColumn>
              </div>

              <div className="flex flex-col gap-4 border-t border-zinc-800/80 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <p className="text-xs text-zinc-500">
                  Reviewed{" "}
                  {currentGoalFromHierarchy.lastReviewed.trim()
                    ? formatLastReviewedHint(currentGoalFromHierarchy.lastReviewed)
                    : "never"}
                </p>
                <ExecFlagMenu
                  atRisk={currentGoalFromHierarchy.atRisk}
                  spotlight={currentGoalFromHierarchy.spotlight}
                  entityLabel="Goal"
                  onCommit={(flags) => {
                    void updateGoal(currentGoalFromHierarchy.id, flags).then(() =>
                      router.refresh()
                    );
                  }}
                />
              </div>
            </>
          ) : null}

          {current.kind === "project" &&
          currentProjectFromHierarchy &&
          parentGoalForCurrentProject ? (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(11rem,0.95fr)_minmax(12rem,1.05fr)_min(19rem,26vw)] xl:gap-4 xl:items-stretch">
                <ReviewEntityColumn title="Goal" titleClassName="text-violet-300/95">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    {parentGoalForCurrentProject.atRisk ? (
                      <span
                        className="whitespace-nowrap rounded-md border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/95"
                        title="Marked at risk"
                      >
                        At risk
                      </span>
                    ) : null}
                    {parentGoalForCurrentProject.spotlight ? (
                      <span
                        className="whitespace-nowrap rounded-md border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95"
                        title="Spotlight — win or momentum"
                      >
                        Spotlight
                      </span>
                    ) : null}
                    {parentGoalHeaderWarnings.length === 1 ? (
                      <span
                        className="whitespace-nowrap rounded-md border border-orange-400/45 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300/95"
                        title={parentGoalHeaderWarnings[0].title}
                      >
                        {parentGoalHeaderWarnings[0].label}
                      </span>
                    ) : null}
                    {parentGoalHeaderWarnings.length > 1 ? (
                      <WarningsBadge warnings={parentGoalHeaderWarnings} />
                    ) : null}
                  </div>
                  <GoalFieldsEditor
                    goal={parentGoalForCurrentProject}
                    people={people}
                    ownerWorkloadMap={ownerWorkloadMap}
                    priorityOptions={priorityOptions}
                    goalStatusOptions={goalStatusOptions}
                    confidenceScore={parentGoalConfidence}
                    confidenceExplanation={parentGoalConfidenceExplanation}
                    projectNamesSummary={
                      parentProjectsSorted.length > 0
                        ? parentProjectsSorted.map((p) => p.name).join(" · ")
                        : null
                    }
                    refresh={() => router.refresh()}
                  />
                </ReviewEntityColumn>

                <ReviewEntityColumn title="Project" titleClassName="text-cyan-300/95">
              <div className="min-w-0">
                <p className="text-[11px] text-zinc-500 mb-1">Owner</p>
                <OwnerPickerCell
                  people={people}
                  value={currentProjectFromHierarchy.ownerId}
                  onSave={(ownerId) =>
                    void updateProject(currentProjectFromHierarchy.id, {
                      ownerId,
                    }).then(() => router.refresh())
                  }
                  priority={currentProjectFromHierarchy.priority}
                  workloadMap={ownerWorkloadMap}
                />
              </div>

              <div className="min-w-0">
                <p className="text-[11px] text-zinc-500 mb-1">Project name</p>
                <InlineEditCell
                  value={currentProjectFromHierarchy.name}
                  onSave={(name) =>
                    void updateProject(currentProjectFromHierarchy.id, {
                      name,
                    }).then(() => router.refresh())
                  }
                  displayClassName="font-semibold text-zinc-100"
                />
              </div>

              {(currentProjectFromHierarchy.blockedByProjectId ?? "").trim() ? (
                <div className="min-w-0 rounded-md border border-orange-500/25 bg-orange-950/20 px-2.5 py-2">
                  <p className="text-[11px] text-zinc-500 mb-1">Blocked by</p>
                  <p className="text-sm text-zinc-200">
                    <span className="font-medium text-zinc-50">
                      {currentProjectFromHierarchy.blockedByProjectName ??
                        "Unknown project"}
                    </span>
                    {currentProjectFromHierarchy.isBlocked ? (
                      <span className="ml-2 text-xs text-orange-200/95">
                        — waiting on that project&apos;s milestones
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-zinc-500">
                        — blocking project milestones are complete
                      </span>
                    )}
                  </p>
                </div>
              ) : null}

              <div className="min-w-0">
                <p className="text-[11px] text-zinc-500 mb-1">Description</p>
                <InlineEditCell
                  value={currentProjectFromHierarchy.description}
                  onSave={(description) =>
                    void updateProject(currentProjectFromHierarchy.id, {
                      description,
                    }).then(() => router.refresh())
                  }
                  placeholder="Outcome or scope"
                  displayClassName="text-left text-xs leading-normal text-zinc-500"
                  displayTruncateSingleLine
                  truncateTooltipAlwaysHover
                  truncateSubduedPreview
                />
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 mb-1">Priority</p>
                  <InlineEditCell
                    value={currentProjectFromHierarchy.priority}
                    onSave={(priority) =>
                      void updateProject(currentProjectFromHierarchy.id, {
                        priority: priority as Priority,
                      }).then(() => router.refresh())
                    }
                    type="select"
                    options={priorityOptions}
                    displayClassName={cn(
                      "font-medium",
                      prioritySelectTextClass(currentProjectFromHierarchy.priority)
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 mb-1">Status</p>
                  <InlineEditCell
                    className="group/status"
                    overlaySelectQuiet
                    value={currentProjectFromHierarchy.status}
                    onSave={(status) =>
                      void updateProject(currentProjectFromHierarchy.id, {
                        status: status as ProjectStatus,
                      }).then(() => router.refresh())
                    }
                    type="select"
                    options={PROJECT_STATUS_SELECT_OPTIONS}
                    formatDisplay={(v) => (
                      <ProjectStatusPill status={v} variant="inline" />
                    )}
                    selectPresentation="always"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 mb-1">Type</p>
                  <InlineEditCell
                    value={currentProjectFromHierarchy.type}
                    onSave={(type) =>
                      void updateProject(currentProjectFromHierarchy.id, {
                        type: type as ProjectType,
                      }).then(() => router.refresh())
                    }
                    type="select"
                    options={projectTypeOptions}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 mb-1">Complexity</p>
                  <InlineEditCell
                    value={String(currentProjectFromHierarchy.complexityScore)}
                    onSave={(v) =>
                      void updateProject(currentProjectFromHierarchy.id, {
                        complexityScore: parseScoreBand(v),
                      }).then(() => router.refresh())
                    }
                    type="select"
                    options={SCORE_BAND_OPTIONS}
                    formatDisplay={complexityFormatDisplay}
                    displayTitle={`Complexity — ${scoreBandLabel(currentProjectFromHierarchy.complexityScore)} (${currentProjectFromHierarchy.complexityScore}/5)`}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-[11px] text-zinc-500 mb-1">Definition of done</p>
                <InlineEditCell
                  value={currentProjectFromHierarchy.definitionOfDone}
                  onSave={(definitionOfDone) =>
                    void updateProject(currentProjectFromHierarchy.id, {
                      definitionOfDone,
                    }).then(() => router.refresh())
                  }
                  placeholder="Definition of done"
                  displayClassName="text-left text-xs leading-normal text-zinc-500"
                  displayTruncateSingleLine
                  truncateTooltipAlwaysHover
                  truncateSubduedPreview
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 mb-1">Start date</p>
                  <InlineEditCell
                    value={currentProjectFromHierarchy.startDate}
                    onSave={(startDate) =>
                      void updateProject(currentProjectFromHierarchy.id, {
                        startDate,
                      }).then(() => router.refresh())
                    }
                    type="date"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 mb-1">
                    Due date{" "}
                    <span className="font-normal text-zinc-600">
                      (last milestone)
                    </span>
                  </p>
                  <p
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-sm font-medium",
                      currentProjectFromHierarchy.targetDate.trim()
                        ? "border-zinc-700/80 bg-zinc-950/40 text-zinc-100"
                        : "border-amber-500/45 bg-amber-950/30 text-amber-100/90"
                    )}
                    title={
                      currentProjectFromHierarchy.targetDate.trim()
                        ? `${formatCalendarDateHint(
                            currentProjectFromHierarchy.targetDate
                          )} — from last milestone with a date`
                        : "Set a target date on at least one milestone"
                    }
                  >
                    {currentProjectFromHierarchy.targetDate.trim()
                      ? formatRelativeCalendarDate(
                          currentProjectFromHierarchy.targetDate
                        )
                      : "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[11px] text-zinc-500 mb-1">Progress</p>
                <ProgressBar percent={currentProjectFromHierarchy.progress} />
              </div>

              <div className="flex justify-end">
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

              {lowAutonomyProjectOwnerHint ? (
                <div className="rounded-md border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-zinc-300">
                  <span className="font-medium text-amber-200/90">Owner — </span>
                  {lowAutonomyProjectOwnerHint}
                </div>
              ) : null}

              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Milestones
                  </p>
                  {milestoneProgress && milestoneProgress.milestoneCount > 0 ? (
                    <div className="flex min-w-[8rem] max-w-[14rem] flex-1 items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500/60 transition-[width]"
                          style={{
                            width: `${(milestoneProgress.doneCount / milestoneProgress.milestoneCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="shrink-0 tabular-nums text-[10px] text-zinc-500">
                        {milestoneProgress.doneCount}/
                        {milestoneProgress.milestoneCount}
                      </span>
                    </div>
                  ) : null}
                </div>
                {currentProjectFromHierarchy.milestones.length === 0 ? (
                  <div className="py-2">
                    <p className="w-full min-w-0 text-sm text-zinc-500/90 leading-relaxed [text-wrap:pretty]">
                      No milestones yet. Add a milestone to track delivery
                      checkpoints for this project.&nbsp;
                      <button
                        type="button"
                        title="Add a new milestone to this project"
                        onClick={async () => {
                          const ms = await createMilestone({
                            projectId: currentProjectFromHierarchy.id,
                            name: "New milestone",
                            status: "Not Done",
                            targetDate: "",
                          });
                          setMilestoneNameFocusId(ms.id);
                          router.refresh();
                        }}
                        className={TRACKER_INLINE_TEXT_ACTION}
                      >
                        Add milestone
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="-mx-1 space-y-0">
                    {currentProjectFromHierarchy.milestones.map((ms) => {
                      const isNext =
                        nextPendingMilestone != null &&
                        ms.id === nextPendingMilestone.id;
                      const isQueued =
                        ms.status !== "Done" && !isNext;
                      return (
                        <MilestoneRow
                          key={ms.id}
                          milestone={ms}
                          startNameInEditMode={ms.id === milestoneNameFocusId}
                          isNextPendingMilestone={isNext}
                          isQueuedPendingMilestone={isQueued}
                        />
                      );
                    })}
                    <div className="pt-2 pl-3">
                      <button
                        type="button"
                        onClick={async () => {
                          const ms = await createMilestone({
                            projectId: currentProjectFromHierarchy.id,
                            name: "New milestone",
                            status: "Not Done",
                            targetDate: "",
                          });
                          setMilestoneNameFocusId(ms.id);
                          router.refresh();
                        }}
                        className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                      >
                        <Plus className="h-3 w-3" aria-hidden />
                        Add milestone
                      </button>
                    </div>
                  </div>
                )}
                {nextPendingMilestone ? (
                  <p className="mt-3 border-t border-zinc-800/80 pt-3 text-sm text-zinc-400">
                    Next milestone:{" "}
                    {nextPendingMilestoneCompact ? (
                      <span className="mr-1.5 font-mono text-xs font-semibold tabular-nums text-violet-300/90">
                        {nextPendingMilestoneCompact}
                      </span>
                    ) : null}
                    <span className="font-medium text-zinc-200">
                      {nextPendingMilestone.name}
                    </span>
                  </p>
                ) : currentProjectFromHierarchy.milestones.length > 0 ? (
                  <p className="mt-3 border-t border-zinc-800/80 pt-3 text-sm text-emerald-500/80">
                    All milestones done.
                  </p>
                ) : null}
              </div>
                </ReviewEntityColumn>

                <ReviewNotesScrollColumn
                  entryCount={currentProjectFromHierarchy.reviewLog?.length ?? 0}
                >
                  <ReviewLogPanel
                    embedded
                    variant="sidebar"
                    entries={currentProjectFromHierarchy.reviewLog}
                    draft={reviewNoteDraft}
                    onDraftChange={setReviewNoteDraft}
                    onMarkReviewed={onMarkReviewed}
                  />
                </ReviewNotesScrollColumn>
              </div>

              <div className="flex flex-col gap-4 border-t border-zinc-800/80 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <p className="text-xs text-zinc-500">
                  Reviewed{" "}
                  {currentProjectFromHierarchy.lastReviewed.trim()
                    ? formatLastReviewedHint(
                        currentProjectFromHierarchy.lastReviewed
                      )
                    : "never"}
                </p>
                <ExecFlagMenu
                  atRisk={currentProjectFromHierarchy.atRisk}
                  spotlight={currentProjectFromHierarchy.spotlight}
                  entityLabel="Project"
                  onCommit={(flags) => {
                    void updateProject(currentProjectFromHierarchy.id, flags).then(
                      () => router.refresh()
                    );
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
