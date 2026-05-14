/**
 * Public idea submission endpoint (Section 5.17).
 *
 *   POST /api/public/ideas
 *   Body: {
 *     submitter_name: string,
 *     submitter_email?: string | null,
 *     idea_name: string,
 *     description: string,
 *     urgency: "Low" | "Medium" | "High" | "Critical",
 *     requested_target_date?: string | null,   // YYYY-MM-DD
 *     key_stakeholders?: string,
 *   }
 *
 * Public — no authentication. Allow-listed in `middleware.ts` via the
 * `/api/public/` prefix. Rate-limited to 5 submissions per IP per hour
 * (the figure named in Section 9 Step 11). Validation, the
 * NotFoundError contract, and idea creation all live in
 * `lib/ideas/service.ts`; this route just plumbs HTTP <-> service.
 */

import { NextResponse } from "next/server";

import { submitIdea, ValidationError } from "@/lib/ideas/service";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

const RATE_LIMIT = {
  max: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
} as const;

export async function POST(request: Request): Promise<Response> {
  // Rate-limit BEFORE parsing JSON so a body-flooding attempt costs the
  // attacker the same one slot as a real submission.
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-ideas:${ip}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many submissions from this address. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(RATE_LIMIT.max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(rl.resetsAt / 1000)),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  try {
    const idea = await submitIdea(body);
    // Return only the public-safe view of the record. The submitter
    // doesn't need (and shouldn't have a reason to see) admin_comments
    // or any other internal field.
    return NextResponse.json(
      {
        idea: {
          idea_id: idea.idea_id,
          idea_name: idea.idea_name,
          submitted_at: idea.submitted_at,
          status: idea.status,
        },
      },
      {
        status: 201,
        headers: {
          "X-RateLimit-Limit": String(RATE_LIMIT.max),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(Math.ceil(rl.resetsAt / 1000)),
        },
      },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[public/ideas] unexpected error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
