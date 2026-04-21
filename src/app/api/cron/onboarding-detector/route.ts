import { NextResponse } from "next/server";
import { detectAndCreateNewHiresFromSlack } from "@/server/actions/onboarding/detectNewHires";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function authorize(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured on the server.",
    };
  }
  const auth = request.headers.get("authorization") ?? "";
  const expectedHeader = `Bearer ${expected}`;
  if (auth !== expectedHeader) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized.",
    };
  }
  return { ok: true };
}

/**
 * Vercel Cron: scans Slack MPIMs for Nadav welcome messages and adds new hires to Team.
 * Schedule: see vercel.json (0 3,11,19 * * *).
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not set." },
      { status: 500 }
    );
  }

  try {
    const result = await detectAndCreateNewHiresFromSlack();
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      addedCount: result.added.length,
      added: result.added.map((p) => ({ id: p.id, name: p.name, role: p.role })),
      backfilledCount: result.backfilled.length,
      backfilled: result.backfilled.map((p) => ({
        id: p.id,
        name: p.name,
        joinDate: p.joinDate,
        welcomeSlackChannelId: p.welcomeSlackChannelId,
      })),
      skippedReasonsSample: result.skippedReasons.slice(0, 40),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
