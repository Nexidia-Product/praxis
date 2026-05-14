/**
 * Shared custom-field filter matcher.
 *
 * Used by the Projects table (client-side `useMemo`) and by the CSV/XLSX
 * export endpoint (server-side request handling) so the two paths can't
 * drift apart. A project that's visible in the table is exactly the
 * project that ends up in the export.
 *
 * Filter shapes by `def.type`:
 *
 *   text     `text`                substring match (case-insensitive)
 *   number   `min` and/or `max`    inclusive numeric range
 *   date     `from` and/or `to`    inclusive YYYY-MM-DD range
 *   boolean  `bool` "yes" | "no"   exact match
 *   select   `values[]`            OR over selected options
 *
 * Empty / undefined filter values are no-ops (the project passes that
 * field's check). This is what makes "Custom" filters opt-in: until you
 * type or pick something, the filter has no effect.
 */

import type {
  CustomFieldDefinition,
  Project,
} from "@/lib/db";

export interface CustomFieldFilterValue {
  text?: string;
  min?: string;
  max?: string;
  from?: string;
  to?: string;
  bool?: "" | "yes" | "no";
  values?: string[];
}

/**
 * True when the project's value for `def.key` passes the filter `f`.
 * Filters with no active fields always pass.
 */
export function customFieldMatches(
  project: Project,
  def: CustomFieldDefinition,
  f: CustomFieldFilterValue | undefined,
): boolean {
  if (!f) return true;
  const raw = project.custom_fields[def.key];

  switch (def.type) {
    case "text": {
      if (!f.text) return true;
      if (raw === null || raw === undefined) return false;
      return String(raw).toLowerCase().includes(f.text.toLowerCase());
    }
    case "number": {
      const min = f.min ? Number(f.min) : null;
      const max = f.max ? Number(f.max) : null;
      if (min === null && max === null) return true;
      if (raw === null || raw === undefined || raw === "") return false;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return false;
      if (min !== null && n < min) return false;
      if (max !== null && n > max) return false;
      return true;
    }
    case "date": {
      if (!f.from && !f.to) return true;
      if (typeof raw !== "string" || !raw) return false;
      // Date strings are ISO YYYY-MM-DD so lexicographic compares == chronological.
      if (f.from && raw < f.from) return false;
      if (f.to && raw > f.to) return false;
      return true;
    }
    case "boolean": {
      if (!f.bool) return true;
      const want = f.bool === "yes";
      return Boolean(raw) === want;
    }
    case "select": {
      if (!f.values || f.values.length === 0) return true;
      if (typeof raw !== "string") return false;
      return f.values.includes(raw);
    }
  }
}
