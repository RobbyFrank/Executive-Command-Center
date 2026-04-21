import type { SlackChannelHistoryMessage } from "@/lib/slack";
import type { SlackScrapeSuggestion } from "@/lib/schemas/tracker";
import type { Person } from "@/lib/types/tracker";

/** Slack mention format: <@U1234567890> or <@U1234567890|name> */
const SLACK_MENTION_RE = /<@(U[A-Z0-9]{10})(?:\|[^>]+)?>/gi;

export function normalizeSlackChannelKey(name: string): string {
  return name.trim().toLowerCase().replace(/^#/, "");
}

/** Lowercase channel name (no #) → Slack channel id */
export function buildChannelNameToIdLookup(
  channelNameById: Map<string, string>
): Map<string, string> {
  const nameToId = new Map<string, string>();
  for (const [id, name] of channelNameById) {
    const k = normalizeSlackChannelKey(name);
    if (k) nameToId.set(k, id);
  }
  return nameToId;
}

export function mergeMessageAuthorsForChannel(
  into: Map<string, string>,
  channelDisplayName: string,
  messages: SlackChannelHistoryMessage[]
): void {
  const chKey = normalizeSlackChannelKey(channelDisplayName);
  for (const m of messages) {
    if (m.user) {
      into.set(`${chKey}::${m.ts}`, m.user);
    }
  }
}

export function extractSlackUserIdsFromText(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(SLACK_MENTION_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]!.toUpperCase());
  }
  return out;
}

export function resolvePersonIdFromSlackUserId(
  slackUserId: string,
  people: Person[]
): string {
  const uid = slackUserId.trim().toUpperCase();
  if (!uid) return "";
  return people.find((p) => (p.slackHandle ?? "").toUpperCase() === uid)?.id ?? "";
}

function resolveGoalSlackChannelFromEvidence(
  evidence: Array<{ channel: string }>,
  nameToId: Map<string, string>,
  idToDisplayName: Map<string, string>
): { slackChannelId: string; slackChannel: string } {
  for (const e of evidence) {
    const id = nameToId.get(normalizeSlackChannelKey(e.channel));
    if (id) {
      const display = idToDisplayName.get(id) ?? e.channel.trim().replace(/^#/, "");
      return { slackChannelId: id, slackChannel: display };
    }
  }
  return { slackChannelId: "", slackChannel: "" };
}

function firstPersonIdFromEvidenceQuotes(
  evidence: Array<{ quote: string }>,
  people: Person[]
): string {
  for (const e of evidence) {
    for (const uid of extractSlackUserIdsFromText(e.quote)) {
      const pid = resolvePersonIdFromSlackUserId(uid, people);
      if (pid) return pid;
    }
  }
  return "";
}

function firstPersonIdFromMessageAuthors(
  evidence: Array<{ channel: string; ts: string }>,
  messageAuthors: Map<string, string>,
  people: Person[]
): string {
  for (const e of evidence) {
    const uid =
      messageAuthors.get(
        `${normalizeSlackChannelKey(e.channel)}::${e.ts.trim()}`
      ) ?? "";
    if (uid) {
      const pid = resolvePersonIdFromSlackUserId(uid, people);
      if (pid) return pid;
    }
  }
  return "";
}

function validPersonId(id: string, people: Person[]): string {
  const t = id.trim();
  return t && people.some((p) => p.id === t) ? t : "";
}

function attachEvidenceMessageAuthors(
  evidence: Array<{ channel: string; ts: string; quote: string }>,
  messageAuthors: Map<string, string>,
  people: Person[]
): void {
  for (const e of evidence) {
    const uid =
      messageAuthors.get(
        `${normalizeSlackChannelKey(e.channel)}::${e.ts.trim()}`
      ) ?? "";
    if (!uid) continue;
    const row = e as {
      authorSlackUserId?: string;
      authorPersonId?: string;
    };
    row.authorSlackUserId = uid;
    const pid = resolvePersonIdFromSlackUserId(uid, people);
    if (pid) row.authorPersonId = pid;
  }
}

/**
 * Resolves Slack channel on new goals from evidence, and fills owner/assignee person ids
 * using model output, @mentions in quotes, or message author lines.
 */
export function enrichSlackScrapeSuggestions(
  suggestions: SlackScrapeSuggestion[],
  options: {
    people: Person[];
    channelNameById: Map<string, string>;
    messageAuthors: Map<string, string>;
  }
): void {
  const nameToId = buildChannelNameToIdLookup(options.channelNameById);
  const idToDisplayName = new Map<string, string>();
  for (const [id, name] of options.channelNameById) {
    idToDisplayName.set(id, name.replace(/^#/, ""));
  }

  for (const s of suggestions) {
    attachEvidenceMessageAuthors(
      s.evidence,
      options.messageAuthors,
      options.people
    );
    const mentionPerson = firstPersonIdFromEvidenceQuotes(
      s.evidence,
      options.people
    );
    const authorPerson = firstPersonIdFromMessageAuthors(
      s.evidence,
      options.messageAuthors,
      options.people
    );

    if (s.kind === "newGoalWithProjects") {
      const ch = resolveGoalSlackChannelFromEvidence(
        s.evidence,
        nameToId,
        idToDisplayName
      );
      s.goal.slackChannelId = ch.slackChannelId;
      s.goal.slackChannel = ch.slackChannel;

      s.goal.ownerPersonId =
        validPersonId(s.goal.ownerPersonId, options.people) ||
        mentionPerson ||
        authorPerson;

      for (const p of s.projects) {
        p.assigneePersonId =
          validPersonId(p.assigneePersonId, options.people) ||
          mentionPerson ||
          authorPerson;
      }
    } else {
      s.project.assigneePersonId =
        validPersonId(s.project.assigneePersonId, options.people) ||
        mentionPerson ||
        authorPerson;
    }
  }
}
