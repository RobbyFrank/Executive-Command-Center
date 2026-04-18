import { NextResponse } from "next/server";
import {
  buildAndSendExecutiveDigest,
  maybePostDigestFailureNotice,
} from "@/server/actions/executiveDigest/buildDigest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow up to 60s for Claude + Slack round-trips.
export const maxDuration = 60;

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
 * Vercel Cron entry point for the daily executive digest.
 * Schedule: see vercel.json (0 12 * * * ≈ 8:00 AM America/New_York).
 *
 * Query params:
 *   - dryRun=1   Build the message but skip posting + state write.
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const url = new URL(request.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dry") === "1";

  try {
    const result = await buildAndSendExecutiveDigest({ dryRun });
    if (!result.ok) {
      await maybePostDigestFailureNotice(`${result.stage}: ${result.error}`);
      return NextResponse.json(
        { ok: false, stage: result.stage, error: result.error },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      posted: result.posted,
      dryRun: result.dryRun,
      bulletCount: result.bulletCount,
      windowMessageCount: result.windowMessageCount,
      droppedDuplicateBulletCount: result.droppedDuplicateBulletCount,
      slackTs: result.slackTs,
      channelId: result.channelId,
      windowStartTs: result.windowStartTs,
      slackText: result.slackText,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await maybePostDigestFailureNotice(`internal: ${message}`);
    return NextResponse.json(
      { ok: false, stage: "internal", error: message },
      { status: 500 }
    );
  }
}
