"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  Company,
  CompanyWithGoals,
  Goal,
  GoalWithProjects,
  Person,
} from "@/lib/types/tracker";
import type { Priority } from "@/lib/types/tracker";
import { PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import {
  SCORE_BAND_OPTIONS,
  parseScoreBand,
  scoreBandLabel,
} from "@/lib/tracker-score-bands";
import { computeGoalConfidence, explainGoalConfidence } from "@/lib/confidenceScore";
import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";
import { formatPriorityOverlayDisplay } from "./PrioritySelectDisplay";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { costOfDelayFormatDisplay } from "./CostOfDelayDisplay";
import { ProjectRow } from "./ProjectRow";
import {
  updateGoal,
  updateMilestone,
  deleteGoal,
  createProject,
  appendGoalReviewNote,
} from "@/server/actions/tracker";
import {
  Calendar,
  ChevronRight,
  ChevronDown,
  Flag,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  Wand2,
  MessageSquare,
  MessageSquareText,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTrackerExpandBulk } from "./tracker-expand-context";
import { WarningsBadge } from "./WarningsBadge";
import { getGoalHeaderWarnings } from "@/lib/tracker-project-warnings";
import type {
  GoalChannelAiContext,
  MilestoneLikelihoodRiskLevel,
  SlackMemberRosterHint,
} from "@/server/actions/slack";
import { SlackChannelPicker } from "./SlackChannelPicker";
import { GoalLikelihoodInline } from "./GoalLikelihoodInline";
import type { GoalLikelihoodInlineOwner } from "./GoalLikelihoodInline";
import {
  GoalSlackPopover,
  type GoalSlackPopoverProjectRow,
  type GoalSlackPopoverUnscoredReason,
} from "./GoalSlackPopover";
import { SlackChannelMessageDialog } from "./SlackChannelMessageDialog";
import {
  requestOpenProjectSlackThread,
  subscribeProjectSlackThreadClosed,
} from "@/lib/openProjectSlackThread";
import { useGoalLikelihoodRollup } from "@/hooks/useGoalLikelihoodRollup";
import { useGoalOneLiner } from "@/hooks/useGoalOneLiner";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { isValidHttpUrl } from "@/lib/httpUrl";

import { CollapsePanel } from "./CollapsePanel";
import { ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX } from "@/lib/tracker-sticky-layout";
import {
  ROADMAP_DATA_COL_CLASS,
  ROADMAP_DELAY_COMPLEXITY_COL_CLASS,
  ROADMAP_ENTITY_TITLE_DISPLAY_CLASS,
  ROADMAP_GOAL_GRID_PADDING_CLASS,
  ROADMAP_GOAL_TITLE_COL_CLASS,
  ROADMAP_GRID_GAP_CLASS,
  ROADMAP_NEXT_MILESTONE_COL_CLASS,
  ROADMAP_OWNER_COL_CLASS,
  ROADMAP_PROJECT_CARD_INDENT_PX,
  ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS,
  ROADMAP_GOAL_SLACK_COL_CLASS,
  ROADMAP_GOAL_OUTER_NEUTRAL_CLASS,
  ROADMAP_GOAL_HEADER_NEUTRAL_HOVER_CLASS,
  ROADMAP_GOAL_HEADER_SURFACE_CLASS,
} from "@/lib/tracker-roadmap-columns";
import {
  goalLatestMilestoneDueDateYmd,
  milestoneForGoalDueDateShortcut,
} from "@/lib/goal-milestone-aggregates";
import { milestoneProgressPercent } from "@/lib/milestone-progress";
import {
  formatCalendarDateHint,
  formatRelativeCalendarDate,
  getProjectDueDateUrgency,
  parseCalendarDateString,
} from "@/lib/relativeCalendarDate";
import { ProgressBar } from "./ProgressBar";
import { TRACKER_EMPTY_HINT_COPY_GOAL_CLASS } from "./tracker-text-actions";
import { AddEntityMenuButton } from "./AddEntityMenuButton";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { AiContextInfoIcon } from "./AiContextInfoIcon";
import { AiUpdateDialog } from "./AiUpdateDialog";
import { ReviewNotesPopover } from "./ReviewNotesPopover";
import { RowActionIcons } from "./RowActionIcons";
import { useAssistantOptional } from "@/contexts/AssistantContext";
import { useCompanySectionOverlayOptional } from "./company-section-overlay-context";

/** Align editable cells with sticky column headers (no default resting inset). */
const GRID_ALIGN = { trackerGridAlign: true as const };

/** Hover panel when the goal has no milestones yet (due column is rollup-only). Same delay/behavior as {@link AutoConfidencePercent}. */
const GOAL_EMPTY_DUE_EXPLAIN =
  "This column shows the latest milestone due date automatically. Add a project and milestones with target dates first.";

const GOAL_EMPTY_DUE_TIP_MAX_W_PX = 320;
const EMPTY_DUE_EXPLAIN_CLOSE_DELAY_MS = 200;

/** Distance from each project tree row wrapper top to the horizontal stub (project bar centerline). */
const GOAL_PROJECT_TREE_STUB_TOP_PX = 18;

interface GoalSectionProps {
  goal: GoalWithProjects;
  people: Person[];
  expandForSearch?: boolean;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
  /** Cumulative sticky offset for the goal header row (toolbar + company + goals labels). */
  roadmapGoalRowStickyTopPx: number;
  /** When this matches `goal.id`, goal title (description) opens in edit mode on mount. */
  focusGoalTitleEditId?: string | null;
  /** First-mount expanded state only (e.g. match siblings when all were collapsed). */
  initialExpanded?: boolean;
  /** Fired when this goal is expanded/collapsed so the company can default new goals consistently. */
  onExpandedChange?: (goalId: string, expanded: boolean) => void;
  /** How this goal sits in the company’s goal list — drives corner radius and separators. */
  stackPosition?: "only" | "first" | "middle" | "last";
  allGoals: Goal[];
  allCompanies: Company[];
  mirrorPickerHierarchy: CompanyWithGoals[];
  showCompletedProjects?: boolean;
}

export function GoalSection({
  goal,
  people,
  expandForSearch = false,
  ownerWorkloadMap,
  roadmapGoalRowStickyTopPx,
  focusGoalTitleEditId = null,
  initialExpanded,
  onExpandedChange,
  stackPosition = "only",
  allGoals,
  allCompanies,
  mirrorPickerHierarchy,
  showCompletedProjects = true,
}: GoalSectionProps) {
  /** Keep AI context icon visible while the AI context panel is open (even if pointer left the row). */
  const [aiContextUiOpen, setAiContextUiOpen] = useState(false);
  /** After adding a project, name cell opens in edit mode so the user can type immediately. */
  const [newProjectNameFocusId, setNewProjectNameFocusId] = useState<
    string | null
  >(null);
  const assistant = useAssistantOptional();
  const [aiUpdateOpen, setAiUpdateOpen] = useState(false);

  /** Increment to focus the goal title field (context menu Rename). */
  const [goalRenameNonce, setGoalRenameNonce] = useState(0);
  const {
    bulkTick,
    expandPreset,
    focusProjectMode,
    focusedGoalId,
    setFocusedGoalId,
    setFocusedProjectId,
    focusEnforceTick,
  } = useTrackerExpandBulk();
  /*
    Derive the first-mount `expanded` value from the restored expand preset,
    focus mode, and any active search/filters so the goal header doesn't flash
    open-then-closed right after hydration (e.g. "Goals only" collapsing
    projects on load, or a shareable URL with filters loading in collapsed).
  */
  const [expanded, setExpanded] = useState(() => {
    if (initialExpanded !== undefined) return initialExpanded;
    if (expandForSearch) return true;
    if (focusProjectMode) return false;
    if (expandPreset === "goals_only" || expandPreset === "collapse") {
      return false;
    }
    return true;
  });
  const goalContext = useContextMenu();
  const goalActionsRef = useRef<HTMLButtonElement>(null);
  const [goalReviewNotesNonce, setGoalReviewNotesNonce] = useState(0);

  /** Pixel height of the goal→project tree spine — ends at the last project’s horizontal stub. */
  const [projectTreeSpineHeightPx, setProjectTreeSpineHeightPx] = useState<
    number | null
  >(null);
  const projectTreeRootRef = useRef<HTMLDivElement>(null);
  const lastProjectTreeRowRef = useRef<HTMLDivElement>(null);

  const emptyDueExplainPanelId = useId();
  const emptyDueExplainBtnRef = useRef<HTMLButtonElement>(null);
  const emptyDueExplainCloseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [emptyDueExplainPanelOpen, setEmptyDueExplainPanelOpen] =
    useState(false);
  const [emptyDueExplainPlacement, setEmptyDueExplainPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const { incrementOverlay, decrementOverlay } =
    useCompanySectionOverlayOptional() ?? {};

  const clearEmptyDueExplainCloseTimer = useCallback(() => {
    if (emptyDueExplainCloseTimerRef.current != null) {
      clearTimeout(emptyDueExplainCloseTimerRef.current);
      emptyDueExplainCloseTimerRef.current = null;
    }
  }, []);

  const refreshEmptyDueExplainPlacement = useCallback(() => {
    const el = emptyDueExplainBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 6;
    const maxW = GOAL_EMPTY_DUE_TIP_MAX_W_PX;
    let left = r.left;
    const top = r.bottom + margin;
    if (left + maxW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - maxW);
    }
    setEmptyDueExplainPlacement({ top, left });
  }, []);

  const openEmptyDueExplainPanel = useCallback(() => {
    clearEmptyDueExplainCloseTimer();
    refreshEmptyDueExplainPlacement();
    setEmptyDueExplainPanelOpen(true);
  }, [clearEmptyDueExplainCloseTimer, refreshEmptyDueExplainPlacement]);

  const scheduleCloseEmptyDueExplain = useCallback(() => {
    clearEmptyDueExplainCloseTimer();
    emptyDueExplainCloseTimerRef.current = setTimeout(() => {
      setEmptyDueExplainPanelOpen(false);
      emptyDueExplainCloseTimerRef.current = null;
    }, EMPTY_DUE_EXPLAIN_CLOSE_DELAY_MS);
  }, [clearEmptyDueExplainCloseTimer]);

  const cancelCloseEmptyDueExplain = useCallback(() => {
    clearEmptyDueExplainCloseTimer();
  }, [clearEmptyDueExplainCloseTimer]);

  useLayoutEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    refreshEmptyDueExplainPlacement();
  }, [emptyDueExplainPanelOpen, refreshEmptyDueExplainPlacement]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    const onScroll = () => setEmptyDueExplainPanelOpen(false);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [emptyDueExplainPanelOpen]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    const onResize = () => refreshEmptyDueExplainPlacement();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [emptyDueExplainPanelOpen, refreshEmptyDueExplainPlacement]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmptyDueExplainPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emptyDueExplainPanelOpen]);

  useEffect(() => {
    if (!emptyDueExplainPanelOpen || !incrementOverlay || !decrementOverlay)
      return;
    incrementOverlay();
    return () => decrementOverlay();
  }, [emptyDueExplainPanelOpen, incrementOverlay, decrementOverlay]);

  const projectTreeLayoutKey = useMemo(
    () => goal.projects.map((p) => p.id).join(","),
    [goal.projects]
  );

  const measureProjectTreeSpine = useCallback(() => {
    const root = projectTreeRootRef.current;
    const last = lastProjectTreeRowRef.current;
    if (!root || !last) {
      setProjectTreeSpineHeightPx(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const stubY = lastRect.top + GOAL_PROJECT_TREE_STUB_TOP_PX;
    const h = stubY - rootRect.top;
    setProjectTreeSpineHeightPx(Math.max(0, Math.round(h)));
  }, [goal.projects.length, projectTreeLayoutKey]);

  useLayoutEffect(() => {
    if (!expanded) {
      setProjectTreeSpineHeightPx(null);
      return;
    }
    measureProjectTreeSpine();
    const root = projectTreeRootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      measureProjectTreeSpine();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [
    bulkTick,
    expanded,
    measureProjectTreeSpine,
    projectTreeLayoutKey,
    showCompletedProjects,
    expandForSearch,
  ]);

  useEffect(() => {
    onExpandedChange?.(goal.id, expanded);
  }, [goal.id, expanded, onExpandedChange]);

  useEffect(() => {
    if (!focusProjectMode || focusEnforceTick === 0) return;
    setExpanded(false);
  }, [focusProjectMode, focusEnforceTick]);

  useEffect(() => {
    if (!focusProjectMode) return;
    if (focusedGoalId !== null && focusedGoalId !== goal.id) {
      setExpanded(false);
    }
  }, [focusProjectMode, focusedGoalId, goal.id]);

  /**
   * When the user closes the in-app Slack thread popover that this goal's
   * popover opened, re-open the Goal popover so they land back where they
   * started. Only reacts to the specific project id we requested.
   */
  useEffect(() => {
    const unsubscribe = subscribeProjectSlackThreadClosed((projectId) => {
      if (pendingReopenForProjectIdRef.current !== projectId) return;
      pendingReopenForProjectIdRef.current = null;
      if (shouldCollapseOnThreadCloseRef.current) {
        shouldCollapseOnThreadCloseRef.current = false;
        setExpanded(false);
      }
      setGoalPopoverOpen(true);
    });
    return unsubscribe;
  }, []);

  const atRiskProjectCount = useMemo(
    () => goal.projects.filter((p) => p.atRisk).length,
    [goal.projects]
  );
  const spotlightProjectCount = useMemo(
    () => goal.projects.filter((p) => p.spotlight).length,
    [goal.projects]
  );

  const collapsedSummary = useMemo(
    () => ({ projectCount: goal.projects.length }),
    [goal.projects.length]
  );

  const companyForSlackPicker = useMemo(
    () => allCompanies.find((c) => c.id === goal.companyId),
    [allCompanies, goal.companyId]
  );

  const goalHeaderWarnings = useMemo(
    () =>
      getGoalHeaderWarnings(goal, people, { includeProjectWarnings: false }),
    [goal, people]
  );

  /** No projects → Confidence / Due date / Progress show a subtle "—" empty-state instead of 0-valued UI. */
  const hasNoProjects = goal.projects.length === 0;
  /** Shared tooltip so hovering any of the three placeholders explains the same reason. */
  const noProjectsColTitle =
    "No projects yet — confidence, due date, and progress will appear once a project is added";
  /** Minimal dashed glyph used across Confidence / Due date / Progress when there are no projects. */
  const noProjectsPlaceholder = (
    <span
      className="inline-flex h-4 items-center text-[10px] font-medium leading-none text-zinc-600 select-none"
      aria-hidden
    >
      —
    </span>
  );

  useEffect(() => {
    if (bulkTick === 0) return;
    queueMicrotask(() => {
      if (
        expandPreset === "goals_and_projects" ||
        expandPreset === "goals_projects_milestones"
      )
        setExpanded(true);
      else if (expandPreset === "goals_only" || expandPreset === "collapse")
        setExpanded(false);
    });
  }, [bulkTick, expandPreset]);

  useEffect(() => {
    if (expandForSearch) setExpanded(true);
  }, [expandForSearch]);

  const toggleGoalExpanded = useCallback(() => {
    if (focusProjectMode) {
      if (!expanded) {
        setFocusedGoalId(goal.id);
        setFocusedProjectId(null);
        setExpanded(true);
        return;
      }
      setExpanded(false);
      setFocusedGoalId((prev) => (prev === goal.id ? null : prev));
      setFocusedProjectId((pid) =>
        pid !== null && goal.projects.some((p) => p.id === pid) ? null : pid
      );
      return;
    }
    setExpanded((v) => !v);
  }, [
    focusProjectMode,
    expanded,
    goal.id,
    goal.projects,
    setFocusedGoalId,
    setFocusedProjectId,
  ]);

  const onGoalHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest(
        "button, a, input, select, textarea"
      );
      if (el) return;
      toggleGoalExpanded();
    },
    [toggleGoalExpanded]
  );

  const priorityOptions = PriorityEnum.options.map((p) => ({
    value: p,
    label: PRIORITY_MENU_LABEL[p],
  }));
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const goalConfidenceAuto = useMemo(
    () => computeGoalConfidence(goal.projects, peopleById),
    [goal.projects, peopleById]
  );
  const goalConfidenceExplain = useMemo(
    () => explainGoalConfidence(goal, peopleById),
    [goal, peopleById]
  );

  const goalMilestonesFlat = useMemo(
    () => goal.projects.flatMap((p) => p.milestones),
    [goal.projects]
  );
  const goalLatestDueYmd = useMemo(
    () => goalLatestMilestoneDueDateYmd(goal),
    [goal]
  );
  const goalDueDateShortcutMilestone = useMemo(
    () => milestoneForGoalDueDateShortcut(goal),
    [goal]
  );
  const goalMilestonesDoneCount = useMemo(
    () => goalMilestonesFlat.filter((m) => m.status === "Done").length,
    [goalMilestonesFlat]
  );
  const goalMilestoneProgressPercent = useMemo(
    () => milestoneProgressPercent(goalMilestonesFlat),
    [goalMilestonesFlat]
  );
  const goalDueUrgency = useMemo(() => {
    const raw = goalLatestDueYmd.trim();
    if (!raw || parseCalendarDateString(raw) === null) return null;
    return getProjectDueDateUrgency(raw);
  }, [goalLatestDueYmd]);

  const ownerPerson = people.find((p) => p.id === goal.ownerId);

  const { rollup: goalLikelihoodRollup, loading: goalLikelihoodLoading } =
    useGoalLikelihoodRollup(goal, people, !expanded);

  const goalOneLinerEnabled =
    !expanded && Boolean(goalLikelihoodRollup?.ready);
  const {
    summaryLine: goalOneLinerSummary,
    loading: goalOneLinerLoading,
    error: goalOneLinerError,
  } = useGoalOneLiner(
    goal.id,
    goal.description,
    goalLikelihoodRollup,
    goalOneLinerEnabled
  );

  /**
   * Rows for the goal popover drill-down — **one per project**, including projects without
   * milestones, completed projects, blocked projects, and projects whose next milestone hasn't
   * been scheduled / linked yet. Unscored rows carry a `reasonCode` + short label so the card
   * explains why there's no on-time estimate instead of silently rendering 0%/0%.
   */
  const goalPopoverProjectRows = useMemo((): GoalSlackPopoverProjectRow[] => {
    const summariesByKey = new Map<
      string,
      (typeof goalLikelihoodRollup extends null ? never : NonNullable<typeof goalLikelihoodRollup>)["projectSummaries"][number]
    >();
    for (const s of goalLikelihoodRollup?.projectSummaries ?? []) {
      summariesByKey.set(`${s.projectName}\u0000${s.milestoneName}`, s);
    }
    const rows: GoalSlackPopoverProjectRow[] = [];
    for (const p of goal.projects) {
      const owner = p.ownerId ? peopleById.get(p.ownerId) : undefined;
      const ownerForRow = owner
        ? {
            name: owner.name,
            profilePicturePath: owner.profilePicturePath ?? "",
          }
        : null;

      const nextPending = getNextPendingMilestone(p.milestones);
      const projectDone = p.status === "Done";
      const projectBlocked = p.status === "Blocked" || p.isBlocked === true;

      /** Blocked is orthogonal to assessment readiness — keep it as a note, not a reason pill. */
      const blockerNote = projectBlocked
        ? p.blockedByProjectName?.trim()
          ? `Blocked by ${p.blockedByProjectName.trim()}`
          : "Blocked"
        : undefined;

      /** Unscored explainer: what's stopping the AI from producing an estimate yet. */
      let reasonCode: GoalSlackPopoverUnscoredReason | undefined;
      let reasonLabel: string | undefined;
      let milestoneName = nextPending?.name ?? "";

      if (projectDone) {
        reasonCode = "completed";
        reasonLabel = "Completed";
        milestoneName = "";
      } else if (p.milestones.length === 0) {
        reasonCode = "noMilestones";
        reasonLabel = "No milestones";
      } else if (!nextPending) {
        reasonCode = "completed";
        reasonLabel = "All milestones complete";
        milestoneName = "";
      } else {
        const target = nextPending.targetDate?.trim() ?? "";
        const hasDate = Boolean(target) && parseCalendarDateString(target) !== null;
        const hasSlack = isValidHttpUrl((nextPending.slackUrl ?? "").trim());

        if (p.status === "Idea") {
          reasonCode = "notStarted";
          reasonLabel = "Idea — not scheduled";
        } else if (p.status === "Pending" && (!hasDate || !hasSlack)) {
          reasonCode = "notStarted";
          reasonLabel = "Not started";
        } else if (!hasDate && !hasSlack) {
          reasonCode = "notStarted";
          reasonLabel = "No target date or thread";
        } else if (!hasDate) {
          reasonCode = "noTargetDate";
          reasonLabel = "No target date";
        } else if (!hasSlack) {
          reasonCode = "noSlackThread";
          reasonLabel = "No Slack thread";
        }
      }

      /** Look up the cached AI assessment only when the milestone is actually assessable. */
      const key =
        reasonCode || !nextPending ? "" : `${p.name}\u0000${nextPending.name}`;
      const summary = key ? summariesByKey.get(key) : undefined;

      if (!reasonCode && !summary) {
        reasonCode = "assessing";
        reasonLabel = "Assessing…";
      }

      const scored = Boolean(summary);
      rows.push({
        projectId: p.id,
        projectName: p.name,
        milestoneName,
        summaryLine: summary?.summaryLine ?? "",
        likelihood: summary?.likelihood ?? 0,
        riskLevel: summary?.riskLevel ?? "medium",
        progressEstimate: summary?.progressEstimate ?? 0,
        slackUrl: (nextPending?.slackUrl ?? "").trim(),
        owner: ownerForRow,
        scored,
        reasonCode: scored ? undefined : reasonCode,
        reasonLabel: scored ? undefined : reasonLabel,
        blockerNote,
      });
    }
    return rows;
  }, [goal.projects, goalLikelihoodRollup, peopleById]);

  /**
   * Distinct project owners under the goal, autonomy desc then name asc (header avatar stack).
   * Enriched with each owner's worst project signal (risk desc, likelihood asc) for a colored ring.
   * Worst signals are only present when `goalLikelihoodRollup.ready` — otherwise rings fall back to neutral.
   */
  const goalProjectOwners = useMemo((): GoalLikelihoodInlineOwner[] => {
    const rollupReady = Boolean(goalLikelihoodRollup?.ready);
    /** Map ownerId → per-project rows (only counts owners that own at least one project with a dated+linked next pending milestone and a cached summary). */
    const projectsByOwnerId = new Map<
      string,
      Array<{ riskLevel: MilestoneLikelihoodRiskLevel; likelihood: number }>
    >();
    if (rollupReady) {
      const projectById = new Map(goal.projects.map((p) => [p.id, p]));
      for (const row of goalPopoverProjectRows) {
        const p = projectById.get(row.projectId);
        const ownerId = p?.ownerId?.trim();
        if (!ownerId) continue;
        /** Only count rows with a real cached assessment — unscored rows would misleadingly color the ring. */
        if (!row.scored) continue;
        const bucket = projectsByOwnerId.get(ownerId);
        const entry = { riskLevel: row.riskLevel, likelihood: row.likelihood };
        if (bucket) bucket.push(entry);
        else projectsByOwnerId.set(ownerId, [entry]);
      }
    }

    const RISK_ORDER: Record<MilestoneLikelihoodRiskLevel, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };

    const seen = new Set<string>();
    const owners: GoalLikelihoodInlineOwner[] = [];
    for (const p of goal.projects) {
      const id = p.ownerId?.trim();
      if (!id || seen.has(id)) continue;
      const person = peopleById.get(id);
      if (!person) continue;
      seen.add(id);

      let worstRisk: MilestoneLikelihoodRiskLevel | undefined;
      let worstLikelihood: number | undefined;
      const entries = projectsByOwnerId.get(id);
      if (entries && entries.length > 0) {
        const best = entries.slice().sort((a, b) => {
          const r = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
          if (r !== 0) return r;
          return a.likelihood - b.likelihood;
        })[0]!;
        worstRisk = best.riskLevel;
        worstLikelihood = best.likelihood;
      }

      owners.push({
        id: person.id,
        name: person.name,
        profilePicturePath: person.profilePicturePath ?? "",
        autonomyScore: person.autonomyScore ?? 0,
        riskLevel: worstRisk,
        worstLikelihood,
      });
    }
    owners.sort((a, b) => {
      if (b.autonomyScore !== a.autonomyScore) {
        return b.autonomyScore - a.autonomyScore;
      }
      return a.name.localeCompare(b.name);
    });
    return owners;
  }, [goal.projects, goalLikelihoodRollup, goalPopoverProjectRows, peopleById]);

  /** Goal-level AI context: rollup + per-project signals + roster for channel-message drafting. */
  const goalChannelAiContext = useMemo((): GoalChannelAiContext => {
    const rosterHints: SlackMemberRosterHint[] = [];
    for (const o of goalProjectOwners) {
      const person = peopleById.get(o.id);
      const slackUserId = person?.slackHandle?.trim() ?? "";
      if (!slackUserId) continue;
      const avatar = o.profilePicturePath.trim();
      rosterHints.push({
        slackUserId,
        name: o.name,
        ...(avatar ? { profilePicturePath: avatar } : {}),
      });
    }

    const projectIdToOwnerName = new Map<string, string>();
    for (const p of goal.projects) {
      if (!p.ownerId?.trim()) continue;
      const person = peopleById.get(p.ownerId);
      if (person) projectIdToOwnerName.set(p.id, person.name);
    }

    return {
      goalDescription: goal.description,
      oneLinerSummary: goalOneLinerSummary ?? "",
      rollup: {
        ready: Boolean(goalLikelihoodRollup?.ready),
        onTimeLikelihood: goalLikelihoodRollup?.onTimeLikelihood ?? 0,
        riskLevel: goalLikelihoodRollup?.riskLevel ?? "medium",
        aiConfidence: goalLikelihoodRollup?.aiConfidence ?? 0,
        coverageCached: goalLikelihoodRollup?.coverage.cached ?? 0,
        coverageTotal: goalLikelihoodRollup?.coverage.total ?? 0,
      },
      projects: goalPopoverProjectRows.map((r) => ({
        projectName: r.projectName,
        milestoneName: r.milestoneName,
        scored: r.scored,
        likelihood: r.likelihood,
        riskLevel: r.riskLevel,
        progressEstimate: r.progressEstimate,
        summaryLine: r.summaryLine,
        blockerNote: r.blockerNote ?? "",
        reasonLabel: r.reasonLabel ?? "",
        ownerName: projectIdToOwnerName.get(r.projectId) ?? "",
      })),
      rosterHints,
    };
  }, [
    goal.description,
    goal.projects,
    goalLikelihoodRollup,
    goalOneLinerSummary,
    goalPopoverProjectRows,
    goalProjectOwners,
    peopleById,
  ]);

  const goalInlineRef = useRef<HTMLButtonElement>(null);
  const goalInlineSpotlightRef = useRef<HTMLDivElement>(null);
  const [goalPopoverOpen, setGoalPopoverOpen] = useState(false);
  const [goalChannelMessageOpen, setGoalChannelMessageOpen] = useState(false);
  const [goalChannelMessageMode, setGoalChannelMessageMode] = useState<
    "ping" | "nudge" | "reply"
  >("reply");
  /**
   * Set to the projectId whose in-app Slack thread window we just opened from
   * the Goal popover. When `ProjectRow` notifies that the thread window was
   * closed, we re-open this goal's popover so the user lands back where they
   * started. Null means no pending return trip.
   */
  const pendingReopenForProjectIdRef = useRef<string | null>(null);
  /**
   * Remembers whether we auto-expanded this goal *just* to mount the target
   * `ProjectRow` so the thread popover could render. Because the popover only
   * mounts inside an expanded goal, we flip `expanded` to true, then flip it
   * back when the thread closes so the user lands back on the inline summary
   * (exactly where they were when they opened the Goal popover).
   */
  const shouldCollapseOnThreadCloseRef = useRef(false);

  const onNewProjectCreated = useCallback((id: string) => {
    setExpanded(true);
    setNewProjectNameFocusId(id);
  }, []);

  const addProjectToGoal = useCallback(async () => {
    const project = await createProject({
      goalId: goal.id,
      mirroredGoalIds: [],
      name: "New project",
      description: "",
      ownerId: "",
      assigneeIds: [],
      type: "Engineering",
      priority: "P2",
      status: "Pending",
      complexityScore: 3,
      definitionOfDone: "",
      startDate: "",
      targetDate: "",
      atRisk: false,
      spotlight: false,
      reviewLog: [],
    });
    onNewProjectCreated(project.id);
  }, [goal.id, onNewProjectCreated]);

  const goalMenuEntries = useMemo((): ContextMenuEntry[] => {
    const execBlock: ContextMenuEntry[] = [];
    if (!goal.atRisk && !goal.spotlight) {
      execBlock.push(
        {
          type: "item",
          id: "exec-at-risk",
          label: "Mark at risk",
          icon: Flag,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: true, spotlight: false }),
        },
        {
          type: "item",
          id: "exec-spotlight",
          label: "Mark spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: true }),
        }
      );
    } else if (goal.atRisk) {
      execBlock.push(
        {
          type: "item",
          id: "exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "exec-to-spotlight",
          label: "Switch to spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: true }),
        }
      );
    } else {
      execBlock.push(
        {
          type: "item",
          id: "exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateGoal(goal.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "exec-to-at-risk",
          label: "Switch to at risk",
          icon: Flag,
          onClick: () =>
            void updateGoal(goal.id, { atRisk: true, spotlight: false }),
        }
      );
    }

    return [
      {
        type: "item",
        id: "add-project",
        label: "Add project",
        icon: Plus,
        onClick: () => void addProjectToGoal(),
      },
      {
        type: "item",
        id: "rename-goal",
        label: "Rename goal",
        icon: Pencil,
        onClick: () => setGoalRenameNonce((n) => n + 1),
      },
      {
        type: "item",
        id: "ai-update-fields",
        label: "Update with AI…",
        icon: Wand2,
        onClick: () => setAiUpdateOpen(true),
      },
      ...(assistant
        ? [
            {
              type: "item" as const,
              id: "discuss-in-chat",
              label: "Discuss in chat",
              icon: MessageSquare,
              onClick: () =>
                assistant.openAssistant({
                  type: "goal",
                  id: goal.id,
                  label: goal.description,
                }),
            },
          ]
        : []),
      {
        type: "item",
        id: "review-notes",
        label: "Review notes…",
        icon: MessageSquareText,
        onClick: () => setGoalReviewNotesNonce((n) => n + 1),
      },
      { type: "divider", id: "goal-d1" },
      ...execBlock,
      { type: "divider", id: "goal-d2" },
      {
        type: "item",
        id: "expand-goal",
        label: expanded ? "Collapse goal" : "Expand goal",
        icon: expanded ? ChevronRight : ChevronDown,
        onClick: () => toggleGoalExpanded(),
      },
      { type: "divider", id: "goal-d3" },
      {
        type: "item",
        id: "delete-goal",
        label: "Delete goal…",
        icon: Trash2,
        destructive: true,
        disabled: goal.projects.length > 0,
        disabledReason: "Delete all projects under this goal first.",
        confirmMessage: `Delete this goal? This can't be undone.`,
        onClick: async () => {
          await deleteGoal(goal.id);
          toast.success(`Goal “${goal.description}” deleted.`);
        },
      },
    ];
  }, [
    addProjectToGoal,
    expanded,
    goal.atRisk,
    goal.description,
    assistant,
    goal.id,
    goal.projects.length,
    goal.spotlight,
    toggleGoalExpanded,
    setGoalRenameNonce,
  ]);

  const goalStickyTopPx =
    roadmapGoalRowStickyTopPx - ROADMAP_STICKY_GOAL_ROW_TOP_NUDGE_PX;

  const headerTopRounded =
    stackPosition === "only" || stackPosition === "first";

  /** Bordered slot after the goal title (project count or empty-state add controls). */
  const goalTitleMetaRuleClass =
    "-translate-y-0.5 ml-1.5 mr-1.5 border-l border-zinc-600/35 pl-2";

  return (
    <div
      className={cn(
        "max-w-full min-w-0 transition-colors duration-150",
        stackPosition === "only" && "mb-2 rounded-md",
        stackPosition === "first" && "rounded-t-md border-b border-zinc-800/45",
        stackPosition === "middle" && "border-b border-zinc-800/45",
        stackPosition === "last" && "mb-2 rounded-b-md",
        goal.atRisk &&
          "border-l-2 border-amber-400 bg-amber-950/45",
        !goal.atRisk &&
          goal.spotlight &&
          "border-l-2 border-emerald-400/85 bg-emerald-950/40",
        !goal.atRisk && !goal.spotlight && ROADMAP_GOAL_OUTER_NEUTRAL_CLASS
      )}
    >
      {/* Goal header — click row (not inline controls) to expand/collapse; AI context via info icon */}
      <div
        style={{ top: goalStickyTopPx }}
        onContextMenuCapture={goalContext.onContextMenuCapture}
        className={cn(
          // Hover lives on this sticky bar (visible when collapsed); outer wrapper hover was covered
          // by opaque bg and also fired over the whole project list when expanded.
          "sticky z-[27] w-full min-w-0 max-w-full transition-colors duration-150 motion-reduce:transition-none",
          expanded
            ? "border-b-0 shadow-none"
            : "border-b border-zinc-800/60 shadow-[0_1px_0_rgba(0,0,0,0.2)]",
          headerTopRounded ? "rounded-t-md" : "rounded-t-none",
          goal.atRisk
            ? "bg-amber-950/85 hover:bg-amber-900/78"
            : goal.spotlight
              ? "bg-emerald-950/80 hover:bg-emerald-900/72"
              : cn(
                  ROADMAP_GOAL_HEADER_SURFACE_CLASS,
                  ROADMAP_GOAL_HEADER_NEUTRAL_HOVER_CLASS
                )
        )}
      >
        <div
          ref={goalInlineSpotlightRef}
          onClick={onGoalHeaderClick}
          className={cn(
            "group/goal flex min-h-[28px] w-full min-w-0 max-w-full cursor-pointer items-center py-1 transition-colors",
            ROADMAP_GRID_GAP_CLASS,
            ROADMAP_GOAL_GRID_PADDING_CLASS
          )}
        >
        <div className="w-8 shrink-0 flex items-center justify-center">
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-300 ease-out pointer-events-none motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        </div>

        {/* Goal title — AI info icon inline after name; collapsed project count nudged up to align with title */}
        <div className={cn(ROADMAP_GOAL_TITLE_COL_CLASS)}>
          <InlineEditCell
            {...GRID_ALIGN}
            value={goal.description}
            onSave={(description) => updateGoal(goal.id, { description })}
            displayClassName={ROADMAP_ENTITY_TITLE_DISPLAY_CLASS}
            startInEditMode={goal.id === focusGoalTitleEditId}
            openEditNonce={goalRenameNonce}
            collapsedSuffix={
              <>
                {!expanded && collapsedSummary.projectCount > 0 && (
                  <span
                    className={cn(
                      goalTitleMetaRuleClass,
                      "inline-block whitespace-nowrap text-[10px] font-medium leading-none text-zinc-500"
                    )}
                    title={`${collapsedSummary.projectCount} project${collapsedSummary.projectCount === 1 ? "" : "s"} — click to expand`}
                  >
                    {collapsedSummary.projectCount} project
                    {collapsedSummary.projectCount === 1 ? "" : "s"}
                  </span>
                )}
                {!expanded && goal.projects.length === 0 && (
                  <div
                    className={cn(
                      goalTitleMetaRuleClass,
                      "inline-flex shrink-0 items-center gap-1",
                      "opacity-0 pointer-events-none",
                      "transition-opacity duration-300 ease-out motion-reduce:transition-none",
                      "motion-reduce:pointer-events-auto motion-reduce:opacity-100",
                      "group-hover/goal:pointer-events-auto group-hover/goal:opacity-100",
                      "group-focus-within/goal:pointer-events-auto group-focus-within/goal:opacity-100",
                      "focus-within:pointer-events-auto focus-within:opacity-100"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AddEntityMenuButton
                      kind="project"
                      goalId={goal.id}
                      label="Add project"
                      buttonTitle="Add a new project to this goal"
                      onManualAdd={() => {
                        void addProjectToGoal();
                      }}
                      onAiCreated={onNewProjectCreated}
                    />
                  </div>
                )}
                <span
                  className={cn(
                    "inline-flex items-center align-middle",
                    "transition-opacity duration-300 ease-out motion-reduce:transition-none",
                    "opacity-0 motion-reduce:opacity-100 group-hover/goal:opacity-100",
                    aiContextUiOpen && "opacity-100",
                    "pointer-events-none motion-reduce:pointer-events-auto group-hover/goal:pointer-events-auto",
                    aiContextUiOpen && "pointer-events-auto"
                  )}
                >
                  <AiContextInfoIcon
                    inline
                    variant="goal"
                    goalId={goal.id}
                    measurableTarget={goal.measurableTarget}
                    whyItMatters={goal.whyItMatters}
                    currentValue={goal.currentValue}
                    onUiOpenChange={setAiContextUiOpen}
                  />
                </span>
              </>
            }
          />
        </div>

        {/* DRI */}
        <div className={ROADMAP_OWNER_COL_CLASS}>
          <OwnerPickerCell
            {...GRID_ALIGN}
            avatarOnly
            people={people}
            value={goal.ownerId}
            onSave={(ownerId) => updateGoal(goal.id, { ownerId })}
            priority={goal.priority}
            workloadMap={ownerWorkloadMap}
            emphasizeUnassigned
            restrictToGoalDriEligible
          />
        </div>

        {/* Priority */}
        <div className={ROADMAP_DATA_COL_CLASS}>
          <InlineEditCell
            {...GRID_ALIGN}
            centerSelectTrigger
            className="group/status"
            overlaySelectQuiet
            value={goal.priority}
            onSave={(priority) => updateGoal(goal.id, { priority: priority as Priority })}
            type="select"
            options={priorityOptions}
            formatDisplay={formatPriorityOverlayDisplay}
            displayTitle={`Priority — ${PRIORITY_MENU_LABEL[goal.priority]}`}
            selectPresentation="always"
          />
        </div>

        {/* Delay cost — aligns above project Complexity */}
        <div className={ROADMAP_DELAY_COMPLEXITY_COL_CLASS}>
          <InlineEditCell
            {...GRID_ALIGN}
            className="group/status"
            overlaySelectQuiet
            value={String(goal.costOfDelay)}
            onSave={(v) =>
              updateGoal(goal.id, { costOfDelay: parseScoreBand(v) })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
            formatDisplay={costOfDelayFormatDisplay}
            displayTitle={`Delay cost — ${scoreBandLabel(goal.costOfDelay)} (${goal.costOfDelay}/5)`}
          />
        </div>

        {/* Confidence — auto: plain average of child project scores; left-aligned with project row. */}
        <div
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            "flex items-center justify-start pl-0.5",
          )}
          title={hasNoProjects ? noProjectsColTitle : undefined}
        >
          {hasNoProjects ? (
            noProjectsPlaceholder
          ) : (
            <AutoConfidencePercent
              score={goalConfidenceAuto}
              explanation={goalConfidenceExplain}
            />
          )}
        </div>

        {/* Due date — latest milestone target date across all projects in this goal */}
        <div
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            (hasNoProjects || !goalLatestDueYmd.trim()) &&
              "flex items-center justify-start pl-2"
          )}
          title={
            hasNoProjects
              ? noProjectsColTitle
              : goalLatestDueYmd.trim()
              ? [
                  formatCalendarDateHint(goalLatestDueYmd),
                  " — latest milestone due date in this goal",
                  goalDueUrgency === "past"
                    ? " — overdue"
                    : goalDueUrgency === "within24h"
                      ? " — due within 24 hours"
                      : goalDueUrgency === "within48h"
                        ? " — due within 48 hours"
                        : "",
                ].join("")
              : "Set a target date on at least one milestone under this goal’s projects"
          }
        >
          {hasNoProjects ? (
            noProjectsPlaceholder
          ) : goalLatestDueYmd.trim() ? (
            <span
              className={cn(
                "block truncate px-1 py-0.5 text-xs font-medium leading-tight",
                goalDueUrgency === "past"
                  ? "rounded border border-rose-500/40 bg-rose-950/35 text-rose-200 ring-1 ring-rose-500/25"
                  : goalDueUrgency === "within24h"
                    ? "rounded border border-orange-500/40 bg-orange-950/35 text-orange-200 ring-1 ring-orange-500/30"
                    : goalDueUrgency === "within48h"
                      ? "rounded border border-yellow-500/35 bg-yellow-950/25 text-yellow-200 ring-1 ring-yellow-500/25"
                      : "text-zinc-200"
              )}
            >
              {formatRelativeCalendarDate(goalLatestDueYmd, new Date(), {
                omitFuturePreposition: true,
              })}
            </span>
          ) : goalDueDateShortcutMilestone ? (
            <InlineEditCell
              {...GRID_ALIGN}
              key={goalDueDateShortcutMilestone.id}
              type="date"
              value={goalDueDateShortcutMilestone.targetDate}
              onSave={(targetDate) =>
                void updateMilestone(goalDueDateShortcutMilestone.id, {
                  targetDate,
                })
              }
              displayTitle="Set milestone due date (goal column shows the latest date in this goal)"
            />
          ) : (
            <button
              ref={emptyDueExplainBtnRef}
              type="button"
              aria-expanded={emptyDueExplainPanelOpen}
              aria-describedby={
                emptyDueExplainPanelOpen ? emptyDueExplainPanelId : undefined
              }
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={openEmptyDueExplainPanel}
              onMouseLeave={scheduleCloseEmptyDueExplain}
              onFocus={openEmptyDueExplainPanel}
              onBlur={scheduleCloseEmptyDueExplain}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800/55 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/45"
              aria-label="No milestone due date yet — add projects and milestones with target dates; latest shows here automatically"
            >
              <Calendar
                className="h-3.5 w-3.5 shrink-0 text-zinc-500/75"
                strokeWidth={1.5}
                aria-hidden
              />
            </button>
          )}
        </div>

        {/* Progress — all milestones in this goal */}
        <div
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            hasNoProjects && "flex items-center justify-start pl-2"
          )}
          title={hasNoProjects ? noProjectsColTitle : undefined}
        >
          {hasNoProjects ? (
            noProjectsPlaceholder
          ) : (
            <ProgressBar
              percent={goalMilestoneProgressPercent}
              label={`${goalMilestonesDoneCount}/${goalMilestonesFlat.length}`}
              title={`${goalMilestonesDoneCount} of ${goalMilestonesFlat.length} milestones complete in this goal (${goalMilestoneProgressPercent}%)`}
            />
          )}
        </div>

        {/* Slack channel name (always visible; column header shows Slack mark) — after Progress */}
        <div className={ROADMAP_GOAL_SLACK_COL_CLASS}>
          <SlackChannelPicker
            channelName={goal.slackChannel}
            channelId={goal.slackChannelId ?? ""}
            onSave={({ name, id }) =>
              updateGoal(goal.id, { slackChannel: name, slackChannelId: id })
            }
            companyName={companyForSlackPicker?.name}
            companyShortName={companyForSlackPicker?.shortName}
            trackerGridAlign
            variant="plain"
          />
        </div>

        <div
          className={cn(
            ROADMAP_NEXT_MILESTONE_COL_CLASS,
            "overflow-hidden",
            /*
              Collapsed goal with a rollup: let the Next-milestone column grow into the
              flex-1 spacer so the one-line summary has room to read well on wider viewports
              instead of truncating inside the fixed 36rem slot. `!w-auto` + `!grow` overrides
              `w-[36rem]` / `grow-0` from {@link ROADMAP_NEXT_MILESTONE_COL_CLASS}. Cap minimum
              with `min(100%,36rem)` so a narrow roadmap shell cannot be forced wider than its
              parent (plain `min-w-[36rem]` blew out the whole goal row on smaller viewports).
            */
            !expanded && goalLikelihoodRollup != null &&
              "!w-auto !grow min-w-[min(100%,36rem)]"
          )}
          aria-hidden={expanded || goalLikelihoodRollup == null}
        >
          {!expanded && goalLikelihoodRollup != null ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex w-full min-w-0 max-w-full pr-1"
            >
              <GoalLikelihoodInline
                ref={goalInlineRef}
                metricsReady={goalLikelihoodRollup.ready}
                onTimeLikelihood={goalLikelihoodRollup.onTimeLikelihood}
                riskLevel={goalLikelihoodRollup.riskLevel}
                aiConfidence={goalLikelihoodRollup.aiConfidence}
                metricsLoading={goalLikelihoodLoading}
                summaryLine={goalOneLinerSummary}
                summaryLoading={goalOneLinerLoading}
                summaryError={goalOneLinerError}
                owners={goalProjectOwners}
                goalDescription={goal.description}
                freshness={goalLikelihoodRollup.freshness}
                threadCoverage={{
                  considered:
                    goalLikelihoodRollup.freshness?.threadsConsidered ?? 0,
                  total: goalLikelihoodRollup.threadSlackUrls.length,
                }}
                onOpen={() => setGoalPopoverOpen(true)}
              />
            </div>
          ) : null}
        </div>

        <div className="min-w-2 flex-1" aria-hidden={true} />

        {/* At risk / Spotlight + project counts (collapsed) + warnings — right cluster */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 flex-wrap">
          {goal.atRisk && (
            <span
              className="whitespace-nowrap rounded-md border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/95"
              title="Marked at risk"
            >
              At risk
            </span>
          )}
          {goal.spotlight && (
            <span
              className="whitespace-nowrap rounded-md border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95"
              title="Spotlight — win or momentum"
            >
              Spotlight
            </span>
          )}
          {!expanded && atRiskProjectCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200/95"
              title={`${atRiskProjectCount} project${
                atRiskProjectCount === 1 ? "" : "s"
              } at risk — expand to view`}
            >
              <Flag className="h-3 w-3 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">
                {atRiskProjectCount} at risk
              </span>
            </span>
          )}
          {!expanded && spotlightProjectCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200/95"
              title={`${spotlightProjectCount} project${
                spotlightProjectCount === 1 ? "" : "s"
              } in spotlight — expand to view`}
            >
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">
                {spotlightProjectCount} spotlight
              </span>
            </span>
          )}
          {goalHeaderWarnings.length > 0 ? (
            <WarningsBadge warnings={goalHeaderWarnings} />
          ) : null}
        </div>

        <RowActionIcons rowGroup="goal" forceVisible={goal.atRisk || goal.spotlight}>
          <button
            ref={goalActionsRef}
            type="button"
            title="Goal actions"
            aria-label={`More actions for goal ${goal.description}`}
            aria-haspopup="menu"
            aria-expanded={goalContext.open}
            onClick={goalContext.openFromTrigger}
            className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        </RowActionIcons>
        </div>
      </div>
      <ContextMenu
        open={goalContext.open}
        x={goalContext.x}
        y={goalContext.y}
        onClose={goalContext.close}
        scope="goal"
        ariaLabel={`Actions for goal ${goal.description}`}
        entries={goalMenuEntries}
      />
      <ReviewNotesPopover
        anchorRef={goalActionsRef}
        openNonce={goalReviewNotesNonce}
        entries={goal.reviewLog}
        onAppendNote={(t) => appendGoalReviewNote(goal.id, t)}
      />
      <GoalSlackPopover
        open={goalPopoverOpen}
        onClose={() => setGoalPopoverOpen(false)}
        anchorRef={goalInlineRef}
        spotlightRef={goalInlineSpotlightRef}
        goalDescription={goal.description}
        goalSlackChannelName={goal.slackChannel ?? ""}
        goalSlackChannelId={goal.slackChannelId ?? ""}
        rollup={goalLikelihoodRollup}
        rollupLoading={goalLikelihoodLoading}
        oneLinerSummary={goalOneLinerSummary}
        oneLinerLoading={goalOneLinerLoading}
        oneLinerError={goalOneLinerError}
        projectRows={goalPopoverProjectRows}
        owners={goalProjectOwners}
        onOpenChannelMessage={(mode) => {
          setGoalChannelMessageMode(mode);
          setGoalChannelMessageOpen(true);
        }}
        onOpenProjectSlackThread={(projectId) => {
          if (goal.projects.some((p) => p.id === projectId)) {
            if (!expanded) {
              setExpanded(true);
              shouldCollapseOnThreadCloseRef.current = true;
            }
            pendingReopenForProjectIdRef.current = projectId;
          }
          requestOpenProjectSlackThread(projectId);
        }}
      />
      <SlackChannelMessageDialog
        open={goalChannelMessageOpen}
        onClose={(reason) => {
          setGoalChannelMessageOpen(false);
          if (reason === "dismiss") setGoalPopoverOpen(true);
        }}
        goalId={goal.id}
        goalDescription={goal.description}
        channelId={goal.slackChannelId ?? ""}
        channelName={goal.slackChannel ?? ""}
        people={people}
        spotlightRef={goalInlineSpotlightRef}
        mode={goalChannelMessageMode}
        goalContext={goalChannelAiContext}
      />

      {/* Projects */}
      <CollapsePanel
        open={expanded}
        transitionClassName="duration-[300ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150"
        innerClassName={cn(
          "transition-opacity duration-[280ms] ease-out motion-reduce:transition-none motion-reduce:opacity-100",
          expanded ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="group/project-area">
          {/* Tree: spine at x=32px; stubs at x=33px; project cards from x=56px — same for real projects and empty placeholder. */}
          <div className="pb-3">
            <div ref={projectTreeRootRef} className="relative pt-3">
              <div
                aria-hidden
                className="pointer-events-none absolute left-[32px] top-0 w-px bg-zinc-700/55"
                style={
                  projectTreeSpineHeightPx != null
                    ? { height: projectTreeSpineHeightPx }
                    : undefined
                }
              />
              <div className="relative flex flex-col gap-3">
                {goal.projects.length > 0
                  ? goal.projects.map((project, idx) => (
                      <div
                        key={project.id}
                        ref={
                          idx === goal.projects.length - 1
                            ? lastProjectTreeRowRef
                            : undefined
                        }
                        className="relative"
                      >
                        <div
                          aria-hidden
                          className="pointer-events-none absolute left-[33px] h-px w-[23px] bg-zinc-700/55"
                          style={{ top: GOAL_PROJECT_TREE_STUB_TOP_PX }}
                        />
                        <div
                          style={{ marginLeft: ROADMAP_PROJECT_CARD_INDENT_PX }}
                        >
                          <ProjectRow
                            goalId={goal.id}
                            project={project}
                            people={people}
                            expandForSearch={expandForSearch}
                            goalCostOfDelay={goal.costOfDelay}
                            ownerWorkloadMap={ownerWorkloadMap}
                            focusProjectNameEditId={newProjectNameFocusId}
                            allGoals={allGoals}
                            allCompanies={allCompanies}
                            mirrorPickerHierarchy={mirrorPickerHierarchy}
                            showCompletedProjects={showCompletedProjects}
                            goalSlackChannelId={goal.slackChannelId ?? ""}
                            goalSlackChannelName={goal.slackChannel ?? ""}
                          />
                        </div>
                      </div>
                    ))
                  : (
                      <div ref={lastProjectTreeRowRef} className="relative">
                        <div
                          aria-hidden
                          className="pointer-events-none absolute left-[33px] h-px w-[23px] bg-zinc-700/55"
                          style={{ top: GOAL_PROJECT_TREE_STUB_TOP_PX }}
                        />
                        <div
                          style={{ marginLeft: ROADMAP_PROJECT_CARD_INDENT_PX }}
                        >
                          <div className={ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-900 bg-zinc-950/55 px-3 py-2">
                              <AddEntityMenuButton
                                kind="project"
                                goalId={goal.id}
                                label="Add project"
                                buttonTitle="Add a new project to this goal"
                                onManualAdd={() => {
                                  void addProjectToGoal();
                                }}
                                onAiCreated={onNewProjectCreated}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
              </div>
            </div>
            {goal.projects.length > 0 ? (
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pr-3 pt-0.5"
                style={{ paddingLeft: ROADMAP_PROJECT_CARD_INDENT_PX }}
              >
                <AddEntityMenuButton
                  kind="project"
                  goalId={goal.id}
                  label="Add project"
                  buttonTitle="Add another project to this goal"
                  onManualAdd={() => {
                    void addProjectToGoal();
                  }}
                  onAiCreated={onNewProjectCreated}
                />
              </div>
            ) : null}
          </div>
        </div>
      </CollapsePanel>

      {aiUpdateOpen && (
        <AiUpdateDialog
          type="goal"
          goalId={goal.id}
          description={goal.description}
          priority={goal.priority}
          measurableTarget={goal.measurableTarget}
          whyItMatters={goal.whyItMatters}
          currentValue={goal.currentValue}
          onClose={() => setAiUpdateOpen(false)}
        />
      )}

      {emptyDueExplainPanelOpen &&
        emptyDueExplainPlacement &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={emptyDueExplainPanelId}
            role="tooltip"
            className="pointer-events-auto fixed z-[200] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-zinc-600/90 bg-zinc-900 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300 shadow-xl"
            style={{
              top: emptyDueExplainPlacement.top,
              left: emptyDueExplainPlacement.left,
            }}
            onMouseEnter={cancelCloseEmptyDueExplain}
            onMouseLeave={scheduleCloseEmptyDueExplain}
          >
            {GOAL_EMPTY_DUE_EXPLAIN}
          </div>,
          document.body
        )}
    </div>
  );
}
