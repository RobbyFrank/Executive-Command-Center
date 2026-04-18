import type { Person } from "@/lib/types/tracker";

/**
 * Person records returned to the app after stripping auth material from Redis reads.
 * `passwordHash` is always cleared; `loginPasswordSet` reflects storage without exposing the hash.
 */
export type PersonPublic = Person & { loginPasswordSet: boolean };

export function toPublicPerson(person: Person): PersonPublic {
  const raw = (person.passwordHash ?? "").trim();
  const loginPasswordSet = raw.length > 0;
  return {
    ...person,
    passwordHash: "",
    loginPasswordSet,
  };
}
