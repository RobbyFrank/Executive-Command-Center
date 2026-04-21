"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { CompanyWithGoals, Person, Project } from "@/lib/types/tracker";
import {
  X,
  Loader2,
  Send,
  Users,
  Hash,
  Check,
  CircleAlert,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SlackDraftMessagePreview } from "@/components/tracker/SlackDraftMessagePreview";
import { getSlackThreadPosterPreviewIdentity } from "@/server/actions/slack";
import {
  draftAssignmentMessage,
  reviseAssignmentMessage,
} from "@/server/actions/onboarding/draftAssignmentMessage";
import {
  openBuddyMpimAndPostAssignment,
  postOnboardingAssignmentMessage,
} from "@/server/actions/onboarding/postAssignmentMessage";
import {
  inviteNewHireToSlackChannels,
  type ChannelInviteResult,
} from "@/server/actions/onboarding/inviteNewHireToChannels";
import { slackRosterHintsFromPeople } from "@/lib/slack-roster-hints";
import type {
  SelectedBuddy,
  SelectedChannel,
} from "@/components/team/RecommendPilotDialog";

function lookupGoalCompany(
  hierarchy: CompanyWithGoals[],
  goalId: string
): { companyName: string; goalDescription: string } | null {
  for (const c of hierarchy) {
    const g = c.goals.find((x) => x.id === goalId);
    if (g) {
      return {
        companyName: c.name,
        goalDescription: g.description,
      };
    }
  }
  return null;
}

export function AssignmentMessageDialog({
  open,
  onClose,
  onBack,
  newHire,
  projectId,
  assignmentKind,
  dmContextSummary,
  people,
  projects,
  hierarchy,
  buddies,
  channels,
}: {
  open: boolean;
  onClose: () => void;
  /** Return to the onboarding recommender without posting (restores prior step in parent). */
  onBack?: () => void;
  newHire: Person;
  projectId: string;
  assignmentKind: "owner" | "assignee" | "new_project";
  dmContextSummary: string;
  people: Person[];
  projects: Project[];
  hierarchy: CompanyWithGoals[];
  /** Selected onboarding partners (Slack ids + names) from the recommender. */
  buddies: SelectedBuddy[];
  /** Channels the founder chose in the recommender dialog (may be empty). */
  channels: SelectedChannel[];
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reviseFeedback, setReviseFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [poster, setPoster] = useState<{
    displayName: string;
    avatarSrc: string | null;
  } | null>(null);
  const [previewAt, setPreviewAt] = useState(() => new Date());

  const buddiesWithSlack = useMemo(
    () => buddies.filter((b) => b.slackUserId.trim().length > 0),
    [buddies]
  );
  const canOpenBuddyMpim = buddiesWithSlack.length > 0;
  const [openNewMpim, setOpenNewMpim] = useState<boolean>(canOpenBuddyMpim);

  /**
   * Channels we will invite the new hire to when posting. Starts from the dialog-1 picks,
   * stays editable here so the founder can drop any they reconsidered right before posting.
   */
  const [channelInvites, setChannelInvites] = useState<SelectedChannel[]>(
    channels ?? []
  );
  /** Per-channel post-invite outcome surfaced inline after the post action. */
  const [inviteResults, setInviteResults] = useState<ChannelInviteResult[]>([]);
  useEffect(() => {
    if (!open) return;
    setChannelInvites(channels ?? []);
    setInviteResults([]);
  }, [open, channels, projectId]);

  const newHireHasSlackId = Boolean((newHire.slackHandle ?? "").trim());
  const canInviteChannels = channelInvites.length > 0 && newHireHasSlackId;

  useEffect(() => {
    setOpenNewMpim(canOpenBuddyMpim);
  }, [canOpenBuddyMpim, projectId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const rosterHints = useMemo(
    () => slackRosterHintsFromPeople(people),
    [people]
  );

  useEffect(() => {
    if (!open) {
      setPoster(null);
      return;
    }
    setPreviewAt(new Date());
    let cancelled = false;
    void (async () => {
      const id = await getSlackThreadPosterPreviewIdentity();
      if (!cancelled) setPoster(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadDraft = useCallback(async () => {
    const pid = projectId.trim();
    if (!pid) return;
    const project = projects.find((p) => p.id === pid);
    if (!project) {
      setError("Project not found.");
      return;
    }
    const meta = lookupGoalCompany(hierarchy, project.goalId);
    if (!meta) {
      setError("Goal not found for project.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const r = await draftAssignmentMessage({
        newHire,
        pilotProjectName: project.name,
        definitionOfDone: project.definitionOfDone ?? "",
        goalDescription: meta.goalDescription,
        companyName: meta.companyName,
        assignmentKind:
          assignmentKind === "new_project" ? "new_project" : assignmentKind,
        dmContextSummary,
        rosterHints: slackRosterHintsFromPeople(people),
        buddies: buddiesWithSlack.map((b) => ({
          slackUserId: b.slackUserId,
          name: b.name,
          rationale: b.rationale,
        })),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft(r.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    assignmentKind,
    buddiesWithSlack,
    dmContextSummary,
    hierarchy,
    newHire,
    people,
    projectId,
    projects,
  ]);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setReviseFeedback("");
      setError(null);
      return;
    }
    void loadDraft();
  }, [open, loadDraft]);

  const handleRevise = useCallback(async () => {
    const fb = reviseFeedback.trim();
    if (!fb || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await reviseAssignmentMessage({
        currentDraft: draft,
        feedback: fb,
        newHire,
        rosterHints: slackRosterHintsFromPeople(people),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft(r.text);
      setReviseFeedback("");
      toast.success("Draft updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [draft, loading, newHire, people, reviseFeedback]);

  /**
   * Fire-and-surface helper: runs `conversations.invite` for each selected channel. Does
   * not throw — results are stored in `inviteResults` so the UI can show per-channel status.
   * Returns `true` iff every invite succeeded (used to decide whether to auto-close).
   */
  const runChannelInvites = useCallback(async (): Promise<boolean> => {
    if (!canInviteChannels) {
      setInviteResults([]);
      return true;
    }
    const uid = (newHire.slackHandle ?? "").trim();
    const r = await inviteNewHireToSlackChannels({
      newHireSlackUserId: uid,
      channels: channelInvites.map((c) => ({
        channelId: c.channelId,
        channelName: c.channelName,
      })),
    });
    setInviteResults(r.results);
    return r.results.every((x) => x.ok);
  }, [canInviteChannels, channelInvites, newHire.slackHandle]);

  const handlePost = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      toast.error("Draft is empty.");
      return;
    }

    setPosting(true);
    try {
      if (openNewMpim) {
        const newHireSlack = newHire.slackHandle?.trim();
        if (!newHireSlack) {
          toast.error("New hire has no Slack user id; cannot open a group DM.");
          return;
        }
        if (buddiesWithSlack.length === 0) {
          toast.error("No onboarding partners with Slack ids selected.");
          return;
        }
        const r = await openBuddyMpimAndPostAssignment({
          projectId,
          newHireSlackUserId: newHireSlack,
          buddySlackUserIds: buddiesWithSlack.map((b) => b.slackUserId),
          text,
          includeNadav: true,
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        const invitesAllOk = await runChannelInvites();
        toast.success(
          r.alreadyOpen
            ? "Reused existing group DM and posted"
            : "Opened group DM and posted"
        );
        if (invitesAllOk) {
          onClose();
        }
        router.refresh();
        return;
      }

      const channelId = newHire.welcomeSlackChannelId?.trim();
      if (!channelId) {
        toast.error(
          "Missing onboarding Slack channel on this person. Run onboarding detection or set welcomeSlackChannelId."
        );
        return;
      }
      const r = await postOnboardingAssignmentMessage({
        projectId,
        channelId,
        text,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const invitesAllOk = await runChannelInvites();
      toast.success("Posted to Slack");
      if (invitesAllOk) {
        onClose();
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Post failed");
    } finally {
      setPosting(false);
    }
  }, [
    buddiesWithSlack,
    draft,
    newHire.slackHandle,
    newHire.welcomeSlackChannelId,
    onClose,
    openNewMpim,
    projectId,
    router,
    runChannelInvites,
  ]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/65 p-3 sm:p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignment-msg-title"
    >
      <div className="absolute inset-0" onClick={() => !posting && onClose()} />
      <div
        className="relative z-10 flex max-h-[min(94vh,920px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2
            id="assignment-msg-title"
            className="text-base font-semibold text-zinc-100"
          >
            Assignment message
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={posting}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading && !draft ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-red-400/90">{error}</p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Edit
              </p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="min-h-[min(42vh,22rem)] w-full flex-1 resize-y rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 lg:min-h-[380px]"
                placeholder="Draft Slack message…"
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Slack preview
              </p>
              <div className="min-h-[min(42vh,22rem)] flex-1 overflow-y-auto rounded-md lg:min-h-[380px]">
                <SlackDraftMessagePreview
                  text={draft}
                  people={people}
                  rosterHints={rosterHints}
                  posterDisplayName={poster?.displayName ?? "You"}
                  posterAvatarSrc={poster?.avatarSrc ?? null}
                  postedAt={previewAt}
                  compact
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={reviseFeedback}
              onChange={(e) => setReviseFeedback(e.target.value)}
              placeholder="Revision instructions…"
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-200"
            />
            <button
              type="button"
              disabled={loading || !reviseFeedback.trim()}
              onClick={() => void handleRevise()}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            >
              Revise with AI
            </button>
          </div>

          {canOpenBuddyMpim ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-sky-900/45 bg-sky-950/20 px-3 py-2.5 text-left">
              <input
                type="checkbox"
                checked={openNewMpim}
                onChange={(e) => setOpenNewMpim(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-sky-500"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-sky-200/95 inline-flex items-center gap-1.5">
                  <Users className="h-3 w-3" aria-hidden />
                  Open new group DM with onboarding partners + Nadav
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {buddiesWithSlack.map((b) => b.name).join(", ")}{" "}
                  + Nadav for accountability and oversight. When off, posts to the
                  existing onboarding DM.
                </p>
              </div>
            </label>
          ) : null}

          {channelInvites.length > 0 ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <p className="text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5">
                <Hash className="h-3 w-3 text-zinc-400" aria-hidden />
                Invite {newHire.name.split(/\s+/)[0] || "new hire"} to {channelInvites.length}{" "}
                channel{channelInvites.length === 1 ? "" : "s"} after posting
              </p>
              {!newHireHasSlackId ? (
                <p className="mt-1 text-[11px] text-amber-400/90">
                  New hire is missing a Slack user id — invites cannot be sent.
                </p>
              ) : (
                <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                  Uses <code className="text-zinc-400">conversations.invite</code> on your
                  user token. Slack needs you to already be a member of each channel.
                </p>
              )}
              <ul className="mt-2 space-y-1.5">
                {channelInvites.map((c) => {
                  const outcome = inviteResults.find(
                    (r) => r.channelId === c.channelId
                  );
                  return (
                    <li
                      key={c.channelId}
                      className="flex items-start gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5"
                    >
                      <Hash
                        className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-zinc-100">
                          #{c.channelName || c.channelId}
                        </p>
                        {c.rationale ? (
                          <p className="line-clamp-2 text-[11px] leading-snug text-zinc-500">
                            {c.rationale}
                          </p>
                        ) : null}
                        {outcome ? (
                          outcome.ok ? (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-400/95">
                              <Check className="h-3 w-3" aria-hidden />
                              {outcome.alreadyInChannel
                                ? "Already in channel"
                                : "Invited"}
                            </p>
                          ) : (
                            <p className="mt-0.5 inline-flex items-start gap-1 text-[11px] text-amber-400/95">
                              <CircleAlert
                                className="mt-[1px] h-3 w-3 shrink-0"
                                aria-hidden
                              />
                              <span className="min-w-0 leading-snug">
                                {outcome.error}
                              </span>
                            </p>
                          )
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setChannelInvites((prev) =>
                            prev.filter((x) => x.channelId !== c.channelId)
                          )
                        }
                        disabled={posting}
                        className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                        aria-label={`Remove #${c.channelName} from invites`}
                        title="Remove from this post"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          {onBack ? (
            <button
              type="button"
              onClick={() => {
                if (posting) return;
                onBack();
              }}
              disabled={posting}
              className="mr-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={posting}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={posting || !draft.trim()}
            onClick={() => void handlePost()}
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600",
              "disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            {posting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {openNewMpim ? "Open DM and post" : "Post to onboarding DM"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
