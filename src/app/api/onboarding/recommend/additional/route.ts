import { NextResponse } from "next/server";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { getSession } from "@/server/auth";
import { recommendAdditionalPilotProposals } from "@/server/actions/onboarding/recommendAdditionalProposals";
import type { NewPilotProjectProposal } from "@/lib/schemas/onboarding";

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
    count?: unknown;
    alreadyProposed?: unknown;
    founderContext?: unknown;
  };

  const personId =
    typeof b.personId === "string" ? b.personId.trim() : "";
  const founderContext =
    typeof b.founderContext === "string" ? b.founderContext : undefined;
  if (!personId) {
    return NextResponse.json(
      { error: "personId is required" },
      { status: 400 }
    );
  }

  const count =
    typeof b.count === "number" && Number.isFinite(b.count)
      ? Math.max(1, Math.min(4, Math.floor(b.count)))
      : undefined;

  const alreadyProposed = Array.isArray(b.alreadyProposed)
    ? (b.alreadyProposed.filter(
        (x): x is NewPilotProjectProposal =>
          !!x &&
          typeof x === "object" &&
          typeof (x as Partial<NewPilotProjectProposal>).suggestedCompanyId ===
            "string" &&
          typeof (x as Partial<NewPilotProjectProposal>).suggestedName ===
            "string"
      ) as NewPilotProjectProposal[])
    : undefined;

  const result = await recommendAdditionalPilotProposals({
    personId,
    count,
    alreadyProposed,
    founderContext,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, proposals: result.proposals });
}
