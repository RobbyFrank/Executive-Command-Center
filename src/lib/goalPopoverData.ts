import type { GoalWithProjects, Person } from "@/lib/types/tracker";
import type { GoalLikelihoodRollup } from "@/lib/goalLikelihoodRollup";
import type {
  GoalChannelAiContext,
  MilestoneLikelihoodRiskLevel,
  SlackMemberRosterHint,
} from "@/server/actions/slack";
import type {
  GoalSlackPopoverProjectRow,
  GoalSlackPopoverUnscoredReason,
} from "@/components/tracker/GoalSlackPopover";
import type { GoalLikelihoodInlineOwner } from "@/components/tracker/GoalLikelihoodInline";
import { getNextPendingMilestone } from "@/lib/next-milestone";
import { isValidHttpUrl } from "@/lib/httpUrl";
import { parseCalendarDateString } from "@/lib/relativeCalendarDate";

const RISK_ORDER: Record<MilestoneLikelihoodRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Build the per-project rows shown inside `GoalSlackPopover`. Mirrors the
 * logic previously inlined in `GoalSection` so the same shape can be
 * reproduced from any caller (Roadmap row, Atlas popover host, etc.).
 *
 * Unscored rows carry a `reasonCode` + short label that explains *why* the
 * AI couldn't produce an estimate yet (e.g. "No target date" or "No Slack
 * thread"), instead of silently rendering 0%/0%.
 */
export function buildGoalPopoverProjectRows(args: {
  goal: GoalWithProjects;
  rollup: GoalLikelihoodRollup | null;
  peopleById: ReadonlyMap<string, Person>;
}): GoalSlackPopoverProjectRow[] {
  const { goal, rollup, peopleById } = args;
  const summariesByKey = new Map<
    string,
    NonNullable<GoalLikelihoodRollup>["projectSummaries"][number]
  >();
  for (const s of rollup?.projectSummaries ?? []) {
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

    const blockerNote = projectBlocked
      ? p.blockedByProjectName?.trim()
        ? `Blocked by ${p.blockedByProjectName.trim()}`
        : "Blocked"
      : undefined;

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
}

/**
 * Distinct project-owner avatars for the goal popover header — autonomy desc
 * then name asc. When the rollup is ready, each owner is enriched with the
 * "worst" risk signal across their projects under this goal so the avatar
 * stack can render colour-coded rings.
 */
export function buildGoalPopoverProjectOwners(args: {
  goal: GoalWithProjects;
  rollup: GoalLikelihoodRollup | null;
  projectRows: GoalSlackPopoverProjectRow[];
  peopleById: ReadonlyMap<string, Person>;
}): GoalLikelihoodInlineOwner[] {
  const { goal, rollup, projectRows, peopleById } = args;
  const rollupReady = Boolean(rollup?.ready);
  const projectsByOwnerId = new Map<
    string,
    Array<{ riskLevel: MilestoneLikelihoodRiskLevel; likelihood: number }>
  >();
  if (rollupReady) {
    const projectById = new Map(goal.projects.map((p) => [p.id, p]));
    for (const row of projectRows) {
      const p = projectById.get(row.projectId);
      const ownerId = p?.ownerId?.trim();
      if (!ownerId) continue;
      if (!row.scored) continue;
      const bucket = projectsByOwnerId.get(ownerId);
      const entry = { riskLevel: row.riskLevel, likelihood: row.likelihood };
      if (bucket) bucket.push(entry);
      else projectsByOwnerId.set(ownerId, [entry]);
    }
  }

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
}

/**
 * Goal-level AI context for `SlackChannelMessageDialog` (ping / nudge /
 * revise drafting). Bundles the goal's rollup, per-project signals, and a
 * roster-hint list so the AI prompt can address owners by Slack handle.
 */
export function buildGoalPopoverChannelAiContext(args: {
  goal: GoalWithProjects;
  rollup: GoalLikelihoodRollup | null;
  oneLinerSummary: string | null;
  projectRows: GoalSlackPopoverProjectRow[];
  projectOwners: GoalLikelihoodInlineOwner[];
  peopleById: ReadonlyMap<string, Person>;
}): GoalChannelAiContext {
  const {
    goal,
    rollup,
    oneLinerSummary,
    projectRows,
    projectOwners,
    peopleById,
  } = args;

  const rosterHints: SlackMemberRosterHint[] = [];
  for (const o of projectOwners) {
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
    oneLinerSummary: oneLinerSummary ?? "",
    rollup: {
      ready: Boolean(rollup?.ready),
      onTimeLikelihood: rollup?.onTimeLikelihood ?? 0,
      riskLevel: rollup?.riskLevel ?? "medium",
      aiConfidence: rollup?.aiConfidence ?? 0,
      coverageCached: rollup?.coverage.cached ?? 0,
      coverageTotal: rollup?.coverage.total ?? 0,
    },
    projects: projectRows.map((r) => ({
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
}
