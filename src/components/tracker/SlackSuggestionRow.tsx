"use client";

import { useState } from "react";
import type { Person } from "@/lib/types/tracker";
import type { SlackSuggestionRecord } from "@/lib/schemas/tracker";
import { SlackScrapeEvidencePreview } from "./SlackScrapeEvidencePreview";
import { PriorityPillInline } from "./PriorityPillInline";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { approveSlackSuggestion, rejectSlackSuggestion } from "@/server/actions/slackSuggestions";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function personName(people: Person[], id: string): string {
  if (!id.trim()) return "—";
  return people.find((p) => p.id === id)?.name ?? id;
}

function kindTitle(rec: SlackSuggestionRecord, people: Person[]): string {
  const p = rec.payload;
  switch (p.kind) {
    case "newGoalWithProjects": {
      const n = p.goal.description.slice(0, 80);
      return `New goal: ${n}${p.goal.description.length > 80 ? "…" : ""}`;
    }
    case "newProjectOnExistingGoal":
      return `New project: ${p.project.name}`;
    case "editGoal": {
      const parts: string[] = [];
      if (p.patch.description !== undefined) parts.push("title");
      if (p.patch.ownerPersonId)
        parts.push(`owner → ${personName(people, p.patch.ownerPersonId)}`);
      if (p.patch.slackChannelId) parts.push("Slack channel");
      if (p.patch.measurableTarget !== undefined) parts.push("target");
      return `Update goal: ${parts.join(", ") || "fields"}`;
    }
    case "editProject": {
      const q: string[] = [];
      if (p.patch.name !== undefined) q.push("name");
      if (p.patch.status) q.push(`status → ${p.patch.status}`);
      if (p.patch.priority) q.push("priority");
      if (p.patch.assigneePersonId)
        q.push(`assignee → ${personName(people, p.patch.assigneePersonId)}`);
      return `Update project: ${q.join(", ") || "fields"}`;
    }
    case "addMilestoneToExistingProject":
      return `Add milestone: ${p.milestone.name} (${p.milestone.targetDate})`;
    case "editMilestone":
      return `Update milestone: ${[p.patch.name, p.patch.targetDate].filter(Boolean).join(" · ")}`;
    default: {
      const _e: never = p;
      return String(_e);
    }
  }
}

export function SlackSuggestionRow({
  rec,
  people,
  onResolved,
  compact = false,
}: {
  rec: SlackSuggestionRecord;
  people: Person[];
  onResolved?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"a" | "r" | null>(null);
  const days = daysSince(rec.firstSeenAt);

  const run = async (fn: () => Promise<unknown>, label: "a" | "r") => {
    setBusy(label);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "ok" in r && (r as { ok: boolean }).ok === false) {
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

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-800 bg-zinc-950/60 p-3",
        compact && "p-2.5"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-zinc-200 leading-snug">
            {kindTitle(rec, people)}
          </p>
          {rec.rationale ? (
            <p className="text-xs text-zinc-500">{rec.rationale}</p>
          ) : null}
          <p className="text-[10px] text-zinc-600">
            First surfaced {days === 0 ? "today" : `${days}d ago`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run(() => rejectSlackSuggestion(rec.id), "r")}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            {busy === "r" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reject"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run(() => approveSlackSuggestion(rec.id), "a")}
            className="rounded-md border border-emerald-600/50 bg-emerald-950/50 px-2.5 py-1 text-xs text-emerald-200 hover:bg-emerald-900/50"
          >
            {busy === "a" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
          </button>
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {rec.payload.evidence.map((ev, i) => (
          <SlackScrapeEvidencePreview
            key={`${ev.ts}-${i}`}
            evidence={ev}
            people={people}
            channelLabel={ev.channel}
          />
        ))}
      </div>
      {rec.payload.kind === "editProject" && rec.payload.patch.priority ? (
        <div className="mt-1">
          <PriorityPillInline priority={rec.payload.patch.priority} />
        </div>
      ) : null}
    </div>
  );
}
