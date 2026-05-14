/**
 * Ideas collection API.
 *
 *   GET /api/ideas          List all submitted ideas. Admin or Project Lead.
 *
 * Section 4.7 puts idea review in scope for both Admin and Project Lead;
 * the same role check gates the page that consumes this. The middleware
 * has already verified the session exists.
 *
 * Filtering by status is supported via `?status=` for the admin queue
 * page; if the param is missing or invalid we return everything (the
 * client can filter further).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import type { IdeaStatus } from "@/lib/db";
import { listIdeas } from "@/lib/ideas/service";

const VALID_STATUSES: IdeaStatus[] = [
  "New",
  "Under Review",
  "Approved",
  "Rejected",
  "Converted",
];

export const GET = withAuth(async (request: Request) => {
  await requirePermission("ideas.review");
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam && (VALID_STATUSES as string[]).includes(statusParam)
      ? (statusParam as IdeaStatus)
      : undefined;
  const ideas = await listIdeas({ status });
  return NextResponse.json({ ideas });
});
