import { NextResponse } from "next/server";
import { getRepository } from "@/server/repository";
import { runUnrepliedAsksScan } from "@/server/actions/unrepliedAsks/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function authorize(
  request: Request
): { ok: true } | { ok: false; status: number; error: string } {
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
 * Vercel Cron: classifies new founder Slack messages and refreshes thread reply state.
 * Schedule: see vercel.json (hourly).
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  try {
    const people = await getRepository().getPeople();
    const result = await runUnrepliedAsksScan(people);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      newClassified: result.newClassified,
      threadRefreshes: result.threadRefreshes,
      threadErrors: result.threadErrors,
      founderCount: result.founderCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
