/**
 * Public idea edit endpoint (account-less, capability-token authorized).
 *
 *   PATCH /api/public/ideas/edit
 *   Content-Type: application/json
 *   Body:
 *     token: string (required — the submitter's edit-link capability token)
 *     idea_name?, description?, urgency?, requested_target_date?,
 *     key_stakeholders?   (any subset of the submitter-editable fields)
 *
 * Authorization is the token alone — no session. The token is carried in
 * the JSON body rather than the URL so it doesn't land in access logs or
 * the Referer header. Editing is refused once the idea has been converted
 * to a project (409). Allow-listed in `middleware.ts` via the `/api/public/`
 * prefix. Rate-limited per IP.
 */

import { NextResponse } from "next/server";

import {
  updateIdeaByToken,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "@/lib/ideas/service";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

const RATE_LIMIT = {
  max: 20,
  windowMs: 60 * 60 * 1000, // 1 hour — generous; real editors save a few times
} as const;

export async function PATCH(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-ideas-edit:${ip}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many edits from this address. Please try again later." },
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

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Could not read the request. Please try again." },
      { status: 400 },
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token) {
    return NextResponse.json({ error: "Missing edit token." }, { status: 400 });
  }

  try {
    const idea = await updateIdeaByToken(token, {
      idea_name: body.idea_name,
      description: body.description,
      urgency: body.urgency,
      requested_target_date: body.requested_target_date,
      key_stakeholders: body.key_stakeholders,
    });
    // Public-safe view only — never echo admin_comments or internal fields.
    return NextResponse.json({
      idea: {
        idea_id: idea.idea_id,
        idea_name: idea.idea_name,
        description: idea.description,
        urgency: idea.urgency,
        requested_target_date: idea.requested_target_date,
        key_stakeholders: idea.key_stakeholders,
        status: idea.status,
        submitted_at: idea.submitted_at,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[public/ideas/edit] unexpected error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
