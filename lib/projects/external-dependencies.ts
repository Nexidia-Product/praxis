/**
 * External dependency validation.
 *
 * Mirrors the shape of `lib/projects/links.ts` and
 * `lib/projects/dependencies.ts`: a pure validator that the project
 * service calls before write. Takes a loose `unknown` payload (the
 * inbound JSON shape isn't pre-narrowed at the API boundary) and
 * returns a fully-typed `ExternalDependency[]` ready to persist.
 *
 * Behavior:
 *
 *   - Each row gets a UUID assigned on create. We preserve existing
 *     `external_dependency_id` values when matched against the prior
 *     persisted state (matching by id) so a UI edit doesn't churn IDs.
 *   - `created_at` and `created_by` are stamped on new rows; preserved
 *     on existing rows (the editor doesn't get to fake provenance).
 *   - `resolved_at` is auto-set when status transitions to "Resolved"
 *     for the first time; cleared when status goes back to non-resolved.
 *   - Free-text fields are trimmed; soft length caps prevent runaway
 *     paste damage but otherwise accept anything.
 *
 * Errors throw `ExternalDependencyValidationError`; the project
 * service translates these to its own `ValidationError`.
 */

import type {
  ExternalDependency,
  ExternalDependencyStatus,
  UserId,
} from "@/lib/db";
import { newUuid, nowIso } from "@/lib/db/store";

const STATUSES: ExternalDependencyStatus[] = ["Open", "In Progress", "Resolved"];

const MAX_LABEL_LEN = 200;
const MAX_DESCRIPTION_LEN = 2000;
const MAX_OWNER_LEN = 200;
const MAX_URL_LEN = 2000;

export class ExternalDependencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalDependencyValidationError";
  }
}

export function validateExternalDependencies(
  raw: unknown,
  existing: ExternalDependency[],
  ctx: { userId: UserId | null; now?: string },
): ExternalDependency[] {
  if (raw === undefined || raw === null) return existing;
  if (!Array.isArray(raw)) {
    throw new ExternalDependencyValidationError(
      "external_dependencies must be an array.",
    );
  }

  const now = ctx.now ?? nowIso();
  const existingById = new Map(
    existing.map((d) => [d.external_dependency_id, d]),
  );

  const out: ExternalDependency[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ExternalDependencyValidationError(
        `external_dependencies[${i}] must be an object.`,
      );
    }
    const e = entry as Record<string, unknown>;

    const label = asTrimmedString(e.label, `external_dependencies[${i}].label`);
    if (!label) {
      throw new ExternalDependencyValidationError(
        `external_dependencies[${i}].label is required.`,
      );
    }
    if (label.length > MAX_LABEL_LEN) {
      throw new ExternalDependencyValidationError(
        `external_dependencies[${i}].label must be ${MAX_LABEL_LEN} chars or fewer.`,
      );
    }

    const description = asTrimmedString(
      e.description,
      `external_dependencies[${i}].description`,
    );
    if (description.length > MAX_DESCRIPTION_LEN) {
      throw new ExternalDependencyValidationError(
        `external_dependencies[${i}].description must be ${MAX_DESCRIPTION_LEN} chars or fewer.`,
      );
    }

    const owner = asTrimmedString(e.owner, `external_dependencies[${i}].owner`);
    if (owner.length > MAX_OWNER_LEN) {
      throw new ExternalDependencyValidationError(
        `external_dependencies[${i}].owner must be ${MAX_OWNER_LEN} chars or fewer.`,
      );
    }

    const url = asNullableTrimmedString(
      e.url,
      `external_dependencies[${i}].url`,
    );
    if (url && url.length > MAX_URL_LEN) {
      throw new ExternalDependencyValidationError(
        `external_dependencies[${i}].url must be ${MAX_URL_LEN} chars or fewer.`,
      );
    }

    const status = asEnum(
      e.status ?? "Open",
      STATUSES,
      `external_dependencies[${i}].status`,
    );
    const target_date = asNullableDate(
      e.target_date,
      `external_dependencies[${i}].target_date`,
    );

    // Preserve provenance from the existing row when matched by id;
    // otherwise this is a new row.
    const incomingId =
      typeof e.external_dependency_id === "string"
        ? e.external_dependency_id
        : null;
    const prior = incomingId ? existingById.get(incomingId) ?? null : null;

    const created_at = prior?.created_at ?? now;
    const created_by = prior?.created_by ?? ctx.userId;

    // resolved_at: track the first moment status flipped to Resolved.
    // Clearing back to Open / In Progress wipes it so the next flip
    // records the new moment. The editor can't set this directly.
    let resolved_at: string | null;
    if (status === "Resolved") {
      resolved_at = prior?.resolved_at ?? now;
    } else {
      resolved_at = null;
    }

    out.push({
      external_dependency_id: prior?.external_dependency_id ?? newUuid(),
      label,
      description,
      owner,
      url,
      status,
      target_date,
      created_at,
      created_by,
      resolved_at,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small coercion helpers
// ---------------------------------------------------------------------------

function asTrimmedString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ExternalDependencyValidationError(
      `${field} must be a string.`,
    );
  }
  return value.trim();
}

function asNullableTrimmedString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const s = asTrimmedString(value, field);
  return s === "" ? null : s;
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new ExternalDependencyValidationError(
      `${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

function asNullableDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ExternalDependencyValidationError(
      `${field} must be an ISO date string or null.`,
    );
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    throw new ExternalDependencyValidationError(
      `${field} must be in YYYY-MM-DD format.`,
    );
  }
  return trimmed.slice(0, 10);
}
