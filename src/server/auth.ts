import { cookies } from "next/headers";
import { compareSync, hashSync } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE = "ecc_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var is required");
  return new TextEncoder().encode(secret);
}

interface UserCredentials {
  username: string;
  passwordHash: string;
}

function getUsers(): UserCredentials[] {
  const users: UserCredentials[] = [];
  const u1 = process.env.AUTH_USER_1_USERNAME;
  const p1 = process.env.AUTH_USER_1_PASSWORD;
  if (u1 && p1) users.push({ username: u1, passwordHash: hashSync(p1, 10) });

  const u2 = process.env.AUTH_USER_2_USERNAME;
  const p2 = process.env.AUTH_USER_2_PASSWORD;
  if (u2 && p2) users.push({ username: u2, passwordHash: hashSync(p2, 10) });

  return users;
}

export async function authenticate(
  username: string,
  password: string
): Promise<{ success: boolean; username?: string }> {
  const users = getUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return { success: false };
  if (!compareSync(password, user.passwordHash)) return { success: false };

  const token = await new SignJWT({ username })
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

  return { success: true, username };
}

export async function getSession(): Promise<{ username: string } | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.username || typeof payload.username !== "string") return null;
    return { username: payload.username };
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
