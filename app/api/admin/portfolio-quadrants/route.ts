/**
 * Portfolio quadrants admin API.
 *
 *   GET   /api/admin/portfolio-quadrants   Return the four current labels.
 *   PUT   /api/admin/portfolio-quadrants   Replace the full label set.
 *
 * The four labels (Quick Win / Major Bet / Fill-In / Deprioritize, by
 * default) are surfaced in three places:
 *   - The Projects table's "Position" column
 *   - The Kanban card's strategic-position badge
 *   - The bubble chart's quadrant labels (when on the canonical axes)
 *
 * Renaming a label changes the visible text everywhere; the *bucket
 * each project lands in* is determined by priority × complexity and
 * is not affected. So an admin can rename "Quick Win" to "Easy Wins"
 * without re-bucketing any project.
 *
 * Read access matches the rest of the settings surface — any
 * authenticated user can see the labels because they're rendered in
 * read-only views. Write access requires
 * `admin.portfolio_quadrants.manage`.
 *
 * After a successful PUT we revalidate `/projects` and `/roadmap` so
 * the new labels appear without a full page reload — same idempotent
 * pattern used by `/api/admin/custom-fields/route.ts` (PROJ-18).
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import {
  requirePermission,
  requireSession,
  withAuth,
} from "@/lib/auth/permissions";
import {
  SettingsRepository,
  type PortfolioQuadrantLabels,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// GET — read current labels
// ---------------------------------------------------------------------------

export const GET = withAuth(async () => {
  await requireSession();
  const settings = await SettingsRepository.get();
  return NextResponse.json({
    portfolio_quadrants: settings.portfolio_quadrants,
  });
});

// ---------------------------------------------------------------------------
// PUT — replace the full label set
// ---------------------------------------------------------------------------

const MAX_LABEL_LENGTH = 60; // Arbitrary; long enough for "Quick Wins (FY26)" etc.

function asLabel(raw: unknown, field: string): string {
  if (typeof raw !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error(`${field} cannot be empty.`);
  }
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new Error(
      `${field} must be ${MAX_LABEL_LENGTH} characters or fewer.`,
    );
  }
  return trimmed;
}

export const PUT = withAuth(async (req: Request) => {
  await requirePermission("admin.portfolio_quadrants.manage");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be an object." },
      { status: 400 },
    );
  }

  const obj = body as Record<string, unknown>;
  const raw = obj.portfolio_quadrants;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json(
      { error: "portfolio_quadrants must be an object." },
      { status: 400 },
    );
  }

  const labelsRaw = raw as Record<string, unknown>;
  let cleaned: PortfolioQuadrantLabels;
  try {
    cleaned = {
      quick_win: asLabel(labelsRaw.quick_win, "quick_win"),
      major_bet: asLabel(labelsRaw.major_bet, "major_bet"),
      fill_in: asLabel(labelsRaw.fill_in, "fill_in"),
      deprioritize: asLabel(labelsRaw.deprioritize, "deprioritize"),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid value.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updated = await SettingsRepository.update({
    portfolio_quadrants: cleaned,
  });

  // Renames propagate to every roadmap/project surface, so invalidate
  // both routes. Without this the user has to hard-reload before the
  // new labels show up.
  revalidatePath("/projects");
  revalidatePath("/roadmap");

  return NextResponse.json({
    portfolio_quadrants: updated.portfolio_quadrants,
  });
});
