import { PersonSchema } from "@/lib/schemas/tracker";
import { WelcomeDetectionSchema } from "@/lib/schemas/onboarding";
import { getRepository } from "@/server/repository";
import { claudePlainText } from "@/server/actions/slack/thread-ai-shared";
import {
  fetchAllSlackChannelMessagesForChannel,
  fetchConversationMembers,
  fetchSlackUserById,
  fetchUserMpims,
  getSlackMessagePermalink,
} from "@/lib/slack";
import type { Person } from "@/lib/types/tracker";
import { revalidateTag } from "next/cache";
import { ECC_TRACKER_DATA_TAG } from "@/lib/cache-tags";
import {
  looksLikeSlackGuidelinesOnboardingWelcome,
  SLACK_GUIDELINES_LOOM_URL,
} from "@/lib/onboarding-welcome-signals";

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

function slackTsToYmdUtc(ts: string): string {
  const sec = parseFloat(ts);
  if (!Number.isFinite(sec)) return "";
  const d = new Date(Math.floor(sec * 1000));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractJsonObject(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return raw.trim();
}

const WELCOME_SYSTEM = `You classify Slack messages for MLabs onboarding.
Reply with ONLY a single JSON object (no markdown outside the JSON):
{"isWelcome": boolean, "role": string, "roleConfidence": number}

Rules:
- **Strong signal:** If the message asks the new hire to watch the **Slack communication guidelines** video, especially with this Loom link (${SLACK_GUIDELINES_LOOM_URL}), or phrasing like "Please watch this guideline video for how to work with Slack", set **isWelcome: true** with **roleConfidence** at least 0.9 (unless it is clearly not a new-hire onboarding thread).
- isWelcome: true for other clear initial welcomes to a new team member (e.g. "welcome on board", time tracking setup, @mention to Robby about the new hire).
- isWelcome: false for random coordination, customer DMs, or non-onboarding group chats.
- role: extract the job title or role if the message says things like "will be our X", "join as X", "new SDR", "Chief of Staff". Otherwise "".
- roleConfidence: 0.0 to 1.0 how sure you are about the role string.

Never use an em dash (U+2014); use ASCII hyphens or commas.`;

/**
 * Scans Robby's Slack MPIMs for Nadav welcome messages and either:
 * - **Creates** a new `Person` for an unknown member (1 unknown in the MPIM), OR
 * - **Backfills empty fields** on an existing roster member (0 unknowns + 1 roster member
 *   who is missing `joinDate`, `welcomeSlackUrl`, or `welcomeSlackChannelId`).
 *
 * Backfill is non-destructive: existing non-empty fields are never overwritten.
 */
export async function detectAndCreateNewHiresFromSlack(): Promise<
  | {
      ok: true;
      added: Person[];
      backfilled: Person[];
      skippedReasons: string[];
    }
  | { ok: false; error: string }
> {
  const skippedReasons: string[] = [];
  const added: Person[] = [];
  const backfilled: Person[] = [];

  const repo = getRepository();
  const people = await repo.getPeople();
  const rosterIds = new Set(
    people.map((p) => p.slackHandle.trim().toUpperCase()).filter(Boolean)
  );
  /** Slack user id (uppercase) → roster Person, for cheap lookup when backfilling. */
  const personBySlackId = new Map<string, Person>();
  for (const p of people) {
    const sid = p.slackHandle.trim().toUpperCase();
    if (sid) personBySlackId.set(sid, p);
  }

  const nadav = people.find((p) => p.id === "nadav");
  const robby = people.find((p) => p.id === "robby");
  const nadavSlack = nadav?.slackHandle?.trim().toUpperCase();
  const robbySlack = robby?.slackHandle?.trim().toUpperCase();

  if (!nadavSlack || !robbySlack) {
    return {
      ok: false,
      error:
        "Robby and Nadav must have slackHandle set on their Team records (ids robby, nadav).",
    };
  }

  const mpims = await fetchUserMpims();
  if (!mpims.ok) return mpims;

  for (const ch of mpims.channels) {
    if (!ch.id || !ch.is_mpim) continue;

    const members = await fetchConversationMembers(ch.id);
    if (!members.ok) {
      skippedReasons.push(`${ch.id}: members API ${members.error}`);
      continue;
    }

    /** Non-founder members: split into roster matches and unknowns. */
    const unknown: string[] = [];
    const rosterMatches: Person[] = [];
    for (const m of members.memberIds) {
      if (m === robbySlack || m === nadavSlack) continue;
      const match = personBySlackId.get(m);
      if (match) rosterMatches.push(match);
      else unknown.push(m);
    }

    /**
     * Two valid shapes for an onboarding MPIM:
     *   - **Create:** exactly 1 unknown Slack member (roster matches don't matter; a mentor
     *     or any extra teammate can also be in the channel).
     *   - **Backfill:** 0 unknowns AND exactly 1 roster member (plus Robby+Nadav). When
     *     multiple roster members are present, we can't tell which one is the new hire.
     * Create takes precedence over backfill.
     */
    const isCreateCase = unknown.length === 1;
    const backfillCandidate =
      !isCreateCase &&
      unknown.length === 0 &&
      rosterMatches.length === 1
        ? rosterMatches[0]!
        : null;

    if (!isCreateCase && !backfillCandidate) {
      continue;
    }

    /** Skip cheap when the existing person already has every field we'd set. */
    if (backfillCandidate) {
      const hasJoin = backfillCandidate.joinDate.trim() !== "";
      const hasWelcomeUrl = backfillCandidate.welcomeSlackUrl.trim() !== "";
      const hasWelcomeChannel =
        backfillCandidate.welcomeSlackChannelId.trim() !== "";
      if (hasJoin && hasWelcomeUrl && hasWelcomeChannel) {
        continue;
      }
    }

    const all = await fetchAllSlackChannelMessagesForChannel(ch.id, {
      maxTotal: 800,
    });
    if (!all.ok) {
      skippedReasons.push(`${ch.id}: history ${all.error}`);
      continue;
    }

    let firstNadav: { ts: string; text: string } | null = null;
    for (const msg of all.messages) {
      const st = msg.subtype?.trim() ?? "";
      if (
        st === "channel_join" ||
        st === "channel_leave" ||
        st === "group_join" ||
        st === "group_leave"
      ) {
        continue;
      }
      const uid = msg.user?.trim().toUpperCase();
      if (!uid) continue;
      const text = (msg.text ?? "").trim();
      if (!text) continue;
      if (uid !== nadavSlack) {
        skippedReasons.push(`${ch.id}: first user message not from Nadav`);
        break;
      }
      firstNadav = { ts: msg.ts, text };
      break;
    }

    if (!firstNadav) {
      continue;
    }

    const ageMs =
      Date.now() - Math.floor(parseFloat(firstNadav.ts) * 1000);
    if (ageMs > SIXTY_DAYS_MS) {
      skippedReasons.push(`${ch.id}: welcome older than 60 days`);
      continue;
    }

    let welcomeParsed: ReturnType<typeof WelcomeDetectionSchema.parse>;
    if (looksLikeSlackGuidelinesOnboardingWelcome(firstNadav.text)) {
      welcomeParsed = WelcomeDetectionSchema.parse({
        isWelcome: true,
        role: "",
        roleConfidence: 0.95,
      });
    } else {
      try {
        const aiText = await claudePlainText(
          WELCOME_SYSTEM,
          `Message text:\n${firstNadav.text.slice(0, 4000)}`
        );
        const jsonRaw = extractJsonObject(aiText);
        welcomeParsed = WelcomeDetectionSchema.parse(JSON.parse(jsonRaw));
      } catch (e) {
        skippedReasons.push(
          `${ch.id}: welcome AI ${e instanceof Error ? e.message : String(e)}`
        );
        continue;
      }
    }

    if (!welcomeParsed.isWelcome || welcomeParsed.roleConfidence < 0.6) {
      skippedReasons.push(`${ch.id}: not classified as onboarding welcome`);
      continue;
    }

    const permalink = await getSlackMessagePermalink(ch.id, firstNadav.ts);
    if (!permalink.ok) {
      skippedReasons.push(`${ch.id}: permalink ${permalink.error}`);
      continue;
    }

    const joinYmd = slackTsToYmdUtc(firstNadav.ts);

    if (backfillCandidate) {
      const updates: Partial<Person> = {};
      if (backfillCandidate.joinDate.trim() === "" && joinYmd) {
        updates.joinDate = joinYmd;
      }
      if (backfillCandidate.welcomeSlackUrl.trim() === "") {
        updates.welcomeSlackUrl = permalink.permalink;
      }
      if (backfillCandidate.welcomeSlackChannelId.trim() === "") {
        updates.welcomeSlackChannelId = ch.id;
      }
      /** Only set role if the roster entry has none AND the welcome message extracted one. */
      if (
        (backfillCandidate.role ?? "").trim() === "" &&
        (welcomeParsed.role ?? "").trim() !== ""
      ) {
        updates.role = welcomeParsed.role.trim();
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      try {
        const updated = await repo.updatePerson(
          backfillCandidate.id,
          updates
        );
        backfilled.push(updated);
      } catch (e) {
        skippedReasons.push(
          `${backfillCandidate.id}: backfill save ${e instanceof Error ? e.message : String(e)}`
        );
      }
      continue;
    }

    /** Create branch: look up Slack profile only for brand-new members. */
    const unknownId = unknown[0]!;
    const slackUser = await fetchSlackUserById(unknownId);
    if (!slackUser.ok) {
      skippedReasons.push(`${ch.id}: users.info ${slackUser.error}`);
      continue;
    }

    const member = slackUser.member;
    if (member.deleted || member.isBot) {
      skippedReasons.push(`${ch.id}: user deleted or bot`);
      continue;
    }

    const personId = `slack-${unknownId.toLowerCase()}`;

    const existing = await repo.getPerson(personId);
    if (existing) {
      skippedReasons.push(`${personId}: already exists`);
      continue;
    }

    const rawInput = {
      id: personId,
      name: (member.realName || member.displayName || "New hire").trim(),
      role: (welcomeParsed.role || "").trim(),
      department: "",
      autonomyScore: 0,
      slackHandle: unknownId,
      profilePicturePath: member.avatarUrl?.startsWith("http")
        ? member.avatarUrl
        : "",
      joinDate: joinYmd,
      welcomeSlackUrl: permalink.permalink,
      welcomeSlackChannelId: ch.id,
      email: member.email ?? "",
      phone: "",
      estimatedMonthlySalary: 0,
      employment: "inhouse_salaried" as const,
      passwordHash: "",
    };

    const person = PersonSchema.parse(rawInput);

    try {
      await repo.createPerson(person);
    } catch (e) {
      skippedReasons.push(
        `${personId}: save ${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }

    rosterIds.add(unknownId);
    personBySlackId.set(unknownId, person);
    added.push(person);
  }

  if (added.length > 0 || backfilled.length > 0) {
    revalidateTag(ECC_TRACKER_DATA_TAG, { expire: 0 });
  }

  return { ok: true, added, backfilled, skippedReasons };
}
