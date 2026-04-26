import { v4 as uuid } from "uuid";
import { revalidateTag } from "next/cache";
import { getRepository } from "@/server/repository";
import { ECC_SLACK_SUGGESTIONS_TAG } from "@/lib/cache-tags";
import { mutateSlackSuggestions } from "@/server/repository/slack-suggestions-storage";
import { resolveCompanyScrapeChannels } from "@/lib/scrapeCompanyChannels";
import { fetchSlackChannels } from "@/lib/slack";
import { reconcileSlackSuggestionsForCompany } from "@/server/actions/slackRoadmapSync/reconcile";
import { runSlackRoadmapSyncForCompany } from "@/server/actions/slackRoadmapSync/run";
import {
  isFullyAppliedEdit,
  isPendingRecordOrphaned,
} from "@/server/actions/slackRoadmapSync/validate";
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
import type { TrackerData } from "@/lib/types/tracker";
import type {
  SlackScrapeSuggestion,
  SlackSuggestionRecord,
  SlackSuggestionsData,
} from "@/lib/schemas/tracker";
import { computeSlackSuggestionDedupeKey } from "@/lib/slackSuggestionDedupe";

/**
 * Resolves the channel set for a company the same way the scrape dialog’s candidate list
 * (union of name-matched + goal-linked channels). Uses every discovered channel.
 */
export async function resolveChannelIdsForCompanySync(
  data: TrackerData,
  companyId: string
): Promise<{ channelIds: string[]; error?: string }> {
  const list = await fetchSlackChannels();
  if (!list.ok) {
    return { channelIds: [], error: list.error };
  }
  const company = data.companies.find((c) => c.id === companyId);
  if (!company) {
    return { channelIds: [], error: "Company not found" };
  }
  const goals = data.goals.filter((g) => g.companyId === companyId);
  const rows = resolveCompanyScrapeChannels({
    company,
    goalsForCompany: goals,
    allChannels: list.channels,
  });
  return { channelIds: rows.map((r) => r.id) };
}

function stripDefunctPendingForCompany(
  data: TrackerData,
  companyId: string
) {
  return (d: SlackSuggestionsData) => {
    d.items = d.items.filter((it) => {
      if (it.companyId !== companyId || it.status !== "pending") {
        return true;
      }
      if (isPendingRecordOrphaned(data, it)) {
        return false;
      }
      if (
        (it.payload.kind === "editGoal" ||
          it.payload.kind === "editProject" ||
          it.payload.kind === "editMilestone") &&
        isFullyAppliedEdit(data, it)
      ) {
        return false;
      }
      return true;
    });
  };
}

function replacePendingForCompany(
  companyId: string,
  nextPending: SlackSuggestionRecord[]
) {
  return (d: SlackSuggestionsData) => {
    d.items = d.items.filter(
      (x) => !(x.companyId === companyId && x.status === "pending")
    );
    d.items.push(...nextPending);
  };
}

/** Sub-stage of the per-company sync (used by the global "Sync all" UI for progress detail). */
export type SlackSyncStage =
  | "starting"
  | "history"
  | "analyzing"
  | "reconciling"
  | "writing";

export type SlackSyncProgressCallbacks = {
  onStage?: (stage: SlackSyncStage) => void;
  onChannelTotal?: (total: number) => void;
  onChannelStart?: (info: { channelId: string; name: string }) => void;
  onChannelDone?: (info: {
    channelId: string;
    name: string;
    ok: boolean;
    error?: string;
    messageCount?: number;
  }) => void;
};

/**
 * One full run: pre-strip → pass1 → pass2 → replace pending. Mutates the suggestions store.
 */
export async function runSlackSyncPipelineForCompany(
  companyId: string,
  options: {
    days: number;
    includeThreads: boolean;
    onModelTextChunk?: (t: string) => void;
    signal?: AbortSignal;
  } & SlackSyncProgressCallbacks
): Promise<
  | {
      ok: true;
      fresh: SlackScrapeSuggestion[];
      pending: SlackSuggestionRecord[];
    }
  | { ok: false; error: string }
> {
  const {
    onStage,
    onChannelTotal,
    onChannelStart,
    onChannelDone,
  } = options;

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return { ok: false, error: "AI rate limit" };
  }

  const data = await getRepository().load();
  const company = data.companies.find((c) => c.id === companyId);
  if (!company) {
    return { ok: false, error: "Company not found" };
  }

  onStage?.("starting");
  await mutateSlackSuggestions((draft) => {
    stripDefunctPendingForCompany(data, companyId)(draft);
  });

  const { channelIds, error: chErr } = await resolveChannelIdsForCompanySync(
    data,
    companyId
  );
  if (chErr) {
    return { ok: false, error: chErr };
  }
  onChannelTotal?.(channelIds.length);
  if (channelIds.length === 0) {
    onStage?.("writing");
    await mutateSlackSuggestions((draft) => {
      replacePendingForCompany(companyId, [])(draft);
    });
    revalidateTag(ECC_SLACK_SUGGESTIONS_TAG, { expire: 0 });
    return { ok: true, fresh: [], pending: [] };
  }

  const rate2 = await checkAiRateLimit();
  if (!rate2.ok) {
    return { ok: false, error: "AI rate limit (second pass)" };
  }

  try {
    onStage?.("history");
    let modelStreamStarted = false;
    const { suggestions: fresh } = await runSlackRoadmapSyncForCompany({
      companyId,
      channelIds,
      days: options.days,
      includeThreads: options.includeThreads,
      onModelTextChunk: (t) => {
        if (!modelStreamStarted) {
          modelStreamStarted = true;
          onStage?.("analyzing");
        }
        options.onModelTextChunk?.(t);
      },
      onChannelStart,
      onChannelDone,
      trackerData: data,
      signal: options.signal,
    });

    onStage?.("reconciling");
    const dataLive = await getRepository().load();
    const pending = await reconcileSlackSuggestionsForCompany(
      dataLive,
      companyId,
      company.name,
      fresh
    );

    onStage?.("writing");
    await mutateSlackSuggestions((draft) => {
      replacePendingForCompany(companyId, pending)(draft);
    });
    revalidateTag(ECC_SLACK_SUGGESTIONS_TAG, { expire: 0 });

    return { ok: true, fresh, pending };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/**
 * After a manual pass-1 scan: strip defunct, reconcile, replace pending. Uses an extra rate-limit slot.
 */
export async function reconcileAndReplaceFromFresh(
  companyId: string,
  fresh: SlackScrapeSuggestion[]
): Promise<{
  ok: true;
  pending: SlackSuggestionRecord[];
} | { ok: false; error: string }> {
  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return { ok: false, error: "AI rate limit" };
  }

  const data = await getRepository().load();
  const company = data.companies.find((c) => c.id === companyId);
  if (!company) {
    return { ok: false, error: "Company not found" };
  }

  try {
    await mutateSlackSuggestions((draft) => {
      stripDefunctPendingForCompany(data, companyId)(draft);
    });
    const data2 = await getRepository().load();
    const pending = await reconcileSlackSuggestionsForCompany(
      data2,
      companyId,
      company.name,
      fresh
    );
    await mutateSlackSuggestions((draft) => {
      replacePendingForCompany(companyId, pending)(draft);
    });
    revalidateTag(ECC_SLACK_SUGGESTIONS_TAG, { expire: 0 });
    return { ok: true, pending };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/** Fallback if reconciliation fails. */
export function buildPendingRecordsFromFreshOnly(
  companyId: string,
  fresh: SlackScrapeSuggestion[]
): SlackSuggestionRecord[] {
  const t = new Date().toISOString();
  return fresh.map((payload) => {
    const rationaleField =
      "rationale" in payload && typeof (payload as { rationale?: string }).rationale === "string"
        ? (payload as { rationale: string }).rationale
        : "";
    return {
      id: uuid(),
      companyId,
      firstSeenAt: t,
      lastSeenAt: t,
      status: "pending" as const,
      dedupeKey: computeSlackSuggestionDedupeKey(companyId, payload),
      rationale: rationaleField,
      payload,
    };
  });
}
