/**
 * Project values admin API.
 *
 *   GET  /api/admin/project-values
 *     Returns merged option lists (system + extensions, including
 *     archived) for all four extensible enums, plus the raw extension
 *     entries so the UI can present "edit" controls only for the
 *     ones that came from extensions.
 *
 *   PUT  /api/admin/project-values
 *     Body: { enum_extensions: EnumExtensionsMap }
 *     Replaces `settings.enum_extensions` wholesale. We don't expose
 *     finer-grained "add one" / "archive one" endpoints because the
 *     editor batches changes and posts them on Save — fewer round-trips
 *     and a single point where validation runs.
 *
 * Both endpoints require the `admin.project_values.manage` permission.
 *
 * Validation on PUT:
 *
 *   - Each entry under each key must have a non-empty `id` and `label`.
 *   - IDs must be unique within an enum (across both system and
 *     extension entries — an admin can't shadow "In Progress").
 *   - System IDs cannot be redefined as extensions; the system list
 *     is the source of truth for those.
 *   - Per-enum metadata is type-checked: `is_open`/`is_terminal` must
 *     be boolean if present; `rank`/`order` must be a finite number.
 *
 * On any validation failure the entire payload is rejected (400) and
 * the existing settings are unchanged — no partial writes.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  SettingsRepository,
  type EnumExtension,
  type EnumExtensionsMap,
  type ExtensibleEnumKey,
} from "@/lib/db";
import {
  isSystemEnumValue,
  mergeEnumOptions,
} from "@/lib/projects/enum-options";

const ENUM_KEYS: ExtensibleEnumKey[] = [
  "status",
  "phase",
  "priority",
  "application_product",
];

export const GET = withAuth(async () => {
  await requirePermission("admin.project_values.manage");
  const settings = await SettingsRepository.get();

  const merged = {
    status: mergeEnumOptions(
      "status",
      settings.enum_extensions.status,
      true,
    ),
    phase: mergeEnumOptions("phase", settings.enum_extensions.phase, true),
    priority: mergeEnumOptions(
      "priority",
      settings.enum_extensions.priority,
      true,
    ),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
      true,
    ),
  };

  return NextResponse.json({
    options: merged,
    extensions: settings.enum_extensions,
  });
});

interface PutBody {
  enum_extensions?: unknown;
}

export const PUT = withAuth(async (request: Request) => {
  const session = await requirePermission("admin.project_values.manage");

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (
    !body.enum_extensions ||
    typeof body.enum_extensions !== "object" ||
    Array.isArray(body.enum_extensions)
  ) {
    return NextResponse.json(
      { error: "`enum_extensions` is required." },
      { status: 400 },
    );
  }

  const raw = body.enum_extensions as Record<string, unknown>;

  // Validate and normalize each enum's array. Reject the entire
  // payload on any per-entry failure — partial saves of an enum
  // editor are confusing and rarely useful.
  const validated: EnumExtensionsMap = {
    status: [],
    phase: [],
    priority: [],
    application_product: [],
  };

  for (const enumKey of ENUM_KEYS) {
    const arr = raw[enumKey];
    if (arr === undefined) continue; // Treat missing key as "no changes".
    if (!Array.isArray(arr)) {
      return NextResponse.json(
        { error: `${enumKey} must be an array.` },
        { status: 400 },
      );
    }

    const seenIds = new Set<string>();
    const out: EnumExtension[] = [];

    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i] as Record<string, unknown>;
      if (!entry || typeof entry !== "object") {
        return NextResponse.json(
          { error: `${enumKey}[${i}] is not an object.` },
          { status: 400 },
        );
      }

      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const label =
        typeof entry.label === "string" ? entry.label.trim() : "";

      if (!id || !label) {
        return NextResponse.json(
          { error: `${enumKey}[${i}] must have non-empty id and label.` },
          { status: 400 },
        );
      }
      if (seenIds.has(id)) {
        return NextResponse.json(
          {
            error: `${enumKey}: duplicate id "${id}". Each value needs a unique id.`,
          },
          { status: 400 },
        );
      }
      if (isSystemEnumValue(enumKey, id)) {
        return NextResponse.json(
          {
            error: `${enumKey}: "${id}" is a built-in value and cannot be redefined as an extension.`,
          },
          { status: 400 },
        );
      }
      seenIds.add(id);

      const ext: EnumExtension = {
        id,
        label,
        archived: entry.archived === true,
        created_by:
          typeof entry.created_by === "string"
            ? entry.created_by
            : (session.user?.user_id ?? null),
        created_at:
          typeof entry.created_at === "string"
            ? entry.created_at
            : new Date().toISOString(),
      };

      if (typeof entry.description === "string") {
        ext.description = entry.description;
      }

      // Per-enum metadata. Validate types; ignore stray fields.
      if (enumKey === "status") {
        if (entry.is_open !== undefined) {
          if (typeof entry.is_open !== "boolean") {
            return invalid(`${enumKey}[${i}].is_open must be a boolean.`);
          }
          ext.is_open = entry.is_open;
        }
        if (entry.is_terminal !== undefined) {
          if (typeof entry.is_terminal !== "boolean") {
            return invalid(`${enumKey}[${i}].is_terminal must be a boolean.`);
          }
          ext.is_terminal = entry.is_terminal;
        }
      }
      if (enumKey === "priority") {
        if (entry.rank !== undefined) {
          if (typeof entry.rank !== "number" || !Number.isFinite(entry.rank)) {
            return invalid(`${enumKey}[${i}].rank must be a finite number.`);
          }
          ext.rank = entry.rank;
        }
      }
      if (enumKey === "phase") {
        if (entry.order !== undefined) {
          if (typeof entry.order !== "number" || !Number.isFinite(entry.order)) {
            return invalid(`${enumKey}[${i}].order must be a finite number.`);
          }
          ext.order = entry.order;
        }
      }

      out.push(ext);
    }

    validated[enumKey] = out;
  }

  // Persist. SettingsRepository.update merges, so other settings (health
  // thresholds, branding, etc.) remain untouched.
  await SettingsRepository.update({ enum_extensions: validated });

  // Return the same shape as GET so the UI can update without a re-fetch.
  return NextResponse.json({
    options: {
      status: mergeEnumOptions("status", validated.status, true),
      phase: mergeEnumOptions("phase", validated.phase, true),
      priority: mergeEnumOptions("priority", validated.priority, true),
      application_product: mergeEnumOptions(
        "application_product",
        validated.application_product,
        true,
      ),
    },
    extensions: validated,
  });
});

function invalid(message: string): Response {
  return NextResponse.json({ error: message }, { status: 400 });
}
