import { Ratelimit } from "@upstash/ratelimit";
import { headers } from "next/headers";
import { getSharedRedisClient } from "@/server/repository/tracker-storage";
import { getSession } from "@/server/auth";

let ratelimit: Ratelimit | null = null;

function getAiRatelimit(): Ratelimit {
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: getSharedRedisClient(),
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      prefix: "@ecc/ai",
    });
  }
  return ratelimit;
}

async function rateLimitIdentifier(): Promise<string> {
  const session = await getSession();
  if (session?.personId) return `user:${session.personId}`;
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  return `ip:${ip}`;
}

export type AiRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Limits Anthropic-backed routes per signed-in user (or per IP if session missing).
 * Requires Redis (same as tracker storage).
 */
export async function checkAiRateLimit(): Promise<AiRateLimitResult> {
  const id = await rateLimitIdentifier();
  const { success, reset } = await getAiRatelimit().limit(id);
  if (success) return { ok: true };
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((reset - Date.now()) / 1000)
  );
  return { ok: false, retryAfterSeconds };
}

export function aiRateLimitExceededResponse(
  retryAfterSeconds: number
): Response {
  return Response.json(
    { error: "Too many requests. Try again in a moment." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    }
  );
}
