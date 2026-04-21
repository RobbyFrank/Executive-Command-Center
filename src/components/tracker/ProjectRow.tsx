"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ProjectWithMilestones,
  Person,
  ProjectStatus,
  Priority,
  Goal,
  Company,
  CompanyWithGoals,
  Milestone,
} from "@/lib/types/tracker";
import { PriorityEnum } from "@/lib/schemas/tracker";
import { InlineEditCell } from "./InlineEditCell";
import { OwnerPickerCell } from "./OwnerPickerCell";
import { ProgressBar } from "./ProgressBar";
import {
  SCORE_BAND_OPTIONS,
  parseScoreBand,
  scoreBandLabel,
} from "@/lib/tracker-score-bands";
import { complexityFormatDisplay } from "./ComplexityBandDisplay";
import {
  computeProjectConfidenceFromProject,
  explainProjectConfidence,
} from "@/lib/confidenceScore";
import { PRIORITY_MENU_LABEL } from "@/lib/prioritySort";
import { formatPriorityOverlayDisplay } from "./PrioritySelectDisplay";
import { AutoConfidencePercent } from "./AutoConfidencePercent";
import { MilestoneRow } from "./MilestoneRow";
import {
  updateProject,
  deleteProject,
  createMilestone,
  appendProjectReviewNote,
  unmirrorProjectFromGoal,
} from "@/server/actions/tracker";
import {
  Calendar,
  ChevronRight,
  ChevronDown,
  Flag,
  Plus,
  Sparkles,
  Trash2,
  Pencil,
  ArrowRightLeft,
  Ban,
  Wand2,
  MessageSquare,
  MessageSquareText,
  MoreHorizontal,
  MoveRight,
} from "lucide-react";
import { SlackCreateThreadDialog } from "./SlackCreateThreadDialog";
import { StartSlackThreadChip } from "./StartSlackThreadChip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { useTrackerExpandBulk } from "./tracker-expand-context";
import { CollapsePanel } from "./CollapsePanel";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { projectMatchesCloseWatch } from "@/lib/closeWatch";
import {
  AUTONOMY_GROUP_LABEL,
  clampAutonomy,
  isFounderPerson,
} from "@/lib/autonomyRoster";
import { getTrackerProjectWarnings } from "@/lib/tracker-project-warnings";
import { WarningsBadge } from "./WarningsBadge";
import { SharedBadge } from "./SharedBadge";
import { BlockedByProjectHover } from "./BlockedByProjectHover";
import { MirrorGoalPickerDialog } from "./MirrorGoalPickerDialog";
import { MoveProjectGoalPickerDialog } from "./MoveProjectGoalPickerDialog";
import { BlockedByPickerDialog } from "./BlockedByPickerDialog";
import {
  calendarDateTodayLocal,
  formatCalendarDateHint,
  formatRelativeCalendarDate,
  formatRelativeCalendarDateCompact,
  getProjectDueDateUrgency,
  parseCalendarDateString,
} from "@/lib/relativeCalendarDate";
import { PROJECT_STATUS_SELECT_OPTIONS_EDITABLE } from "@/lib/projectStatus";
import { ProjectStatusPill } from "./ProjectStatusPill";
import { ProjectStatusIconButton } from "./ProjectStatusIconButton";
import {
  TRACKER_ADD_ROW_ACTION_BUTTON_CLASS,
  TRACKER_EMPTY_HINT_COPY_GOAL_CLASS,
  TRACKER_INLINE_TEXT_ACTION,
} from "./tracker-text-actions";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { AiContextInfoIcon } from "./AiContextInfoIcon";
import { AiUpdateDialog } from "./AiUpdateDialog";
import { ReviewNotesPopover } from "./ReviewNotesPopover";
import { RowActionIcons } from "./RowActionIcons";
import { useAssistantOptional } from "@/contexts/AssistantContext";
import { useSlackThreadStatus } from "@/hooks/useSlackThreadStatus";
import { useMilestoneLikelihood } from "@/hooks/useMilestoneLikelihood";
import { useAutoCompleteMilestoneAt100 } from "@/hooks/useAutoCompleteMilestoneAt100";
import { MilestoneSlackThreadInline } from "./MilestoneSlackThreadInline";
import {
  consumePendingOpenProjectSlackThread,
  notifyProjectSlackThreadClosed,
  subscribeOpenProjectSlackThread,
} from "@/lib/openProjectSlackThread";
import {
  SlackMilestoneThreadPopovers,
  type SlackPingMode,
} from "./SlackMilestoneThreadPopovers";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { isPilotProject } from "@/lib/onboarding";
import {
  ROADMAP_DATA_COL_CLASS,
  ROADMAP_DELAY_COMPLEXITY_COL_CLASS,
  ROADMAP_ENTITY_TITLE_DISPLAY_CLASS,
  ROADMAP_GRID_GAP_CLASS,
  ROADMAP_MILESTONE_LIST_SHELF_CLASS,
  ROADMAP_MILESTONE_GRID_PADDING_CLASS,
  ROADMAP_NEXT_MILESTONE_COL_CLASS,
  ROADMAP_OWNER_COL_CLASS,
  ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS,
  ROADMAP_PROJECT_INNER_ROW_NEUTRAL_CLASS,
  ROADMAP_PROJECT_GRID_PADDING_CLASS,
  ROADMAP_PROJECT_TITLE_COL_CLASS,
} from "@/lib/tracker-roadmap-columns";

/** Align editable cells with sticky column headers (no default resting inset). */
const GRID_ALIGN = { trackerGridAlign: true as const };

interface ProjectRowProps {
  /** Parent goal id — used in single-project expansion mode */
  goalId: string;
  project: ProjectWithMilestones;
  people: Person[];
  expandForSearch?: boolean;
  /** Parent goal's cost-of-delay score (1–5) for autonomy risk warnings. */
  goalCostOfDelay?: number;
  ownerWorkloadMap?: Map<string, { total: number; p0: number; p1: number }>;
  /** When this matches `project.id`, project name opens in edit mode on mount. */
  focusProjectNameEditId?: string | null;
  /** Full goal list for shared/mirror labels (roadmap-wide). */
  allGoals: Goal[];
  allCompanies: Company[];
  /** Full hierarchy for “Mirror to goal…” picker (unfiltered). */
  mirrorPickerHierarchy: CompanyWithGoals[];
  /** Roadmap toolbar — when false, Done milestones are not listed (matches Show completed). */
  showCompletedProjects?: boolean;
  /** Parent goal Slack channel — milestones can create threads here. */
  goalSlackChannelId?: string;
  goalSlackChannelName?: string;
}

export function ProjectRow({
  goalId,
  project,
  people,
  expandForSearch = false,
  goalCostOfDelay,
  ownerWorkloadMap,
  focusProjectNameEditId = null,
  allGoals,
  allCompanies,
  mirrorPickerHierarchy,
  showCompletedProjects = true,
  goalSlackChannelId = "",
  goalSlackChannelName = "",
}: ProjectRowProps) {
  const {
    bulkTick,
    expandPreset,
    focusProjectMode,
    setFocusedGoalId,
    focusedProjectId,
    setFocusedProjectId,
    focusEnforceTick,
  } = useTrackerExpandBulk();
  /*
    Derive the first-mount expanded/showMilestones values from the restored
    expand preset (and any active search/filters) so project rows don't briefly
    show collapsed-then-expanded (or vice versa) right after the roadmap
    toolbar prefs hydrate.
  */
  const [expanded, setExpanded] = useState(() => {
    if (expandForSearch) return true;
    if (focusProjectMode) return false;
    return (
      expandPreset === "goals_and_projects" ||
      expandPreset === "goals_projects_milestones"
    );
  });
  /** Keep AI context icon visible while the AI context panel is open (even if pointer left the row). */
  const [aiContextUiOpen, setAiContextUiOpen] = useState(false);
  const [mirrorPickerOpen, setMirrorPickerOpen] = useState(false);
  const [moveGoalPickerOpen, setMoveGoalPickerOpen] = useState(false);
  const [blockedByPickerOpen, setBlockedByPickerOpen] = useState(false);
  /** When expanded, whether milestone rows (and add-milestone) are shown */
  const [showMilestones, setShowMilestones] = useState(() => {
    if (expandForSearch) return true;
    return expandPreset !== "goals_only" && expandPreset !== "collapse";
  });
  const [futureMilestonesOpen, setFutureMilestonesOpen] = useState(false);
  /** After adding a milestone, name cell opens in edit mode so the user can type immediately. */
  const [newMilestoneNameFocusId, setNewMilestoneNameFocusId] = useState<
    string | null
  >(null);
  /** Increment to focus the project name field (context menu Rename). */
  const [projectRenameNonce, setProjectRenameNonce] = useState(0);
  const assistant = useAssistantOptional();
  const [aiUpdateOpen, setAiUpdateOpen] = useState(false);
  const projectContext = useContextMenu();
  const nextMsSlackConnectMenu = useContextMenu();
  const projectActionsRef = useRef<HTMLButtonElement>(null);
  const statusCellRef = useRef<HTMLDivElement>(null);
  const nextMilestoneSlackAnchorRef = useRef<HTMLButtonElement>(null);
  /** Slack thread spotlight: full project header row (not just the Slack strip). */
  const nextMilestoneSlackSpotlightRef = useRef<HTMLDivElement>(null);
  const [projectReviewNotesNonce, setProjectReviewNotesNonce] = useState(0);
  const [nextMsThreadPopoverOpen, setNextMsThreadPopoverOpen] = useState(false);
  const [nextMsThreadPingOpen, setNextMsThreadPingOpen] = useState(false);
  const [nextMsPingMode, setNextMsPingMode] = useState<SlackPingMode>("ping");
  const [nextMilestoneCreateThreadOpen, setNextMilestoneCreateThreadOpen] =
    useState(false);
  const [nextMilestoneSlackUrlEditSignal, setNextMilestoneSlackUrlEditSignal] =
    useState(0);

  const goalDescription = useMemo(() => {
    const g = allGoals.find((x) => x.id === goalId);
    return g?.description?.trim() ?? "";
  }, [allGoals, goalId]);

  const todayYmd = useMemo(() => calendarDateTodayLocal(), []);
  const showNewHirePilotBadge = isPilotProject(project, people, todayYmd);

  /** Company of the project's primary goal — move picker lists other goals here only. */
  const projectCompanyId = useMemo(() => {
    return allGoals.find((g) => g.id === project.goalId)?.companyId;
  }, [allGoals, project.goalId]);

  const canMoveToAnotherGoal = useMemo(() => {
    if (!projectCompanyId) return false;
    return allGoals.some(
      (g) => g.companyId === projectCompanyId && g.id !== project.goalId
    );
  }, [allGoals, project.goalId, projectCompanyId]);

  useEffect(() => {
    if (!focusProjectMode || focusEnforceTick === 0) return;
    setExpanded(false);
    setShowMilestones(false);
  }, [focusProjectMode, focusEnforceTick]);

  useEffect(() => {
    if (!focusProjectMode) return;
    if (focusedProjectId !== null && focusedProjectId !== project.id) {
      setExpanded(false);
      setShowMilestones(false);
    }
  }, [focusProjectMode, focusedProjectId, project.id]);

  useEffect(() => {
    if (bulkTick === 0) return;
    queueMicrotask(() => {
      switch (expandPreset) {
        case "goals_only":
          setExpanded(false);
          setShowMilestones(false);
          break;
        case "goals_and_projects":
          setExpanded(true);
          setShowMilestones(false);
          break;
        case "goals_projects_milestones":
          setExpanded(true);
          setShowMilestones(true);
          break;
        case "collapse":
          setExpanded(false);
          setShowMilestones(false);
          break;
        default:
          break;
      }
    });
  }, [bulkTick, expandPreset]);

  useEffect(() => {
    if (expandForSearch) {
      setExpanded(true);
      setShowMilestones(true);
    }
  }, [expandForSearch]);

  /**
   * Tracks whether the current Slack-thread popover session was triggered
   * externally (Goal popover). When true, we emit a "closed" event on dismiss
   * so the Goal popover can re-open itself — but only for that session, so
   * in-roadmap clicks on `MilestoneSlackThreadInline` don't cause side effects.
   */
  const nextMsThreadOpenedExternallyRef = useRef(false);

  /**
   * External requests (e.g. from the Goal popover's clickable project cards)
   * to open this project's next-milestone Slack thread popover. On a live
   * subscription hit we open immediately; on mount we also claim any pending
   * request so a request fired just before the goal expanded still resolves.
   */
  useEffect(() => {
    const openExternally = () => {
      nextMsThreadOpenedExternallyRef.current = true;
      setExpanded(true);
      setNextMsThreadPopoverOpen(true);
    };
    if (consumePendingOpenProjectSlackThread(project.id)) {
      openExternally();
    }
    const unsubscribe = subscribeOpenProjectSlackThread((pid) => {
      if (pid !== project.id) return;
      openExternally();
    });
    return unsubscribe;
  }, [project.id]);

  /**
   * Wraps `setNextMsThreadPopoverOpen` so every close path (X button, ESC,
   * outside-click on the spotlight backdrop) fires the "thread closed" signal
   * when the session was externally-triggered. We notify synchronously inside
   * the state setter so the Goal popover re-opens in the same React commit as
   * the thread popover tear-down — no stuck frames with everything unmounted.
   *
   * Reply/Ask/Nudge shortcuts in the thread popover call `onClose` before
   * opening a ping dialog — we must NOT notify in that case, or the Goal
   * popover would reopen underneath the ping dialog. Those callers open the
   * ping dialog immediately after `onClose`, so we defer to the next tick and
   * bail out if `pingOpen` flipped true in the meantime.
   */
  const handleNextMsThreadPopoverOpenChange = useCallback(
    (next: boolean) => {
      setNextMsThreadPopoverOpen(next);
      if (next || !nextMsThreadOpenedExternallyRef.current) return;
      const projectId = project.id;
      setTimeout(() => {
        if (nextMsThreadPingOpenRef.current) return;
        if (!nextMsThreadOpenedExternallyRef.current) return;
        nextMsThreadOpenedExternallyRef.current = false;
        notifyProjectSlackThreadClosed(projectId);
      }, 0);
    },
    [project.id]
  );

  /** Mirrors `nextMsThreadPingOpen` for deferred notify callbacks (stale closures). */
  const nextMsThreadPingOpenRef = useRef(nextMsThreadPingOpen);
  useEffect(() => {
    nextMsThreadPingOpenRef.current = nextMsThreadPingOpen;
  }, [nextMsThreadPingOpen]);

  const toggleProjectRow = useCallback(() => {
    if (focusProjectMode) {
      if (!expanded) {
        setFocusedGoalId(goalId);
        setFocusedProjectId(project.id);
        setExpanded(true);
        setShowMilestones(true);
        return;
      }
      if (!showMilestones) {
        setShowMilestones(true);
        return;
      }
      setExpanded(false);
      setShowMilestones(false);
      setFocusedProjectId((prev) => (prev === project.id ? null : prev));
      return;
    }
    if (!expanded) {
      setExpanded(true);
      setShowMilestones(true);
      return;
    }
    if (!showMilestones) {
      setShowMilestones(true);
      return;
    }
    setExpanded(false);
    setShowMilestones(false);
  }, [
    expanded,
    showMilestones,
    focusProjectMode,
    goalId,
    project.id,
    setFocusedGoalId,
    setFocusedProjectId,
  ]);

  const onProjectRowClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest(
        "button, a, input, select, textarea"
      );
      if (el) return;
      toggleProjectRow();
    },
    [toggleProjectRow]
  );

  const priorityOptions = PriorityEnum.options.map((p) => ({
    value: p,
    label: PRIORITY_MENU_LABEL[p],
  }));
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const projectConfidenceAuto = useMemo(
    () => computeProjectConfidenceFromProject(project, peopleById),
    [project, peopleById]
  );
  const projectConfidenceExplain = useMemo(
    () => explainProjectConfidence(project, peopleById),
    [project, peopleById]
  );
  const ownerPerson = people.find((p) => p.id === project.ownerId);

  const nextPendingMilestone = useMemo(
    () => getNextPendingMilestone(project.milestones),
    [project.milestones]
  );

  /** Matches the server-side `milestoneProgressPercent` definition: a milestone counts as done iff `status === "Done"`. */
  const milestonesDoneCount = useMemo(
    () => project.milestones.filter((m) => m.status === "Done").length,
    [project.milestones]
  );

  const milestonesSummaryForLikelihood = useMemo(
    () =>
      project.milestones
        .map(
          (m) =>
            `- ${m.name} [${m.status}]${m.targetDate ? ` ${m.targetDate}` : ""}`
        )
        .join("\n"),
    [project.milestones]
  );

  const roadmapForNextMilestoneAi = useMemo(
    () =>
      `Project: ${project.name}\n\nMilestones:\n${milestonesSummaryForLikelihood}`,
    [project.name, milestonesSummaryForLikelihood]
  );

  const milestonesForRunway = useMemo(() => {
    if (showCompletedProjects) return project.milestones;
    return project.milestones.filter((m) => m.status !== "Done");
  }, [project.milestones, showCompletedProjects]);

  const milestoneRunway = useMemo(() => {
    const all = milestonesForRunway;
    const firstPendingIdx = all.findIndex((m) => m.status !== "Done");
    if (firstPendingIdx === -1) {
      return {
        completedBeforeRunway: all,
        coreMilestones: [] as Milestone[],
        futureMilestones: [] as Milestone[],
      };
    }
    return {
      completedBeforeRunway: all.slice(0, firstPendingIdx),
      coreMilestones: all.slice(firstPendingIdx, firstPendingIdx + 3),
      futureMilestones: all.slice(firstPendingIdx + 3),
    };
  }, [milestonesForRunway]);

  const renderMilestoneRow = useCallback(
    (ms: Milestone) => {
      const isNext =
        nextPendingMilestone != null && ms.id === nextPendingMilestone.id;
      const isQueued = ms.status !== "Done" && !isNext;
      return (
        <MilestoneRow
          key={ms.id}
          milestone={ms}
          startNameInEditMode={ms.id === newMilestoneNameFocusId}
          isNextPendingMilestone={isNext}
          isQueuedPendingMilestone={isQueued}
          goalSlackChannelId={goalSlackChannelId}
          goalSlackChannelName={goalSlackChannelName}
          goalDescription={goalDescription}
          people={people}
          projectName={project.name}
          projectOwnerId={project.ownerId}
          projectComplexity={project.complexityScore}
          milestonesSummary={milestonesSummaryForLikelihood}
          alignSlackPreviewToNextMilestoneColumn
          slackUrlEditSignal={
            isNext ? nextMilestoneSlackUrlEditSignal : 0
          }
        />
      );
    },
    [
      nextPendingMilestone,
      newMilestoneNameFocusId,
      goalSlackChannelId,
      goalSlackChannelName,
      goalDescription,
      people,
      project.name,
      project.ownerId,
      project.complexityScore,
      milestonesSummaryForLikelihood,
      nextMilestoneSlackUrlEditSignal,
    ]
  );

  const onAddMilestoneClick = useCallback(async () => {
    // Reveal future milestones first so a new milestone appended to the list (4th+ pending, etc.) is visible.
    setFutureMilestonesOpen(true);
    const ms = await createMilestone({
      projectId: project.id,
      name: "New milestone",
      status: "Not Done",
      targetDate: "",
    });
    setNewMilestoneNameFocusId(ms.id);
  }, [project.id]);

  const nextMilestoneUi = useMemo(() => {
    if (!nextPendingMilestone) return null;
    const td = nextPendingMilestone.targetDate.trim();
    const compact = td ? formatRelativeCalendarDateCompact(td) : null;
    const idx = project.milestones.findIndex(
      (m) => m.id === nextPendingMilestone.id
    );
    const pos = idx >= 0 ? idx + 1 : null;
    const titleParts: string[] = [nextPendingMilestone.name];
    if (td && compact) {
      titleParts.push(
        formatRelativeCalendarDate(td),
        formatCalendarDateHint(td)
      );
    } else {
      titleParts.push("No target date — set one on this milestone");
    }
    if (pos != null) {
      titleParts.push(`Milestone ${pos}/${project.milestones.length}`);
    }
    return {
      title: titleParts.join(" · "),
      chipLabel: compact ?? "—",
      isOverdueHorizon: compact != null && compact.startsWith("-"),
    };
  }, [nextPendingMilestone, project.milestones]);

  /** Always derive from data — used to prefetch thread status even when the row is expanded (expand preset hides the inline preview). */
  const nextMilestoneSlackFetchUrl = useMemo(() => {
    if (!nextPendingMilestone) return null;
    const u = nextPendingMilestone.slackUrl.trim();
    return isValidHttpUrl(u) ? u : null;
  }, [nextPendingMilestone]);

  const nextMilestoneSlackThread = useSlackThreadStatus(
    nextMilestoneSlackFetchUrl,
    people
  );

  const nextThreadReplyCountForLikelihood = nextMilestoneSlackThread.loading
    ? null
    : (nextMilestoneSlackThread.status?.replyCount ?? null);

  const nextMilestoneLikelihood = useMilestoneLikelihood({
    slackUrl: nextMilestoneSlackFetchUrl,
    milestoneName: nextPendingMilestone?.name ?? "",
    targetDate: nextPendingMilestone?.targetDate ?? "",
    ownerAutonomy: ownerPerson?.autonomyScore ?? null,
    projectComplexity: project.complexityScore,
    rosterHints: nextMilestoneSlackThread.rosterHints,
    roadmapContext: roadmapForNextMilestoneAi,
    threadReplyCount:
      nextMilestoneSlackFetchUrl != null
        ? nextThreadReplyCountForLikelihood
        : null,
  });

  useAutoCompleteMilestoneAt100({
    milestoneId: nextPendingMilestone?.id,
    status: nextPendingMilestone?.status,
    progressEstimate: nextMilestoneLikelihood.result?.progressEstimate ?? null,
    threadReplyCount:
      nextMilestoneSlackFetchUrl != null
        ? nextThreadReplyCountForLikelihood
        : null,
  });

  const milestonesVisible = expanded && showMilestones;
  /** Popovers anchor to the inline control — only when the summary column is interactable. */
  const showNextMilestoneSlackInline =
    !milestonesVisible && nextMilestoneSlackFetchUrl != null;
  /** Render targets stay mounted while fading; visibility is CSS-driven via `milestonesVisible`. */
  const renderNextMilestoneSlackInline =
    nextMilestoneSlackFetchUrl != null;
  const renderNextMilestoneSlackConnect =
    nextPendingMilestone != null && nextMilestoneSlackFetchUrl == null;

  const goalChannelIdTrimmed = goalSlackChannelId.trim();
  const canCreateSlackThread = Boolean(goalChannelIdTrimmed);
  const closeNextMsSlackConnectMenu = nextMsSlackConnectMenu.close;

  const nextMilestoneSlackConnectMenuEntries = useMemo((): ContextMenuEntry[] => {
    return [
      {
        type: "item",
        id: "next-ms-slack-ai",
        label: "Draft a new Slack thread with AI…",
        icon: Sparkles,
        disabled: !canCreateSlackThread,
        disabledReason:
          "Set a Slack channel on the goal first (Roadmap goal row)",
        onClick: () => {
          closeNextMsSlackConnectMenu();
          setNextMilestoneCreateThreadOpen(true);
        },
      },
      {
        type: "item",
        id: "next-ms-slack-url",
        label: "Attach existing Slack thread URL…",
        icon: Pencil,
        onClick: () => {
          closeNextMsSlackConnectMenu();
          setExpanded(true);
          setShowMilestones(true);
          setNextMilestoneSlackUrlEditSignal((n) => n + 1);
        },
      },
    ];
  }, [canCreateSlackThread, closeNextMsSlackConnectMenu]);

  const warnings = useMemo(
    () => getTrackerProjectWarnings(project, goalCostOfDelay, people),
    [project, goalCostOfDelay, people]
  );

  const showCloseWatch = useMemo(
    () => projectMatchesCloseWatch(project, people),
    [project, people]
  );

  const lowAutonomyOwnerHint = useMemo(() => {
    if (!ownerPerson || isFounderPerson(ownerPerson)) return null;
    const level = clampAutonomy(ownerPerson.autonomyScore);
    if (level > 2) return null;
    return AUTONOMY_GROUP_LABEL[level].title;
  }, [ownerPerson]);

  const projectNeedsDueDate = useMemo(() => {
    const raw = project.targetDate?.trim() ?? "";
    return !raw || parseCalendarDateString(raw) === null;
  }, [project.targetDate]);

  const projectDueUrgency = useMemo(() => {
    const raw = project.targetDate?.trim() ?? "";
    if (!raw || parseCalendarDateString(raw) === null) return null;
    return getProjectDueDateUrgency(raw);
  }, [project.targetDate]);

  const isMirror = project.isMirror ?? false;

  const projectMenuEntries = useMemo((): ContextMenuEntry[] => {
    const execBlock: ContextMenuEntry[] = [];
    if (!project.atRisk && !project.spotlight) {
      execBlock.push(
        {
          type: "item",
          id: "p-exec-at-risk",
          label: "Mark at risk",
          icon: Flag,
          onClick: () =>
            void updateProject(project.id, { atRisk: true, spotlight: false }),
        },
        {
          type: "item",
          id: "p-exec-spotlight",
          label: "Mark spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: true }),
        }
      );
    } else if (project.atRisk) {
      execBlock.push(
        {
          type: "item",
          id: "p-exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "p-exec-to-spotlight",
          label: "Switch to spotlight",
          icon: Sparkles,
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: true }),
        }
      );
    } else {
      execBlock.push(
        {
          type: "item",
          id: "p-exec-clear",
          label: "Clear executive signal",
          onClick: () =>
            void updateProject(project.id, { atRisk: false, spotlight: false }),
        },
        {
          type: "item",
          id: "p-exec-to-at-risk",
          label: "Switch to at risk",
          icon: Flag,
          onClick: () =>
            void updateProject(project.id, { atRisk: true, spotlight: false }),
        }
      );
    }

    const expandLabel = !expanded
      ? "Expand project"
      : !showMilestones
        ? "Show milestones"
        : "Collapse project";
    const ExpandIcon =
      !expanded || !showMilestones ? ChevronDown : ChevronRight;

    return [
      {
        type: "item",
        id: "add-milestone",
        label: "Add milestone",
        icon: Plus,
        onClick: async () => {
          setFutureMilestonesOpen(true);
          const ms = await createMilestone({
            projectId: project.id,
            name: "New milestone",
            status: "Not Done",
            targetDate: "",
          });
          setNewMilestoneNameFocusId(ms.id);
          setExpanded(true);
          setShowMilestones(true);
        },
      },
      {
        type: "item",
        id: "rename-project",
        label: "Rename project",
        icon: Pencil,
        onClick: () => setProjectRenameNonce((n) => n + 1),
      },
      ...(canMoveToAnotherGoal
        ? ([
            {
              type: "item" as const,
              id: "move-to-goal",
              label: "Move to goal…",
              icon: MoveRight,
              onClick: () => setMoveGoalPickerOpen(true),
            },
          ] as ContextMenuEntry[])
        : []),
      {
        type: "item",
        id: "p-ai-update-fields",
        label: "Update with AI…",
        icon: Wand2,
        onClick: () => setAiUpdateOpen(true),
      },
      ...(assistant
        ? [
            {
              type: "item" as const,
              id: "p-discuss-in-chat",
              label: "Discuss in chat",
              icon: MessageSquare,
              onClick: () =>
                assistant.openAssistant({
                  type: "project",
                  id: project.id,
                  label: project.name,
                }),
            },
          ]
        : []),
      {
        type: "item",
        id: "p-review-notes",
        label: "Review notes…",
        icon: MessageSquareText,
        onClick: () => setProjectReviewNotesNonce((n) => n + 1),
      },
      {
        type: "item",
        id: "mirror-to-goal",
        label: "Mirror to goal…",
        icon: ArrowRightLeft,
        onClick: () => setMirrorPickerOpen(true),
      },
      ...(isMirror
        ? ([
            {
              type: "item",
              id: "remove-mirror",
              label: "Remove mirror from this goal",
              onClick: () =>
                void unmirrorProjectFromGoal(project.id, goalId).catch(
                  (e) => {
                    alert(
                      e instanceof Error ? e.message : "Could not remove mirror."
                    );
                  }
                ),
            },
          ] as ContextMenuEntry[])
        : []),
      {
        type: "item",
        id: "set-blocked-by",
        label: "Set blocked by…",
        icon: Ban,
        onClick: () => setBlockedByPickerOpen(true),
      },
      ...((project.blockedByProjectId ?? "").trim()
        ? ([
            {
              type: "item",
              id: "clear-blocked-by",
              label: "Clear blocked by",
              onClick: () =>
                void updateProject(project.id, { blockedByProjectId: "" }),
            },
          ] as ContextMenuEntry[])
        : []),
      { type: "divider", id: "p-d1" },
      ...execBlock,
      { type: "divider", id: "p-d2" },
      {
        type: "item",
        id: "expand-project",
        label: expandLabel,
        icon: ExpandIcon,
        onClick: () => toggleProjectRow(),
      },
      { type: "divider", id: "p-d3" },
      {
        type: "item",
        id: "delete-project",
        label: isMirror ? "Delete project entirely…" : "Delete project…",
        icon: Trash2,
        destructive: true,
        confirmMessage: isMirror
          ? "Delete this project from every goal it appears on? This cannot be undone."
          : `Delete this project? This can't be undone.`,
        onClick: async () => {
          await deleteProject(project.id);
          toast.success(`Project “${project.name}” deleted.`);
        },
      },
    ];
  }, [
    expanded,
    goalId,
    isMirror,
    project.atRisk,
    project.id,
    project.name,
    project.spotlight,
    project.blockedByProjectId,
    canMoveToAnotherGoal,
    setProjectRenameNonce,
    showMilestones,
    toggleProjectRow,
    assistant,
  ]);

  return (
    <div
      className={cn(
        project.atRisk &&
          "max-w-full min-w-0 overflow-hidden rounded-md transition-colors duration-150 motion-reduce:transition-none border border-amber-500/40 bg-amber-950/45 shadow-sm ring-1 ring-amber-950/35 border-l-[3px] border-l-amber-400 hover:bg-amber-950/55 hover:border-amber-500/50",
        !project.atRisk &&
          project.spotlight &&
          "max-w-full min-w-0 overflow-hidden rounded-md transition-colors duration-150 motion-reduce:transition-none border border-emerald-500/35 bg-emerald-950/40 shadow-sm ring-1 ring-emerald-950/30 border-l-[3px] border-l-emerald-400/85 hover:bg-emerald-950/52 hover:border-emerald-500/45",
        !project.atRisk && !project.spotlight && ROADMAP_PROJECT_CARD_SHELL_NEUTRAL_CLASS
      )}
    >
      <div
        ref={nextMilestoneSlackSpotlightRef}
        title={
          !expanded
            ? "Expand project details and milestones (click row)"
            : !showMilestones
              ? "Show milestones (click row)"
              : "Collapse project (click row)"
        }
        onClick={onProjectRowClick}
        onContextMenuCapture={projectContext.onContextMenuCapture}
        className={cn(
          "group/project group/project-row flex min-h-[28px] w-full min-w-max cursor-pointer items-center border-b border-zinc-900 py-1 transition-colors motion-reduce:transition-none",
          ROADMAP_GRID_GAP_CLASS,
          ROADMAP_PROJECT_GRID_PADDING_CLASS,
          !project.atRisk &&
            !project.spotlight &&
            ROADMAP_PROJECT_INNER_ROW_NEUTRAL_CLASS
        )}
      >
        <div className="w-8 shrink-0 flex items-center justify-center">
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 ease-out pointer-events-none motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        </div>

        {/* Project name — AI info icon inline at end of name; Shared/Mirror — w-[360px] matches goal + headers */}
        <div
          className={cn(
            ROADMAP_PROJECT_TITLE_COL_CLASS,
            "flex items-center gap-2.5"
          )}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("[data-shared-badge-root]")) e.stopPropagation();
            if (t.closest("[data-status-icon-button]")) e.stopPropagation();
          }}
        >
          {project.isBlocked === true &&
          project.blockedByProjectName !== undefined ? (
            <BlockedByProjectHover
              blockedByProjectName={project.blockedByProjectName}
              className="shrink-0"
            >
              <span
                className="relative -ml-2 block h-[21.6px] w-[21.6px] shrink-0 pr-1.5"
                data-status-icon-button
              >
                <ProjectStatusIconButton
                  status="Blocked"
                  disabled
                  titleSuffix={`blocked by ${project.blockedByProjectName}`}
                />
              </span>
            </BlockedByProjectHover>
          ) : (
            <span
              className="relative -ml-2 block h-[21.6px] w-[21.6px] shrink-0 pr-1.5"
              data-status-icon-button
            >
              <div
                ref={statusCellRef}
                className={cn(
                  "absolute inset-0 z-[15] min-w-0 overflow-hidden opacity-0",
                  "[&>div>svg:last-child]:hidden",
                  "[&_button]:!h-[21.6px] [&_button]:!min-h-[21.6px] [&_button]:!max-h-[21.6px] [&_button]:!justify-center [&_button]:!px-0 [&_button]:!pr-0"
                )}
              >
                <InlineEditCell
                  {...GRID_ALIGN}
                  className="group/status !h-[21.6px] !min-h-0 !min-w-0 !w-[21.6px]"
                  overlaySelectQuiet
                  value={project.status}
                  onSave={(status) =>
                    updateProject(project.id, { status: status as ProjectStatus })
                  }
                  type="select"
                  options={PROJECT_STATUS_SELECT_OPTIONS_EDITABLE}
                  formatDisplay={(v) => (
                    <ProjectStatusPill status={v} variant="inline" />
                  )}
                  selectPresentation="always"
                  displayTitle={`Status — ${project.status}`}
                />
              </div>
              <ProjectStatusIconButton status={project.status} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <InlineEditCell
              {...GRID_ALIGN}
              value={project.name}
              onSave={(name) => updateProject(project.id, { name })}
              startInEditMode={project.id === focusProjectNameEditId}
              openEditNonce={projectRenameNonce}
              displayClassName={ROADMAP_ENTITY_TITLE_DISPLAY_CLASS}
              collapsedSuffix={
                <span
                  className={cn(
                    "inline-flex items-center align-middle transition-opacity duration-150 motion-reduce:transition-none",
                    "opacity-0 group-hover/project-row:opacity-100",
                    aiContextUiOpen && "opacity-100",
                    "pointer-events-none group-hover/project-row:pointer-events-auto",
                    aiContextUiOpen && "pointer-events-auto"
                  )}
                >
                  <AiContextInfoIcon
                    inline
                    variant="project"
                    projectId={project.id}
                    description={project.description}
                    definitionOfDone={project.definitionOfDone}
                    onUiOpenChange={setAiContextUiOpen}
                  />
                </span>
              }
            />
          </div>
          <div className="shrink-0 flex items-center gap-1" data-shared-badge-root>
            <SharedBadge
              isMirror={isMirror}
              primaryGoalId={project.goalId}
              mirroredGoalIds={project.mirroredGoalIds ?? []}
              currentGoalId={goalId}
              goals={allGoals}
              companies={allCompanies}
            />
            {showNewHirePilotBadge ? (
              <span
                className="inline-flex items-center rounded border border-amber-500/40 bg-amber-950/45 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200/95"
                title="New hire pilot (first 90 days)"
              >
                Pilot
              </span>
            ) : null}
          </div>
        </div>

        {/* Owner */}
        <div className={ROADMAP_OWNER_COL_CLASS}>
          <OwnerPickerCell
            {...GRID_ALIGN}
            avatarOnly
            people={people}
            value={project.ownerId}
            onSave={(ownerId) => updateProject(project.id, { ownerId })}
            priority={project.priority}
            workloadMap={ownerWorkloadMap}
            emphasizeUnassigned
          />
        </div>

        {/* Priority */}
        <div className={ROADMAP_DATA_COL_CLASS}>
          <InlineEditCell
            {...GRID_ALIGN}
            centerSelectTrigger
            className="group/status"
            overlaySelectQuiet
            value={project.priority}
            onSave={(priority) =>
              updateProject(project.id, { priority: priority as Priority })
            }
            type="select"
            options={priorityOptions}
            formatDisplay={formatPriorityOverlayDisplay}
            displayTitle={`Priority — ${PRIORITY_MENU_LABEL[project.priority]}`}
            selectPresentation="always"
          />
        </div>

        {/* Complexity — before Confidence; grid matches goal column order */}
        <div
          className={ROADMAP_DELAY_COMPLEXITY_COL_CLASS}
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditCell
            {...GRID_ALIGN}
            className="group/status"
            overlaySelectQuiet
            value={String(project.complexityScore)}
            onSave={(v) =>
              updateProject(project.id, {
                complexityScore: parseScoreBand(v),
              })
            }
            type="select"
            options={SCORE_BAND_OPTIONS}
            formatDisplay={complexityFormatDisplay}
            displayTitle={`Complexity — ${scoreBandLabel(project.complexityScore)} (${project.complexityScore}/5)`}
          />
        </div>

        {/* Confidence — left-aligned with goal Confidence column. */}
        <div
          className={cn(
            ROADMAP_DATA_COL_CLASS,
            "flex items-center justify-start pl-0.5",
          )}
        >
          <AutoConfidencePercent
            score={projectConfidenceAuto}
            explanation={projectConfidenceExplain}
          />
        </div>

        {/* Due date — derived from last milestone with a target date (same relative label as milestone dates).
            Swapped ahead of Progress so the visual Progress bar sits closer to Next milestone, where the
            milestone list is read from. */}
        <div
          className={ROADMAP_DATA_COL_CLASS}
          title={
            project.targetDate.trim()
              ? [
                  formatCalendarDateHint(project.targetDate),
                  " — from last milestone with a date",
                  projectDueUrgency === "past"
                    ? " — overdue"
                    : projectDueUrgency === "within24h"
                      ? " — due within 24 hours"
                      : projectDueUrgency === "within48h"
                        ? " — due within 48 hours"
                        : "",
                ].join("")
              : "Set a target date on at least one milestone"
          }
        >
          <span
            className={cn(
              "inline-flex min-h-[1.25rem] w-full max-w-full items-center px-1 py-0.5 text-xs font-medium leading-tight",
              project.targetDate.trim() && "min-w-0 overflow-hidden",
              projectNeedsDueDate
                ? "rounded border border-amber-500/45 bg-amber-950/40 text-amber-100/95 ring-1 ring-amber-500/25"
                : projectDueUrgency === "past"
                  ? "rounded border border-rose-500/40 bg-rose-950/35 text-rose-200 ring-1 ring-rose-500/25"
                  : projectDueUrgency === "within24h"
                    ? "rounded border border-orange-500/40 bg-orange-950/35 text-orange-200 ring-1 ring-orange-500/30"
                    : projectDueUrgency === "within48h"
                      ? "rounded border border-yellow-500/35 bg-yellow-950/25 text-yellow-200 ring-1 ring-yellow-500/25"
                      : "text-zinc-200"
            )}
          >
            {project.targetDate.trim()
              ? (
                <span className="min-w-0 flex-1 truncate">
                  {formatRelativeCalendarDate(project.targetDate, new Date(), {
                    omitFuturePreposition: true,
                  })}
                </span>
              )
              : (
                <Calendar
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    projectNeedsDueDate
                      ? "text-amber-200/80"
                      : "text-zinc-500/75"
                  )}
                  strokeWidth={1.5}
                  aria-hidden
                />
              )}
          </span>
        </div>

        {/* Progress — milestone completion shown as bare "x/y" inside the bar; the column header
            already carries the "Progress" meaning, no need to repeat "done". */}
        <div className={ROADMAP_DATA_COL_CLASS}>
          <ProgressBar
            percent={project.progress}
            label={`${milestonesDoneCount}/${project.milestones.length}`}
            title={`${milestonesDoneCount} of ${project.milestones.length} milestones complete (${project.progress}%)`}
          />
        </div>

        {/*
          Next milestone — horizon + name; fades when milestones are expanded inline.
          When the project is collapsed AND a Slack thread preview is rendered we let the
          column grow into the flex-1 spacer (`!w-auto !grow`) so the thread preview has
          room for the author + body summary instead of truncating inside the fixed 36rem
          slot. `min-w-[36rem]` preserves the baseline grid alignment on narrower viewports.
        */}
        <div
          className={cn(
            ROADMAP_NEXT_MILESTONE_COL_CLASS,
            "overflow-hidden",
            showNextMilestoneSlackInline && "!w-auto !grow min-w-[36rem]"
          )}
        >
          {project.milestones.length === 0 ? (
            <div
              className={cn(
                "transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0",
                milestonesVisible &&
                  "pointer-events-none opacity-0 motion-reduce:opacity-0"
              )}
              inert={milestonesVisible ? true : undefined}
              aria-hidden={milestonesVisible}
            >
              <button
                type="button"
                title="Click to add a milestone"
                className="inline-flex w-full max-w-full items-center gap-0.5 truncate rounded border border-amber-500/45 bg-amber-950/40 px-1 py-0.5 text-left text-xs font-medium leading-tight text-amber-100 ring-1 ring-amber-500/25 cursor-pointer transition-colors hover:bg-amber-950/55 hover:border-amber-400/55"
                onClick={async (e) => {
                  e.stopPropagation();
                  const ms = await createMilestone({
                    projectId: project.id,
                    name: "New milestone",
                    status: "Not Done",
                    targetDate: "",
                  });
                  setNewMilestoneNameFocusId(ms.id);
                  setExpanded(true);
                  setShowMilestones(true);
                }}
              >
                <Plus
                  className="h-3 w-3 shrink-0 text-amber-300/90"
                  aria-hidden
                />
                <span className="min-w-0 truncate">Create milestone</span>
              </button>
            </div>
          ) : nextPendingMilestone && nextMilestoneUi ? (
            <div
              className="flex min-w-0 items-center gap-6 px-1.5 py-1"
              title={nextMilestoneUi.title}
              inert={milestonesVisible ? true : undefined}
              aria-hidden={milestonesVisible}
            >
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0",
                  milestonesVisible && "opacity-0 motion-reduce:opacity-0"
                )}
              >
                <span
                  className={cn(
                    "shrink-0 rounded px-1 py-px font-mono text-[10px] font-semibold tabular-nums ring-1 ring-violet-500/35",
                    nextMilestoneUi.chipLabel === "—"
                      ? "text-zinc-400 ring-zinc-600/40 bg-zinc-800/40"
                      : nextMilestoneUi.isOverdueHorizon
                        ? "text-rose-300/95 bg-rose-950/35 ring-rose-500/35"
                        : "text-violet-200/95 bg-violet-500/15"
                  )}
                >
                  {nextMilestoneUi.chipLabel}
                </span>
                <p className="min-w-0 flex-1 truncate text-left text-xs font-medium leading-snug text-zinc-100">
                  {nextPendingMilestone.name}
                </p>
              </div>
              {renderNextMilestoneSlackInline ? (
                <div
                  className={cn(
                    /*
                      Slack thread preview slot: stays `shrink-0` so the milestone name to its
                      left always truncates first. The cap used to be `min(28rem,58%)` which
                      cropped the author + body aggressively on typical laptop widths — we
                      raise it to `48rem` (matches the milestone-row inline cap). The column
                      itself grows beyond its 36rem baseline (see column wrapper), so this
                      extra width actually lands on the thread preview.
                    */
                    "min-w-0 max-w-[48rem] shrink-0 transition-opacity duration-200 ease-out delay-75 motion-reduce:transition-none motion-reduce:delay-0 motion-reduce:duration-0",
                    milestonesVisible && "opacity-0 motion-reduce:opacity-0"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MilestoneSlackThreadInline
                    ref={nextMilestoneSlackAnchorRef}
                    compact
                    status={nextMilestoneSlackThread.status}
                    loading={nextMilestoneSlackThread.loading}
                    error={nextMilestoneSlackThread.error}
                    onOpen={() => setNextMsThreadPopoverOpen(true)}
                    likelihood={
                      nextMilestoneLikelihood.result &&
                      nextPendingMilestone?.targetDate?.trim()
                        ? {
                            likelihood: nextMilestoneLikelihood.result.likelihood,
                            progressEstimate:
                              nextMilestoneLikelihood.result.progressEstimate,
                            riskLevel: nextMilestoneLikelihood.result.riskLevel,
                          }
                        : null
                    }
                    likelihoodLoading={
                      Boolean(nextPendingMilestone?.targetDate?.trim()) &&
                      nextMilestoneLikelihood.loading
                    }
                  />
                </div>
              ) : renderNextMilestoneSlackConnect ? (
                <div
                  className={cn(
                    "w-fit shrink-0 transition-opacity duration-200 ease-out delay-75 motion-reduce:transition-none motion-reduce:delay-0 motion-reduce:duration-0",
                    milestonesVisible && "opacity-0 motion-reduce:opacity-0"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <StartSlackThreadChip
                    menuOpen={nextMsSlackConnectMenu.open}
                    onMenuTrigger={nextMsSlackConnectMenu.openFromTrigger}
                    ariaLabel="Start Slack thread for next milestone"
                  />
                  <ContextMenu
                    open={nextMsSlackConnectMenu.open}
                    x={nextMsSlackConnectMenu.x}
                    y={nextMsSlackConnectMenu.y}
                    onClose={nextMsSlackConnectMenu.close}
                    scope="milestone"
                    ariaLabel="Slack thread for next milestone"
                    entries={nextMilestoneSlackConnectMenuEntries}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                "transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0",
                milestonesVisible &&
                  "pointer-events-none opacity-0 motion-reduce:opacity-0"
              )}
              inert={milestonesVisible ? true : undefined}
              aria-hidden={milestonesVisible}
            >
              <p
                className="truncate text-left text-xs font-medium leading-tight text-zinc-400"
                title="All milestones are done"
              >
                All milestones done
              </p>
            </div>
          )}
        </div>

        <div className="min-w-2 flex-1" aria-hidden={true} />

        {/* Status flags + warnings — right cluster */}
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {project.atRisk && (
            <span
              className="whitespace-nowrap rounded-md border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/95"
              title="Marked at risk"
            >
              At risk
            </span>
          )}
          {project.spotlight && (
            <span
              className="whitespace-nowrap rounded-md border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95"
              title="Spotlight — win or momentum"
            >
              Spotlight
            </span>
          )}
          {warnings.length > 0 ? (
            <WarningsBadge warnings={warnings} />
          ) : null}
          {showCloseWatch && (
            <span
              className="whitespace-nowrap rounded-md border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/95"
              title="P0/P1 with owner autonomy 0–2 — stay closer on delivery"
            >
              Close watch
            </span>
          )}
        </div>

        <RowActionIcons rowGroup="project" forceVisible={project.atRisk || project.spotlight}>
          <button
            ref={projectActionsRef}
            type="button"
            title="Project actions"
            aria-label={`More actions for project ${project.name}`}
            aria-haspopup="menu"
            aria-expanded={projectContext.open}
            onClick={projectContext.openFromTrigger}
            className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        </RowActionIcons>
      </div>

      <ContextMenu
        open={projectContext.open}
        x={projectContext.x}
        y={projectContext.y}
        onClose={projectContext.close}
        scope="project"
        ariaLabel={`Actions for project ${project.name}`}
        entries={projectMenuEntries}
      />
      <ReviewNotesPopover
        anchorRef={projectActionsRef}
        openNonce={projectReviewNotesNonce}
        entries={project.reviewLog}
        onAppendNote={(t) => appendProjectReviewNote(project.id, t)}
      />

      {showNextMilestoneSlackInline && nextPendingMilestone ? (
        <SlackMilestoneThreadPopovers
          anchorRef={nextMilestoneSlackAnchorRef}
          spotlightRef={nextMilestoneSlackSpotlightRef}
          slackUrl={nextMilestoneSlackFetchUrl}
          milestoneName={nextPendingMilestone.name}
          status={nextMilestoneSlackThread.status}
          rosterHints={nextMilestoneSlackThread.rosterHints}
          popoverOpen={nextMsThreadPopoverOpen}
          onPopoverOpenChange={handleNextMsThreadPopoverOpenChange}
          pingOpen={nextMsThreadPingOpen}
          onPingOpenChange={setNextMsThreadPingOpen}
          pingMode={nextMsPingMode}
          onPingModeChange={setNextMsPingMode}
          onRefreshStatus={() =>
            void nextMilestoneSlackThread.refresh({ force: true })
          }
          onPingSent={() => void nextMilestoneSlackThread.refresh({ force: true })}
          targetDate={nextPendingMilestone.targetDate}
          ownerName={ownerPerson?.name ?? null}
          ownerAutonomy={ownerPerson?.autonomyScore ?? null}
          projectComplexity={project.complexityScore}
          likelihood={nextMilestoneLikelihood.result}
          likelihoodLoading={nextMilestoneLikelihood.loading}
          likelihoodError={nextMilestoneLikelihood.error}
        />
      ) : null}

      {nextPendingMilestone ? (
        <SlackCreateThreadDialog
          open={nextMilestoneCreateThreadOpen}
          onClose={() => setNextMilestoneCreateThreadOpen(false)}
          milestoneId={nextPendingMilestone.id}
          milestoneName={nextPendingMilestone.name}
          goalDescription={goalDescription}
          projectName={project.name}
          channelId={goalChannelIdTrimmed}
          channelName={goalSlackChannelName}
          people={people}
          spotlightRef={nextMilestoneSlackSpotlightRef}
        />
      ) : null}

      <MirrorGoalPickerDialog
        open={mirrorPickerOpen}
        onClose={() => setMirrorPickerOpen(false)}
        hierarchy={mirrorPickerHierarchy}
        projectId={project.id}
        primaryGoalId={project.goalId}
        mirroredGoalIds={project.mirroredGoalIds ?? []}
      />
      {projectCompanyId ? (
        <MoveProjectGoalPickerDialog
          open={moveGoalPickerOpen}
          onClose={() => setMoveGoalPickerOpen(false)}
          allGoals={allGoals}
          allCompanies={allCompanies}
          projectCompanyId={projectCompanyId}
          projectId={project.id}
          primaryGoalId={project.goalId}
        />
      ) : null}
      <BlockedByPickerDialog
        open={blockedByPickerOpen}
        onClose={() => setBlockedByPickerOpen(false)}
        hierarchy={mirrorPickerHierarchy}
        currentProjectId={project.id}
      />

      {/* Milestones — footer row matches whether future milestones exist (no hover-only row; avoids layout shift). */}
      <CollapsePanel open={expanded && showMilestones}>
        <div
          className={cn("group/milestones", ROADMAP_MILESTONE_LIST_SHELF_CLASS)}
        >
          {lowAutonomyOwnerHint ? (
            <div
              className={cn(
                "mb-0.5 border-b border-zinc-800/70 py-1.5",
                ROADMAP_MILESTONE_GRID_PADDING_CLASS
              )}
            >
              <p className="text-[11px] leading-snug text-zinc-400">
                <span className="font-medium text-amber-200/90">Owner — </span>
                {lowAutonomyOwnerHint}
              </p>
            </div>
          ) : null}
          {project.milestones.length === 0 ? (
            <div className={cn("py-2", ROADMAP_MILESTONE_GRID_PADDING_CLASS)}>
              <p
                className={cn(
                  "w-full min-w-0",
                  TRACKER_EMPTY_HINT_COPY_GOAL_CLASS
                )}
              >
                No milestones yet. Add a milestone to track delivery checkpoints
                for this project.&nbsp;
                <button
                  type="button"
                  title="Add a new milestone to this project"
                  onClick={async () => {
                    const ms = await createMilestone({
                      projectId: project.id,
                      name: "New milestone",
                      status: "Not Done",
                      targetDate: "",
                    });
                    setNewMilestoneNameFocusId(ms.id);
                    setExpanded(true);
                    setShowMilestones(true);
                  }}
                  className={TRACKER_INLINE_TEXT_ACTION}
                >
                  Add milestone
                </button>
              </p>
            </div>
          ) : milestonesForRunway.length === 0 && !showCompletedProjects ? (
            <div
              className={cn(
                "py-2 text-xs text-zinc-500",
                ROADMAP_MILESTONE_GRID_PADDING_CLASS
              )}
            >
              Completed milestones are hidden — turn on Show completed in the
              toolbar to see them.
            </div>
          ) : (
            <>
              {milestoneRunway.completedBeforeRunway.map((ms) =>
                renderMilestoneRow(ms)
              )}

              {milestoneRunway.completedBeforeRunway.length > 0 &&
              (milestoneRunway.coreMilestones.length > 0 ||
                milestoneRunway.futureMilestones.length > 0) ? (
                <div
                  className="border-b border-zinc-800/60 mb-0.5"
                  aria-hidden
                />
              ) : null}

              {milestoneRunway.coreMilestones.map((ms) =>
                renderMilestoneRow(ms)
              )}

              {milestoneRunway.futureMilestones.length > 0 ? (
                <CollapsePanel
                  open={futureMilestonesOpen}
                  fadeContent
                  transitionClassName="duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150 motion-reduce:transition-none"
                >
                  {milestoneRunway.futureMilestones.map((ms) =>
                    renderMilestoneRow(ms)
                  )}
                </CollapsePanel>
              ) : null}

              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-900/70 py-1.5",
                  ROADMAP_MILESTONE_GRID_PADDING_CLASS
                )}
              >
                {milestoneRunway.futureMilestones.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFutureMilestonesOpen((open) => !open)}
                    className="inline-flex w-fit max-w-full shrink-0 items-center gap-2 text-left text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-300 rounded-sm py-0.5 -my-0.5 pl-0 pr-2"
                    aria-expanded={futureMilestonesOpen}
                  >
                    {futureMilestonesOpen ? (
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                    ) : (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0">
                      {futureMilestonesOpen ? "Hide" : "Show"}{" "}
                      {milestoneRunway.futureMilestones.length === 1
                        ? "1 future milestone"
                        : `${milestoneRunway.futureMilestones.length} future milestones`}
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onAddMilestoneClick}
                  title="Add a new milestone to this project"
                  className={TRACKER_ADD_ROW_ACTION_BUTTON_CLASS}
                >
                  <Plus className="h-3 w-3 shrink-0" aria-hidden />
                  Add milestone
                </button>
              </div>
            </>
          )}
        </div>
      </CollapsePanel>

      {aiUpdateOpen && (
        <AiUpdateDialog
          type="project"
          projectId={project.id}
          description={project.description}
          definitionOfDone={project.definitionOfDone}
          onClose={() => setAiUpdateOpen(false)}
        />
      )}
    </div>
  );
}
