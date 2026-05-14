/**
 * AI Overlap Check (Section 5.18).
 *
 *   POST /api/ideas/[id]/overlap
 *
 * Returns an analysis of whether the idea overlaps with any existing
 * project. Step 10 (the AI integration routes) is currently skipped in
 * this build, so `aiOverlapAnalysis` runs a deterministic keyword
 * heuristic and clearly labels the result as "AI not yet enabled". When
 * Step 10 is built out later, only the function body in
 * `lib/ideas/service.ts` changes — this route is the same contract
 * either way.
 *
 * The result is cached on the idea record (`ai_overlap_analysis`) so
 * later loads of the idea detail show the prior analysis without re-
 * running the check.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  NotFoundError,
  aiOverlapAnalysis,
} from "@/lib/ideas/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (_request: Request, context: RouteContext) => {
  await requirePermission("ideas.review");
  const { id } = await context.params;

  try {
    const result = await aiOverlapAnalysis(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});
