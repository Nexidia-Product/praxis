/**
 * Custom field definitions admin API.
 *
 *   GET   /api/admin/custom-fields            List the registered definitions.
 *   PUT   /api/admin/custom-fields            Replace the full list of
 *                                              definitions in one call.
 *
 * The Admin Console (Section 5.19) lets an Admin add, rename, or remove
 * custom fields that show up on every project form and in the table
 * filters. They live inside `settings.json` because they're org-wide
 * configuration, not per-project data.
 *
 * Replacing the whole list in one PUT is simpler than per-field add /
 * edit / delete endpoints and matches the way the admin form is built —
 * it's a small array, the operator edits all of it locally, and saves
 * once. If the list grows past trivial size we'd reach for individual
 * endpoints, but at team scale this is the right shape.
 *
 * Read access is broader than write: any authenticated user can fetch
 * the definitions (the Projects form needs them to render the right
 * inputs), but only Admins can change them.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import {
  SettingsRepository,
  type CustomFieldDefinition,
  type CustomFieldType,
} from "@/lib/db";

const FIELD_TYPES: CustomFieldType[] = [
  "text",
  "number",
  "date",
  "boolean",
  "select",
];

const KEY_RE = /^[a-z][a-z0-9_]*$/;

export const GET = withAuth(async () => {
  await requireSession();
  const settings = await SettingsRepository.get();
  return NextResponse.json({
    custom_field_definitions: settings.custom_field_definitions,
  });
});

interface PutBody {
  custom_field_definitions?: unknown;
}

export const PUT = withAuth(async (request: Request) => {
  await requirePermission("admin.custom_fields.manage");

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const raw = body.custom_field_definitions;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: "custom_field_definitions must be an array." },
      { status: 400 },
    );
  }

  const seenKeys = new Set<string>();
  const cleaned: CustomFieldDefinition[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "object" || item === null) {
      return NextResponse.json(
        { error: `Definition #${i + 1} must be an object.` },
        { status: 400 },
      );
    }
    const obj = item as Record<string, unknown>;
    const key =
      typeof obj.key === "string" ? obj.key.trim().toLowerCase() : "";
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    const type = typeof obj.type === "string" ? obj.type : "";
    const required = Boolean(obj.required);

    if (!key || !KEY_RE.test(key)) {
      return NextResponse.json(
        {
          error: `Definition #${i + 1}: key must start with a letter and contain only lowercase letters, digits, and underscores.`,
        },
        { status: 400 },
      );
    }
    if (seenKeys.has(key)) {
      return NextResponse.json(
        { error: `Duplicate custom field key: ${key}` },
        { status: 400 },
      );
    }
    seenKeys.add(key);

    if (!label) {
      return NextResponse.json(
        { error: `Definition #${i + 1}: label is required.` },
        { status: 400 },
      );
    }
    if (!FIELD_TYPES.includes(type as CustomFieldType)) {
      return NextResponse.json(
        {
          error: `Definition #${i + 1}: type must be one of ${FIELD_TYPES.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const def: CustomFieldDefinition = {
      key,
      label,
      type: type as CustomFieldType,
      required,
    };
    if (def.type === "select") {
      const options = obj.options;
      if (!Array.isArray(options) || options.length === 0) {
        return NextResponse.json(
          {
            error: `Definition #${i + 1}: select fields require at least one option.`,
          },
          { status: 400 },
        );
      }
      const cleanedOptions: string[] = [];
      for (const o of options) {
        if (typeof o !== "string" || !o.trim()) {
          return NextResponse.json(
            { error: `Definition #${i + 1}: options must be non-empty strings.` },
            { status: 400 },
          );
        }
        cleanedOptions.push(o.trim());
      }
      def.options = cleanedOptions;
    }
    cleaned.push(def);
  }

  const updated = await SettingsRepository.update({
    custom_field_definitions: cleaned,
  });

  // PROJ-18: invalidate the projects page so the new/renamed/removed
  // field shows up on the New Project and Edit Project forms (and in
  // the table filters) without the user having to hard-reload the
  // browser. Without this, the projects page renders from RSC cache
  // and the schema change isn't visible until the cache expires or
  // something else triggers revalidation.
  revalidatePath("/projects");

  return NextResponse.json({
    custom_field_definitions: updated.custom_field_definitions,
  });
});
