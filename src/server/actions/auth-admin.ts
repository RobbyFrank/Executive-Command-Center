"use server";

import { hashSync } from "bcryptjs";
import { updateTag } from "next/cache";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";
import { isFounderPerson } from "@/lib/autonomyRoster";
import { ECC_TRACKER_DATA_TAG } from "@/lib/cache-tags";

const BCRYPT_COST = 10;
const MIN_PASSWORD_LEN = 8;

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
