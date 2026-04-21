"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { CompanyWithGoals, Person, Project } from "@/lib/types/tracker";
import { X, Loader2, Send, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  draftAssignmentMessage,
  reviseAssignmentMessage,
} from "@/server/actions/onboarding/draftAssignmentMessage";
import {
  openBuddyMpimAndPostAssignment,
  postOnboardingAssignmentMessage,
} from "@/server/actions/onboarding/postAssignmentMessage";
import { slackRosterHintsFromPeople } from "@/lib/slack-roster-hints";
import type { SelectedBuddy } from "@/components/team/RecommendPilotDialog";

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
  newHire,
  projectId,
  assignmentKind,
  dmContextSummary,
  people,
  projects,
  hierarchy,
  buddies,
}: {
  open: boolean;
  onClose: () => void;
  newHire: Person;
  projectId: string;
  assignmentKind: "owner" | "assignee" | "new_project";
  dmContextSummary: string;
  people: Person[];
  projects: Project[];
  hierarchy: CompanyWithGoals[];
  /** Selected accountability buddies (Slack ids + names) from the recommender. */
  buddies: SelectedBuddy[];
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reviseFeedback, setReviseFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);

  const buddiesWithSlack = useMemo(
    () => buddies.filter((b) => b.slackUserId.trim().length > 0),
    [buddies]
  );
  const canOpenBuddyMpim = buddiesWithSlack.length > 0;
  const [openNewMpim, setOpenNewMpim] = useState<boolean>(canOpenBuddyMpim);

  useEffect(() => {
    setOpenNewMpim(canOpenBuddyMpim);
  }, [canOpenBuddyMpim, projectId]);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      const rosterHints = slackRosterHintsFromPeople(people);
      const r = await draftAssignmentMessage({
        newHire,
        pilotProjectName: project.name,
        definitionOfDone: project.definitionOfDone ?? "",
        goalDescription: meta.goalDescription,
        companyName: meta.companyName,
        assignmentKind:
          assignmentKind === "new_project" ? "new_project" : assignmentKind,
        dmContextSummary,
        rosterHints,
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
      const rosterHints = slackRosterHintsFromPeople(people);
      const r = await reviseAssignmentMessage({
        currentDraft: draft,
        feedback: fb,
        newHire,
        rosterHints,
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
          toast.error("No buddies with Slack ids selected.");
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
        toast.success(
          r.alreadyOpen
            ? "Reused existing group DM and posted"
            : "Opened group DM and posted"
        );
        onClose();
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
      toast.success("Posted to Slack");
      onClose();
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
        className="relative z-10 flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && !draft ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-red-400/90">{error}</p>
          ) : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            placeholder="Draft Slack message…"
          />
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
                  Open new group DM with buddies + Nadav
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {buddiesWithSlack.map((b) => b.name).join(", ")}{" "}
                  + Nadav for accountability and oversight. When off, posts to the
                  existing onboarding DM.
                </p>
              </div>
            </label>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
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
