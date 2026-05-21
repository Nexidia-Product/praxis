/**
 * Public idea submission endpoint (Section 5.17).
 *
 *   POST /api/public/ideas
 *   Content-Type: multipart/form-data
 *   Fields:
 *     submitter_name: string (required)
 *     submitter_email: string | "" (optional)
 *     idea_name: string (required)
 *     description: string (required)
 *     urgency: "Low" | "Medium" | "High" | "Critical"
 *     requested_target_date: "YYYY-MM-DD" | "" (optional)
 *     key_stakeholders: string (optional)
 *     attachments: File[] (optional, up to 5; see lib/ideas/attachments
 *                  for size + MIME constraints)
 *
 * Backwards-compatible with the prior JSON body: when the request's
 * Content-Type is application/json the route falls back to the
 * original parse path (no attachments, body parsed as JSON). Anything
 * else is treated as multipart/form-data.
 *
 * Public — no authentication. Allow-listed in `middleware.ts` via the
 * `/api/public/` prefix. Rate-limited to 5 submissions per IP per
 * hour. Validation, attachment upload, and idea creation all live in
 * `lib/ideas/service.ts`; this route just plumbs HTTP <-> service.
 */

import { NextResponse } from "next/server";

import { submitIdea, ValidationError } from "@/lib/ideas/service";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILES_PER_SUBMISSION,
  type IncomingAttachment,
} from "@/lib/ideas/attachments";

const RATE_LIMIT = {
  max: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
} as const;

export async function POST(request: Request): Promise<Response> {
  // Rate-limit BEFORE parsing the body so a flooding attempt costs
  // the attacker the same one slot as a real submission.
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

  const contentType = request.headers.get("content-type") ?? "";

  let body: Record<string, unknown>;
  let attachments: IncomingAttachment[] = [];

  try {
    if (contentType.startsWith("application/json")) {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "Request body must be a JSON object." },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } else {
      // Default to multipart/form-data. Even if the browser sent
      // something quirky, request.formData() handles the common cases
      // and throws on malformed bodies.
      const form = await request.formData();
      body = {
        submitter_name: form.get("submitter_name") ?? undefined,
        submitter_email: form.get("submitter_email") ?? undefined,
        idea_name: form.get("idea_name") ?? undefined,
        description: form.get("description") ?? undefined,
        urgency: form.get("urgency") ?? undefined,
        requested_target_date:
          form.get("requested_target_date") ?? undefined,
        key_stakeholders: form.get("key_stakeholders") ?? undefined,
      };
      // Collect every form entry whose value looks like a File. We
      // standardize on the field name `attachments` (multiple
      // entries with the same name is how HTML <input multiple>
      // serializes), but tolerate a single `attachment` field too
      // for ad-hoc tools that don't pluralize.
      for (const key of ["attachments", "attachment"]) {
        const values = form.getAll(key);
        for (const v of values) {
          if (typeof v !== "string") {
            // Browser File and the Web `File` type both satisfy
            // IncomingAttachment (name, type, size, arrayBuffer()).
            attachments.push(v as unknown as IncomingAttachment);
          }
        }
      }

      // Quick reject if the count is over the bound; saves a service
      // round-trip for an obvious abuse case. The service does the
      // authoritative check too.
      if (attachments.length > MAX_FILES_PER_SUBMISSION) {
        return NextResponse.json(
          {
            error: `Up to ${MAX_FILES_PER_SUBMISSION} files per submission.`,
          },
          { status: 400 },
        );
      }

      // Short-circuit on unknown MIME types BEFORE handing to the
      // service. The service does this check too; we double-up here
      // so the error message can name the file the browser sent.
      for (const f of attachments) {
        if (!ALLOWED_MIME_TYPES.has(f.type)) {
          return NextResponse.json(
            {
              error: `"${f.name}" has an unsupported file type (${f.type || "unknown"}).`,
            },
            { status: 400 },
          );
        }
      }
    }
  } catch (err) {
    console.error("[public/ideas] body parse failed:", err);
    return NextResponse.json(
      {
        error:
          "Could not read the form. Make sure each attachment is a supported file type and try again.",
      },
      { status: 400 },
    );
  }

  try {
    const idea = await submitIdea(body, attachments);
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
          attachments_count: idea.attachments.length,
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
