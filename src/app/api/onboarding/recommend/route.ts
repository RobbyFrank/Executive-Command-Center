import { NextResponse } from "next/server";
import { recommendPilotProject } from "@/server/actions/onboarding/recommendPilotProject";
import { recommendOnboardingBuddies } from "@/server/actions/onboarding/recommendBuddies";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { getSession } from "@/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return aiRateLimitExceededResponse(rate.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as {
    personId?: unknown;
    founderContext?: unknown;
  };
  const personId = typeof b.personId === "string" ? b.personId.trim() : "";
  const founderContext =
    typeof b.founderContext === "string" ? b.founderContext : undefined;

  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  const [pilotResult, buddyResult] = await Promise.all([
    recommendPilotProject(personId, { founderContext }),
    recommendOnboardingBuddies({ personId, founderContext }),
  ]);

  if (!pilotResult.ok) {
    return NextResponse.json({ error: pilotResult.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    recommendation: pilotResult.recommendation,
    /** Optional: buddies may legitimately be empty for tiny rosters. */
    buddies: buddyResult.ok ? buddyResult.recommendation : null,
    buddiesError: buddyResult.ok ? undefined : buddyResult.error,
  });
}
