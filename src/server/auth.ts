import { cookies } from "next/headers";
import { compareSync } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getRepository } from "@/server/repository";
import { withFounderDepartmentRules } from "@/lib/autonomyRoster";

const SESSION_COOKIE = "ecc_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var is required");
  return new TextEncoder().encode(secret);
}

export async function authenticate(
  email: string,
  password: string
): Promise<{ success: boolean; personId?: string; email?: string }> {
  const trimmed = email.trim();
  if (!trimmed || !password) return { success: false };

  const emailLower = trimmed.toLowerCase();
  const data = await getRepository().load();
  const person = data.people
    .map((p) => withFounderDepartmentRules(p))
    .find(
      (p) =>
        p.email.trim().toLowerCase() === emailLower &&
        (p.passwordHash ?? "").trim() !== ""
    );

  if (!person) return { success: false };
  if (!compareSync(password, person.passwordHash)) return { success: false };

  const token = await new SignJWT({
    sub: person.id,
    email: person.email.trim(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .setIssuedAt()
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return {
    success: true,
    personId: person.id,
    email: person.email.trim(),
  };
}

export type Session = {
  personId: string;
  email: string;
};

export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    const sub = payload.sub;
    const email = payload.email;
    if (typeof sub !== "string" || !sub.trim()) return null;
    if (typeof email !== "string" || !email.trim()) return null;
    return { personId: sub.trim(), email: email.trim() };
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
