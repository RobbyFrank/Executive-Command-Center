import { NextResponse } from "next/server";
import { getRepository } from "@/server/repository";
import { runSlackSyncPipelineForCompany } from "@/server/actions/slackRoadmapSync/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

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
 * Vercel Cron: daily Slack scrape + reconciliation for every company.
 * Schedule: see vercel.json (00:00 UTC).
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
    const data = await getRepository().load();
    const results: {
      companyId: string;
      ok: boolean;
      error?: string;
      pendingCount?: number;
    }[] = [];

    for (const c of data.companies) {
      const r = await runSlackSyncPipelineForCompany(c.id, {
        days: 2,
        includeThreads: true,
      });
      if (r.ok) {
        results.push({
          companyId: c.id,
          ok: true,
          pendingCount: r.pending.length,
        });
      } else {
        results.push({
          companyId: c.id,
          ok: false,
          error: r.error,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      companies: results.length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
