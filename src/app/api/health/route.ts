import { NextResponse } from "next/server";
import {
  getSharedRedisClient,
  isKvConfigured,
} from "@/server/repository/tracker-storage";

export const dynamic = "force-dynamic";

/**
 * Liveness / dependency check. Public (no session) for uptime monitors.
 */
export async function GET() {
  if (!isKvConfigured()) {
    return NextResponse.json(
      { ok: false, redis: "not_configured" },
      { status: 503 }
    );
  }

  try {
    const pong = await getSharedRedisClient().ping();
    const up = pong === "PONG";
    return NextResponse.json(
      { ok: up, redis: up ? "up" : "unexpected_response", ping: pong },
      { status: up ? 200 : 503 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, redis: "error", message },
      { status: 503 }
    );
  }
}
