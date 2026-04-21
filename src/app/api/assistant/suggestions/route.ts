import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { getAnthropicModel } from "@/lib/anthropicModel";
import { buildEntityFocusBlock } from "@/lib/assistantEntityFocus";
import {
  aiRateLimitExceededResponse,
  checkAiRateLimit,
} from "@/lib/ai-rate-limit";
import { getRepository } from "@/server/repository";
import { getSharedRedisClient } from "@/server/repository/tracker-storage";
import { redactTrackerForAi } from "@/lib/tracker-redact";

/** Cache TTL for generated suggestions (per tracker revision + entity focus). */
const SUGGESTION_CACHE_TTL_SECONDS = 10 * 60;
/**
 * Redis key prefix. Bump when prompt / schema changes.
 * `v3` = initial 4 + optional `more` batch with exclude list.
 */
const SUGGESTION_CACHE_PREFIX = "ecc:assistant:suggestions:v3";

type EntityFocus = {
  type: "company" | "goal" | "project" | "milestone";
  id: string;
  label: string;
};

type ExcludeEntry = { short: string; full: string };

function parseEntityContext(raw: unknown): EntityFocus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; id?: unknown; label?: unknown };
  if (
    typeof r.type !== "string" ||
    typeof r.id !== "string" ||
    typeof r.label !== "string"
  ) {
    return null;
  }
  if (
    r.type !== "company" &&
    r.type !== "goal" &&
    r.type !== "project" &&
    r.type !== "milestone"
  ) {
    return null;
  }
  return { type: r.type, id: r.id, label: r.label };
}

function parseExcludeList(raw: unknown): ExcludeEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ExcludeEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { short?: unknown; full?: unknown };
    if (typeof o.short !== "string" || typeof o.full !== "string") continue;
    const short = o.short.trim();
    const full = o.full.trim();
    if (!short || !full) continue;
    out.push({ short, full });
  }
  return out.length > 0 ? out : null;
}

function revisionFocusHash(revision: number, focus: EntityFocus | null): string {
  const focusPart = focus ? `${focus.type}:${focus.id}` : "none";
  return createHash("sha1")
    .update(`${revision}|${focusPart}`)
    .digest("hex")
    .slice(0, 16);
}

function excludeShortsHash(exclude: ExcludeEntry[]): string {
  return createHash("sha1")
    .update(
      [...exclude.map((e) => e.short)].sort().join("\0"),
    )
    .digest("hex")
    .slice(0, 16);
}

function cacheKeyInit(revision: number, focus: EntityFocus | null): string {
  return `${SUGGESTION_CACHE_PREFIX}:init:${revisionFocusHash(revision, focus)}`;
}

function cacheKeyMore(
  revision: number,
  focus: EntityFocus | null,
  exclude: ExcludeEntry[],
): string {
  return `${SUGGESTION_CACHE_PREFIX}:more:${revisionFocusHash(revision, focus)}:${excludeShortsHash(exclude)}`;
}

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

const SHARED_RULES = `WHAT "HIGH-SIGNAL" MEANS:
- Decisions that would change what a founder does next week (resource allocation, cut / double-down, hire / fire).
- Risks the data is quietly screaming about: at-risk projects, churn, missed milestones, owner overload, stalled revenue.
- Numerical deltas worth chasing (current value vs target — e.g. churn %, MRR gap, conversion rates, runway).
- Owner / workload imbalances: one person on too many critical paths, goals without owners.
- Strategic trade-offs between companies / goals / projects (where to put the next dollar, the next hire, the next week).
- Executional blockers on flagship items (production bugs, migrations behind schedule).
- Hidden positives worth pressing harder on (projects exceeding target, silent wins).

AVOID:
- Generic questions that don't reference anything specific in the data.
- Summarization questions ("what's the status of X?") — prefer decision questions.
- Repeating the same angle twice. Each question must be a DIFFERENT lens.
- Revealing raw ids, salaries, emails, or internal hashes.

OUTPUT FORMAT — strict:
- Emit one JSON object per line (JSONL). No surrounding array, no prose, no code fences, no numbering.
- Each object MUST have exactly these fields:
  - "short": a 2-5 word punchy label for a UI chip. Examples: "Churn vs $10M exit", "Blake's SMS pipeline", "Prisma P2037 impact", "Voice Broadcasting risk". No trailing punctuation.
  - "full": the full question as the founder would actually ask it, 8-22 words, ends with "?". Name the real company / project / milestone / person from the data. Include the specific number or date when it sharpens the question.
  - "category": one of: "risk" (at-risk, blockers, churn), "growth" (revenue, pipeline, expansion), "team" (owners, workload, hiring), "product" (migrations, launches, features), "strategy" (trade-offs, priorities), "ops" (execution, deadlines, quality).

EXAMPLE (do not copy literally — generate from the actual data):
{"short":"Churn vs $10M exit","full":"Is VoiceDrop's 21.5% monthly churn a dealbreaker for the $10M valuation exit by end of 2026?","category":"risk"}

Hierarchy: Company → Goal → Project → Milestone.`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const b = body && typeof body === "object" ? body : {};
  const focus = parseEntityContext(
    (b as { entityContext?: unknown }).entityContext,
  );
  const more = Boolean((b as { more?: unknown }).more);
  const exclude = more
    ? parseExcludeList((b as { exclude?: unknown }).exclude)
    : null;

  if (more && !exclude) {
    return Response.json(
      { error: "exclude (non-empty array of { short, full }) is required when more is true" },
      { status: 400 },
    );
  }

  const repo = getRepository();
  const data = redactTrackerForAi(await repo.load());
  const redis = getSharedRedisClient();

  const key = more && exclude
    ? cacheKeyMore(data.revision, focus, exclude)
    : cacheKeyInit(data.revision, focus);

  let cached: string | null = null;
  try {
    const raw = await redis.get<string>(key);
    if (typeof raw === "string" && raw.trim().length > 0) {
      cached = raw;
    }
  } catch {
    /* fall through */
  }
  if (cached) {
    return new Response(streamFromString(cached), {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Cache": "HIT",
      },
    });
  }

  const rate = await checkAiRateLimit();
  if (!rate.ok) {
    return aiRateLimitExceededResponse(rate.retryAfterSeconds);
  }

  let focusBlock = "";
  if (focus) {
    focusBlock = `The user opened the assistant on this roadmap item; prefer questions that surface decisions, risks, or next actions for it (but include portfolio-wide questions too when they're sharper):

${buildEntityFocusBlock(data, focus)}

---

`;
  }

  let systemPrompt: string;
  let userMessage: string;
  let maxTokens: number;

  if (more && exclude) {
    const excludeLines = exclude
      .map((e) => `- short: "${e.short}" → full: ${e.full}`)
      .join("\n");
    systemPrompt = `${focusBlock}You are an executive analyst for the MLabs portfolio strategic tracker.

The user already has these suggested questions shown in the UI. Generate **exactly 4 NEW** high-signal questions that are NOT duplicates, NOT trivial rephrases, and NOT the same angle as any of these:

${excludeLines}

${SHARED_RULES}

Tracker data:
${JSON.stringify(data)}`;

    userMessage =
      "Generate exactly 4 new JSONL lines (4 questions). Different angles from the excluded list. Nothing else.";
    maxTokens = 900;
  } else {
    systemPrompt = `${focusBlock}You are an executive analyst for the MLabs portfolio strategic tracker. Generate a set of high-signal questions a founder should be asking RIGHT NOW, grounded in the JSON below.

${SHARED_RULES}

Tracker data:
${JSON.stringify(data)}`;

    userMessage =
      "Generate exactly 4 JSONL lines (4 questions). One JSON object per line. Nothing else.";
    maxTokens = 800;
  }

  const anthropic = new Anthropic({ apiKey });
  const stream = anthropic.messages.stream({
    model: getAnthropicModel(),
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const encoder = new TextEncoder();
  let buffered = "";
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        stream.on("text", (textDelta: string) => {
          buffered += textDelta;
          controller.enqueue(encoder.encode(textDelta));
        });
        await stream.finalText();
        controller.close();
        const trimmed = buffered.trim();
        if (trimmed.length > 0) {
          redis.set(key, trimmed, { ex: SUGGESTION_CACHE_TTL_SECONDS }).catch(
            () => {
              /* ignore */
            },
          );
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Cache": "MISS",
    },
  });
}
