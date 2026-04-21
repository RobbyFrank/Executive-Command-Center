/**
 * Slack roster enrichment helpers (role/department inference, join-date fallback)
 * powered by `search.messages`. Shared by:
 *  - **Import from Slack** (`importSlackMembers`): newly created rows always start blank.
 *  - **Refresh from Slack** (`refreshPersonFromSlack`, and the bulk action): fills gaps
 *    without overwriting anything the user / other flows already set.
 *
 * Join date: when Slack profile data (`users.profile.get` `start_date`, ISO custom fields)
 * didn't yield a date, we fall back to the user's **oldest** `search.messages` hit. Slack
 * prunes search history on free plans, so this is best-effort; the UI still shows `—`
 * if nothing is recoverable.
 *
 * Role/department: we send the last up-to-50 messages to Claude along with the known
 * department catalog and let it pick (a) one of the existing departments or create a
 * short new one, and (b) a concise role title. We only save when confidence is high
 * enough to be useful.
 */
import {
  fetchSlackUserMessageHistory,
  slackTsToYmdUtc,
  type SlackUserMessageMatch,
} from "@/lib/slack";
import {
  claudePlainText,
  extractJsonObject,
} from "@/server/actions/slack/thread-ai-shared";

export type SlackRoleDepartmentGuess = {
  role: string;
  department: string;
  /** 0-1 — we only persist when confidence ≥ `AI_ROLE_DEPT_MIN_CONFIDENCE`. */
  confidence: number;
};

/**
 * Minimum AI confidence required to persist the role/department guess. Set lower (0.35)
 * than you might expect because Slack messages are often brief ("ok", "lgtm", link dumps)
 * and Claude correctly hedges confidence downward when chatter is thin. The canonicalize
 * step still snaps ambiguous department proposals to existing roster labels, which makes
 * a borderline guess safer than leaving the field blank.
 */
const AI_ROLE_DEPT_MIN_CONFIDENCE = 0.35;

/**
 * Minimum usable messages required before we even ask the AI. We used to require 3 hits,
 * which reliably rejected DM-only new hires (whose manager has only exchanged a handful of
 * 1:1s with them). Drop to 2 — the AI's own confidence score is the real guard rail; when
 * content is too thin it will return low confidence and we'll still skip the save.
 */
const AI_ROLE_DEPT_MIN_MESSAGES = 2;

export type SlackMessageEnrichment = {
  /** Role guess (present only if confident enough to save). */
  role?: string;
  /** Department guess, bucketed into `knownDepartments` when possible. */
  department?: string;
  /** `YYYY-MM-DD` from the oldest search hit. Empty when Slack returned nothing. */
  joinDateFromOldestMessage: string;
  /** Raw message count actually pulled (for debug / logging). */
  messageCount: number;
  /** Human-readable reason the enrichment was skipped (missing scope, zero messages, etc.). */
  note?: string;
};

const ROLE_DEPT_SYSTEM = `You help populate an internal team roster from a person's recent Slack messages.

Some lines are written by **teammates** (tagged "teammate" in the transcript) — e.g. a founder welcoming a new hire in a group DM and stating their title ("Ana will be our Chief Of Staff / Project Manager"). Treat an explicit job title in those lines as **very strong** signal for the roster person's role (use the title they assign; pick the primary segment if they give two titles separated by "/" — e.g. "Chief Of Staff" or combine briefly as "Chief Of Staff / Project Manager" if both are short).

Given the last N relevant messages (their own posts plus messages that @-mention them), infer:
- "role": their likely job title at the company (2-4 words, Title Case). If you genuinely cannot tell, return "".
- "department": which of the listed KNOWN DEPARTMENTS fits best. If none fit, you may return a short new department name (1-2 words, Title Case). If you cannot tell, return "".
- "confidence": 0.0 to 1.0 — how confident you are. Calibrate:
  - 0.8+: strong, specific signal (explicit title mentions, clear role-specific vocabulary repeated across several messages).
  - 0.5-0.7: decent signal — either from channel names (e.g. most messages in #sales, #engineering) OR from message content alone (e.g. repeated role-specific vocabulary: "deal closed", "candidate pipeline", "shipped PR", "design review").
  - 0.35-0.5: weak but non-zero signal — e.g. 1-2 messages hint at a department, channel names suggest a team, or topic-specific vocabulary appears at least once.
  - Below 0.35: honestly cannot tell, return "" for role/department and a low confidence.

Each message is prefixed with a context tag:
- [#channel-name] — public or private channel (the name itself is a strong signal).
- [DM] — 1:1 direct message (channel name is NOT meaningful; judge from CONTENT only).
- [group DM] — small group DM (channel name is NOT meaningful; judge from CONTENT only).
- A trailing "· teammate" means the author is someone else addressing or introducing this person.

Rules:
- Do NOT invent facts that aren't supported by the messages.
- Channel names ARE useful signal — "#sales-team", "#eng-backend", "#marketing-campaigns" strongly hint at department. BUT do not penalize a person for not having channel signal: DM-only content can still clearly indicate role/department (e.g. a new hire DMing their manager about the sales pipeline they're joining).
- Short, factual signals count: a one-line standup "fixed the login bug" → Development / Engineer. "I'll reach out to the candidate tomorrow" → Recruiting / Recruiter.
- When all messages are DMs, rely entirely on content: what topics, tools, teams, customers, candidates, designs, bugs, or deals does the person bring up?
- Ignore small talk and emojis; focus on work content.
- Prefer to make a guess rather than leave blank when you see ANY consistent signal, and set confidence accordingly.
- Never use an em dash (U+2014); use commas, colons, or hyphens.

Respond with EXACTLY one JSON object and no other text (no markdown fences):
{"role": "<title or empty>", "department": "<one of known or new short label or empty>", "confidence": 0.0-1.0}`;

/**
 * Trims a single message to something Claude can digest quickly (keeps signal, drops noise).
 *
 * Critical: DMs / group DMs don't have a meaningful `channelName` — Slack puts the *target
 * user's user ID* in there for 1:1s and a Slack-generated string (e.g. `mpdm-alice-bob-1`)
 * for group DMs. Prepending `#U0123XYZ` to a DM's text was actively misleading the AI
 * (and counted as noise against the real content). We now label the context explicitly
 * so the AI can apply the right heuristic per message type.
 */
function condenseMessage(
  m: SlackUserMessageMatch,
  rosterPersonSlackUserId: string
): string {
  const text = m.text.replace(/\s+/g, " ").trim();
  const snippet = text.length > 400 ? `${text.slice(0, 397)}…` : text;
  let prefix: string;
  switch (m.kind) {
    case "im":
      prefix = "[DM]";
      break;
    case "mpim":
      prefix = "[group DM]";
      break;
    case "group":
      prefix = m.channelName ? `[#${m.channelName}]` : "[private group]";
      break;
    case "channel":
    default:
      prefix = m.channelName ? `[#${m.channelName}]` : "[channel]";
      break;
  }
  const target = rosterPersonSlackUserId.trim().toUpperCase();
  const author = m.authorSlackUserId.trim().toUpperCase();
  const fromTeammate =
    author !== "" && target !== "" && author !== target;
  const authorTag = fromTeammate ? " · teammate" : "";
  return `${prefix}${authorTag} ${snippet}`;
}

async function inferRoleAndDepartmentFromMessages(
  rosterPersonSlackUserId: string,
  messages: SlackUserMessageMatch[],
  knownDepartments: string[]
): Promise<SlackRoleDepartmentGuess | null> {
  const usable = messages
    .filter((m) => m.text.trim().length > 0)
    .slice(-50);
  if (usable.length < AI_ROLE_DEPT_MIN_MESSAGES) {
    console.warn(
      `[slack-enrich] AI skipped: only ${usable.length} messages with text (need ≥${AI_ROLE_DEPT_MIN_MESSAGES}).`
    );
    return null;
  }

  const knownList =
    knownDepartments.length > 0
      ? knownDepartments.map((d) => `- ${d}`).join("\n")
      : "(none yet — feel free to propose a short new one)";

  /** DM-dominant breakdown helps Claude calibrate: if it's ~all DMs, lean on content. */
  const channelCount = usable.filter((m) => m.kind === "channel").length;
  const dmCount = usable.filter(
    (m) => m.kind === "im" || m.kind === "mpim"
  ).length;
  const target = rosterPersonSlackUserId.trim().toUpperCase();
  const teammateLines = usable.filter(
    (m) =>
      m.authorSlackUserId.trim().toUpperCase() !== "" &&
      m.authorSlackUserId.trim().toUpperCase() !== target
  ).length;
  const mixSummary =
    channelCount === 0
      ? `All ${usable.length} messages are DMs (no channel-name signal available — rely on content).`
      : dmCount === 0
        ? `All ${usable.length} messages are in channels.`
        : `${channelCount} channel message(s), ${dmCount} DM/group-DM message(s).`;
  const teammateSummary =
    teammateLines > 0
      ? ` ${teammateLines} line(s) are from teammates (@-mention context — intros count).`
      : "";

  const userPayload = [
    "KNOWN DEPARTMENTS (prefer one of these when it clearly fits):",
    knownList,
    "",
    `Message mix: ${mixSummary}${teammateSummary}`,
    "",
    `Last ${usable.length} relevant messages (most recent last; includes this person's posts and posts that @-mention them):`,
    usable.map((m) => condenseMessage(m, rosterPersonSlackUserId)).join("\n"),
  ].join("\n");

  try {
    const raw = await claudePlainText(ROLE_DEPT_SYSTEM, userPayload);
    const obj = extractJsonObject(raw);
    if (!obj) {
      console.warn(
        `[slack-enrich] AI response could not be parsed as JSON. Raw: ${raw.slice(
          0,
          400
        )}`
      );
      return null;
    }

    const role =
      typeof obj.role === "string" ? obj.role.trim().slice(0, 60) : "";
    const department =
      typeof obj.department === "string"
        ? obj.department.trim().slice(0, 40)
        : "";
    const confidenceRaw =
      typeof obj.confidence === "number" ? obj.confidence : 0;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));

    return { role, department, confidence };
  } catch (e) {
    console.error(
      `[slack-enrich] AI call threw: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return null;
  }
}

/**
 * Best-effort bucket: if Claude returned a department that matches one we already have
 * (case-insensitive), snap to the canonical casing so the filters group correctly.
 */
function canonicalizeDepartment(
  guess: string,
  known: string[]
): string {
  const g = guess.trim();
  if (!g) return "";
  const hit = known.find(
    (k) => k.trim().toLowerCase() === g.toLowerCase()
  );
  return hit ?? g;
}

/**
 * Pulls the person's recent messages and produces an `SlackMessageEnrichment` with:
 *  - `joinDateFromOldestMessage` from the **oldest self-authored** search hit only
 *  - `role` / `department` (only when AI confidence ≥ `AI_ROLE_DEPT_MIN_CONFIDENCE`)
 *
 * Caller decides whether to apply the fields (typically "only when the roster field is blank").
 *
 * This function never throws — on any hard error it returns a populated `note` and empty
 * fields, so callers can safely fall through to their existing save path.
 */
export async function buildSlackMessageEnrichmentForUser(options: {
  slackUserId: string;
  /** Pass true when the roster row's `role` is already set; skips the AI call. */
  skipRoleAndDepartment?: boolean;
  /** Pass true when the roster row's `joinDate` is already set; skips oldest-msg math. */
  skipJoinDate?: boolean;
  /** Department labels already in use on the roster (used to anchor the AI). */
  knownDepartments?: string[];
  /** Max messages to pull from Slack. Default 60. */
  maxMessages?: number;
}): Promise<SlackMessageEnrichment> {
  const { slackUserId } = options;
  const maxMessages = Math.min(Math.max(10, options.maxMessages ?? 60), 200);

  if (options.skipRoleAndDepartment && options.skipJoinDate) {
    return {
      joinDateFromOldestMessage: "",
      messageCount: 0,
      note: "nothing to enrich",
    };
  }

  console.log(
    `[slack-enrich] ${slackUserId}: fetching search.messages (skipRole=${Boolean(
      options.skipRoleAndDepartment
    )} skipJoinDate=${Boolean(options.skipJoinDate)} maxMessages=${maxMessages})`
  );

  const history = await fetchSlackUserMessageHistory(slackUserId, {
    maxMessages,
    skipOldestSweep: options.skipJoinDate === true,
  });
  if (!history.ok) {
    console.warn(
      `[slack-enrich] ${slackUserId}: search.messages FAILED — ${history.error}` +
        (history.missingScope ? " (missingScope)" : "")
    );
    return {
      joinDateFromOldestMessage: "",
      messageCount: 0,
      note: history.error,
    };
  }

  const messages = history.messages;
  console.log(
    `[slack-enrich] ${slackUserId}: search.messages ok, ${messages.length} messages`
  );
  if (messages.length === 0) {
    return {
      joinDateFromOldestMessage: "",
      messageCount: 0,
      note: "Slack returned no matching messages for this user.",
    };
  }

  const uidNorm = slackUserId.trim().toUpperCase();
  const selfAuthored = messages.filter(
    (m) => m.authorSlackUserId.trim().toUpperCase() === uidNorm
  );
  const joinDateFromOldestMessage =
    options.skipJoinDate || selfAuthored.length === 0
      ? ""
      : slackTsToYmdUtc(selfAuthored[0]!.ts);

  let role: string | undefined;
  let department: string | undefined;
  let note: string | undefined;

  if (!options.skipRoleAndDepartment) {
    const guess = await inferRoleAndDepartmentFromMessages(
      slackUserId,
      messages,
      options.knownDepartments ?? []
    );
    if (!guess) {
      note = "AI did not return a usable role/department guess.";
      console.warn(`[slack-enrich] ${slackUserId}: ${note}`);
    } else if (guess.confidence < AI_ROLE_DEPT_MIN_CONFIDENCE) {
      note = `AI role/department confidence too low (${guess.confidence.toFixed(
        2
      )} < ${AI_ROLE_DEPT_MIN_CONFIDENCE}).`;
      console.warn(
        `[slack-enrich] ${slackUserId}: ${note} (proposed role="${guess.role}" dept="${guess.department}")`
      );
    } else {
      if (guess.role) role = guess.role;
      if (guess.department) {
        department = canonicalizeDepartment(
          guess.department,
          options.knownDepartments ?? []
        );
      }
      console.log(
        `[slack-enrich] ${slackUserId}: AI guess confidence=${guess.confidence.toFixed(
          2
        )} role="${role ?? "(none)"}" department="${department ?? "(none)"}"`
      );
    }
  }

  console.log(
    `[slack-enrich] ${slackUserId}: final result role=${role ?? "(none)"} dept=${
      department ?? "(none)"
    } joinDate=${joinDateFromOldestMessage || "(none)"}`
  );

  return {
    role,
    department,
    joinDateFromOldestMessage,
    messageCount: messages.length,
    note,
  };
}
