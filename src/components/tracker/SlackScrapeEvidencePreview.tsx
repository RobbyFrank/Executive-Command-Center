"use client";

import { useEffect, useMemo, useState } from "react";
import { Quote } from "lucide-react";
import type { Person } from "@/lib/types/tracker";
import { truncateSlackTextAvoidSplitMentions } from "@/lib/slackDisplay";
import {
  resolveSlackMentionPreviewDisplays,
  type SlackMemberRosterHint,
} from "@/server/actions/slack";
import { SlackDraftMessagePreview } from "./SlackDraftMessagePreview";

export type SlackScrapeEvidenceRow = {
  channel: string;
  ts: string;
  quote: string;
  authorSlackUserId?: string;
  authorPersonId?: string;
};

function slackTsToDate(ts: string): Date {
  const sec = parseFloat(ts);
  if (!Number.isFinite(sec)) return new Date();
  return new Date(Math.floor(sec * 1000));
}

/**
 * Slack-style message card for scrape evidence: author avatar + name (roster or Slack API),
 * timestamp from message `ts`, and body text with mention chips — same building blocks as
 * {@link SlackDraftMessagePreview}.
 */
export function SlackScrapeEvidencePreview({
  evidence,
  people,
  channelLabel,
}: {
  evidence: SlackScrapeEvidenceRow;
  people: Person[];
  /** Channel name without # (shown under the preview). */
  channelLabel?: string;
}) {
  const rosterHints = useMemo((): SlackMemberRosterHint[] => {
    const out: SlackMemberRosterHint[] = [];
    for (const p of people) {
      const id = p.slackHandle?.trim();
      if (!id) continue;
      const row: SlackMemberRosterHint = { slackUserId: id, name: p.name };
      const photo = p.profilePicturePath?.trim();
      if (photo) row.profilePicturePath = photo;
      out.push(row);
    }
    return out;
  }, [people]);

  const rosterHintsSerialized = useMemo(
    () => JSON.stringify(rosterHints),
    [rosterHints]
  );

  const person = useMemo(() => {
    const id = evidence.authorPersonId?.trim();
    if (!id) return null;
    return people.find((p) => p.id === id) ?? null;
  }, [evidence.authorPersonId, people]);

  const slackId = evidence.authorSlackUserId?.trim().toUpperCase() ?? "";

  const [remotePoster, setRemotePoster] = useState<{
    name: string;
    avatarSrc: string | null;
  } | null>(null);

  useEffect(() => {
    if (person) {
      setRemotePoster(null);
      return;
    }
    if (!slackId) {
      setRemotePoster(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await resolveSlackMentionPreviewDisplays(
        [slackId],
        rosterHints
      );
      if (cancelled) return;
      const d = r[slackId];
      if (d) setRemotePoster({ name: d.name, avatarSrc: d.avatarSrc });
      else setRemotePoster({ name: slackId, avatarSrc: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [person, slackId, rosterHintsSerialized]);

  const posterDisplayName = person?.name ?? remotePoster?.name ?? "Unknown";
  const posterAvatarSrc = person
    ? person.profilePicturePath?.trim() || null
    : remotePoster?.avatarSrc ?? null;

  const previewText = useMemo(
    () => truncateSlackTextAvoidSplitMentions(evidence.quote, 220),
    [evidence.quote]
  );

  const postedAt = useMemo(() => slackTsToDate(evidence.ts), [evidence.ts]);

  const ch =
    channelLabel?.replace(/^#/, "").trim() ||
    evidence.channel.replace(/^#/, "").trim();

  return (
    <div className="flex gap-2">
      <Quote
        className="mt-1 h-4 w-4 shrink-0 text-zinc-500 opacity-80"
        strokeWidth={2}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <SlackDraftMessagePreview
          text={previewText}
          people={people}
          rosterHints={rosterHints}
          posterDisplayName={posterDisplayName}
          posterAvatarSrc={posterAvatarSrc}
          postedAt={postedAt}
          compact
        />
        {ch ? (
          <p className="text-[11px] text-zinc-500">#{ch}</p>
        ) : null}
      </div>
    </div>
  );
}
