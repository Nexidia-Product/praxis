/**
 * Outcome values admin API.
 *
 *   GET  /api/admin/outcome-values
 *     Returns the current outcome product / type vocabularies.
 *
 *   POST /api/admin/outcome-values
 *     Body: { kind: "product" | "type", value: string }
 *     Appends one value to the stored list (used by the "+ Add new…" option
 *     in the project form's outcome dropdowns). Appending server-side, rather
 *     than replacing the list, keeps two admins' additions from overwriting
 *     each other. Adding a value that already exists (ignoring case) is not an
 *     error: it returns the existing spelling. Responds with both lists and
 *     the value to select.
 *
 *   PUT  /api/admin/outcome-values
 *     Body: { outcome_products: string[], outcome_types: string[] }
 *     Replaces both lists wholesale (the editor batches changes and
 *     posts on Save). Each list is normalized to trimmed, de-duplicated,
 *     non-empty strings.
 *
 * Both require the `admin.project_values.manage` permission — outcome
 * vocabularies are project value lists, same as the enum extensions.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { SettingsRepository } from "@/lib/db";
import { appendOutcomeValue } from "@/lib/projects/outcome-values";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withAuth(async () => {
  await requirePermission("admin.project_values.manage");
  const settings = await SettingsRepository.get();
  return NextResponse.json({
    outcome_products: settings.outcome_products,
    outcome_types: settings.outcome_types,
  });
});

/** Normalize an inbound list: strings only, trimmed, non-empty, unique. */
function normalizeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new Error(`${field} must contain only strings.`);
    }
    const v = raw.trim();
    if (!v) continue;
    if (seen.has(v.toLowerCase())) continue; // case-insensitive de-dupe
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

export const POST = withAuth(async (request: Request) => {
  await requirePermission("admin.project_values.manage");

  let body: { kind?: unknown; value?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (body.kind !== "product" && body.kind !== "type") {
    return NextResponse.json(
      { error: 'kind must be "product" or "type".' },
      { status: 400 },
    );
  }

  const settings = await SettingsRepository.get();
  const current = body.kind === "product" ? settings.outcome_products : settings.outcome_types;
  const result = appendOutcomeValue(current, body.value);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let { outcome_products, outcome_types } = settings;
  if (result.added) {
    if (body.kind === "product") outcome_products = result.list;
    else outcome_types = result.list;
    await SettingsRepository.update({ outcome_products, outcome_types });
  }
  return NextResponse.json({ outcome_products, outcome_types, value: result.value });
});

export const PUT = withAuth(async (request: Request) => {
  await requirePermission("admin.project_values.manage");

  let body: { outcome_products?: unknown; outcome_types?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  let outcome_products: string[];
  let outcome_types: string[];
  try {
    outcome_products = normalizeList(body.outcome_products, "outcome_products");
    outcome_types = normalizeList(body.outcome_types, "outcome_types");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request body." },
      { status: 400 },
    );
  }

  await SettingsRepository.update({ outcome_products, outcome_types });
  return NextResponse.json({ outcome_products, outcome_types });
});
