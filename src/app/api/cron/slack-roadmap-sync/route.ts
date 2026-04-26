import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { logSlackRoadmapSync } from "@/lib/slackRoadmapSyncLog";
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
    const batchId = randomUUID();
    let okCount = 0;
    let failCount = 0;
    logSlackRoadmapSync("info", {
      event: "cron_batch_start",
      logTrigger: "cron",
      batchId,
      companyCount: data.companies.length,
    });
    const results: {
      companyId: string;
      ok: boolean;
      error?: string;
      pendingCount?: number;
    }[] = [];

    for (const c of data.companies) {
      const correlationId = randomUUID();
      const r = await runSlackSyncPipelineForCompany(c.id, {
        days: 2,
        includeThreads: true,
        correlationId,
        logTrigger: "cron",
        batchId,
      });
      if (r.ok) {
        okCount += 1;
        results.push({
          companyId: c.id,
          ok: true,
          pendingCount: r.pending.length,
        });
        logSlackRoadmapSync("info", {
          event: "cron_company_ok",
          logTrigger: "cron",
          batchId,
          correlationId,
          companyId: c.id,
          companyName: c.name,
          pendingCount: r.pending.length,
        });
      } else {
        failCount += 1;
        results.push({
          companyId: c.id,
          ok: false,
          error: r.error,
        });
        logSlackRoadmapSync("error", {
          event: "cron_company_failed",
          logTrigger: "cron",
          batchId,
          correlationId,
          companyId: c.id,
          companyName: c.name,
          error: r.error,
        });
      }
    }

    logSlackRoadmapSync("info", {
      event: "cron_batch_done",
      logTrigger: "cron",
      batchId,
      companyCount: data.companies.length,
      okCount,
      failCount,
    });

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
