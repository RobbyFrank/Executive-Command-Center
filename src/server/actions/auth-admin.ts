"use server";

import { hashSync } from "bcryptjs";
import { updateTag } from "next/cache";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";
import { isFounderPerson } from "@/lib/autonomyRoster";
import { ECC_TRACKER_DATA_TAG } from "@/lib/cache-tags";
import {
  buildLoginSlackMessage,
  trimSlackUserId,
} from "@/lib/loginSlackMessage";
import { openSlackMpim, postSlackChannelMessage } from "@/lib/slack";

const BCRYPT_COST = 10;
const MIN_PASSWORD_LEN = 8;
/** Length of auto-generated login passwords delivered via Slack. */
const GENERATED_PASSWORD_LEN = 24;

export type SetPersonPasswordResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Set or clear a team member's app login password (bcrypt hash stored in tracker JSON).
 * Only founders may call this. Clears login when `newPassword` is null or empty string.
 */
export async function setPersonPassword(
  personId: string,
  newPassword: string | null
): Promise<SetPersonPasswordResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const repo = getRepository();
  const caller = await repo.getPerson(session.personId);
  if (!caller || !isFounderPerson(caller)) {
    return { ok: false, error: "Only founders can manage login passwords." };
  }

  const data = await repo.load();
  const rawPerson = data.people.find((p) => p.id === personId);
  if (!rawPerson) return { ok: false, error: "Person not found" };

  const email = rawPerson.email?.trim() ?? "";
  if (!email) {
    return {
      ok: false,
      error: "Add a work email before setting a password.",
    };
  }

  const clear =
    newPassword === null ||
    (typeof newPassword === "string" && newPassword.trim() === "");

  if (clear) {
    if (isFounderPerson(rawPerson)) {
      return {
        ok: false,
        error: "Cannot remove login access for a founder.",
      };
    }
    await repo.updatePerson(personId, { passwordHash: "" });
    updateTag(ECC_TRACKER_DATA_TAG);
    return { ok: true };
  }

  if (newPassword.length < MIN_PASSWORD_LEN) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LEN} characters.`,
    };
  }

  const passwordHash = hashSync(newPassword, BCRYPT_COST);
  await repo.updatePerson(personId, { passwordHash });
  updateTag(ECC_TRACKER_DATA_TAG);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Slack-delivered login credentials (Create login / Send new password)
// ---------------------------------------------------------------------------

export type SendLoginViaSlackResult =
  | { ok: true; permalink?: string }
  | { ok: false; error: string };

/**
 * Character set for generated login passwords. Excludes ambiguous chars (0/O, 1/l/I) so
 * recipients can hand-copy if Slack re-flow breaks the code block. `rng()` uses
 * `crypto.getRandomValues` via Node's Web Crypto global.
 */
const PW_CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";

function generateStrongPassword(length = GENERATED_PASSWORD_LEN): string {
  const chars = PW_CHARSET;
  const out = new Array<string>(length);
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  for (let i = 0; i < length; i++) {
    out[i] = chars[buf[i] % chars.length]!;
  }
  return out.join("");
}

/**
 * Looks up Nadav's Slack user id from the roster. Prefers legacy `id === "nadav"`, then
 * any founder whose name starts with "nadav", then the `NADAV_SLACK_USER_ID` env override.
 * Mirrors {@link resolveNadavSlackUserId} used in onboarding so the team roster and
 * buddy DM flows agree on who gets CC'd.
 */
async function resolveNadavSlackUserId(): Promise<string> {
  const repo = getRepository();
  const people = await repo.getPeople();
  const direct = people.find((p) => p.id === "nadav");
  const directHandle = trimSlackUserId(direct?.slackHandle);
  if (directHandle) return directHandle;

  const founderNadav = people.find(
    (p) =>
      isFounderPerson(p) && p.name.trim().toLowerCase().startsWith("nadav")
  );
  const founderHandle = trimSlackUserId(founderNadav?.slackHandle);
  if (founderHandle) return founderHandle;

  return trimSlackUserId(process.env.NADAV_SLACK_USER_ID);
}

/**
 * Shared path used by "Create login" and "Send new password":
 *  1. Verify caller is a founder.
 *  2. Generate a strong password, hash+store it on the target person.
 *  3. Open an MPIM with Nadav + the target (caller is auto-added by Slack user token).
 *  4. Post a message that @-mentions the target (`<@USER_ID>`), plus email + password
 *     (password wrapped in `…` code span).
 *
 * Returns a Slack permalink when `chat.getPermalink` succeeds. If Slack posting fails but
 * the hash was already saved, the password hash is rolled back so the recipient is never
 * stranded with a password they did not receive.
 */
async function sendLoginCredentialsViaSlack(
  personId: string,
  isResend: boolean
): Promise<SendLoginViaSlackResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const repo = getRepository();
  const caller = await repo.getPerson(session.personId);
  if (!caller || !isFounderPerson(caller)) {
    return { ok: false, error: "Only founders can manage login passwords." };
  }

  /**
   * Read the **raw** tracker JSON (not `repo.getPerson`) because `toPublicPerson`
   * blanks `passwordHash` on public reads; we need the real hash to roll back cleanly
   * if Slack delivery fails.
   */
  const data = await repo.load();
  const target = data.people.find((p) => p.id === personId);
  if (!target) return { ok: false, error: "Person not found" };

  const email = target.email?.trim() ?? "";
  if (!email) {
    return {
      ok: false,
      error: "Add a work email before sending a login.",
    };
  }

  const targetSlackId = trimSlackUserId(target.slackHandle);
  if (!targetSlackId) {
    return {
      ok: false,
      error:
        "Add this person's Slack user ID in the Slack column before sending a login.",
    };
  }

  /** Pre-flight Slack config/scope check before we mutate the stored hash. */
  const nadavSlackId = await resolveNadavSlackUserId();
  const participantIds = [targetSlackId];
  /** Only include Nadav when he is not the target and we have his id; caller is implicit. */
  if (nadavSlackId && nadavSlackId !== targetSlackId) {
    participantIds.push(nadavSlackId);
  }

  const opened = await openSlackMpim(participantIds);
  if (!opened.ok) {
    return { ok: false, error: opened.error };
  }

  const password = generateStrongPassword();
  const passwordHash = hashSync(password, BCRYPT_COST);
  /** Raw pre-existing hash (may be empty). Restored verbatim on Slack post failure. */
  const previousHash = target.passwordHash ?? "";

  await repo.updatePerson(personId, { passwordHash });
  updateTag(ECC_TRACKER_DATA_TAG);

  const message = buildLoginSlackMessage({
    targetSlackUserId: targetSlackId,
    email,
    password,
    isResend,
  });

  const posted = await postSlackChannelMessage(opened.channelId, message);
  if (!posted.ok) {
    await repo.updatePerson(personId, { passwordHash: previousHash });
    updateTag(ECC_TRACKER_DATA_TAG);
    return { ok: false, error: posted.error };
  }

  return { ok: true };
}

/**
 * Generates a strong password, saves the bcrypt hash on the target, and sends the
 * credentials via a Slack group DM (Robby + Nadav + target).
 */
export async function createPersonLoginAndSendViaSlack(
  personId: string
): Promise<SendLoginViaSlackResult> {
  return sendLoginCredentialsViaSlack(personId, /* isResend */ false);
}

/**
 * Replaces the target's login password with a fresh one and re-delivers it via the
 * same Slack group DM path as `createPersonLoginAndSendViaSlack`.
 */
export async function resendPersonLoginViaSlack(
  personId: string
): Promise<SendLoginViaSlackResult> {
  return sendLoginCredentialsViaSlack(personId, /* isResend */ true);
}
