/**
 * Projects export API.
 *
 *   GET /api/projects/export?...                Stream a CSV of the
 *                                                filtered project set
 *                                                (Section 5.1, default).
 *   GET /api/projects/export?format=xlsx&...    Stream an Excel workbook.
 *
 * The Projects page does its filtering in the browser, but the export
 * endpoint accepts the same filter parameters so a downloaded file always
 * matches what the user sees. The query-string shape is the source of
 * truth at `components/projects/filter-bar.tsx#filtersToQueryString`.
 *
 * Filter parameters supported:
 *
 *   status, phase, priority, project_type, project_lead, application_product
 *     repeated `?status=A&status=B`-style multi-select
 *   target_from, target_to, search
 *     single values
 *   cf.<key>.text       custom-field text substring
 *   cf.<key>.min/max    custom-field numeric range
 *   cf.<key>.from/to    custom-field date range
 *   cf.<key>.bool       custom-field boolean ("yes" | "no")
 *   cf.<key>.values     custom-field select multi-value (repeated)
 *
 * Output columns include all built-in Project fields plus one column per
 * registered custom field (whether or not it's filtered on). Both CSV and
 * XLSX use the same set, in the same order, so the two formats are
 * interchangeable downstream.
 *
 * Format choice rationale:
 *
 *   - CSV is the universal default. Plain UTF-8 with a BOM so Excel for
 *     Windows opens accented characters correctly. RFC 4180 quoting.
 *   - XLSX is opt-in via `?format=xlsx`. We use exceljs (already a dep
 *     for the spreadsheet seed import). The workbook keeps native types:
 *     numbers stay numbers, dates stay dates, booleans stay booleans, so
 *     the user can pivot or chart without re-typing columns.
 */

import {
  customFieldMatches,
  type CustomFieldFilterValue,
} from "@/lib/projects/custom-filter";
import { requireSession, withAuth } from "@/lib/auth/permissions";
import {
  ProjectRepository,
  SettingsRepository,
  type CustomFieldDefinition,
  type Project,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface Column {
  header: string;
  /** String value used for CSV. Always returns a string (never null). */
  text: (p: Project) => string;
  /**
   * Native value used for XLSX. May return number, Date, boolean, or
   * string. Falsy/null is rendered as a blank cell.
   */
  native?: (p: Project) => string | number | boolean | Date | null;
  /** XLSX column type hint, used for the column-level number format. */
  numFmt?: string;
}

const BUILTIN_COLUMNS: Column[] = [
  { header: "Project ID", text: (p) => p.project_id },
  { header: "Name", text: (p) => p.name },
  { header: "Application/Product", text: (p) => p.application_product },
  { header: "Type", text: (p) => p.project_type },
  { header: "Status", text: (p) => p.status },
  { header: "Phase", text: (p) => p.phase },
  { header: "Priority", text: (p) => p.priority },
  { header: "Project Lead", text: (p) => p.project_lead },
  {
    header: "Additional Resources",
    text: (p) => p.additional_resources.join("; "),
  },
  {
    header: "Primary Stakeholders",
    text: (p) => p.primary_stakeholders.join("; "),
  },
  {
    header: "Date Added",
    text: (p) => p.date_added,
    native: (p) => (p.date_added ? new Date(p.date_added) : null),
    numFmt: "yyyy-mm-dd",
  },
  {
    header: "Target Date",
    text: (p) => p.target_date ?? "",
    native: (p) => (p.target_date ? new Date(p.target_date) : null),
    numFmt: "yyyy-mm-dd",
  },
  { header: "Health Score", text: (p) => p.health_score ?? "" },
  { header: "AI Complexity", text: (p) => p.ai_complexity_score ?? "" },
  { header: "AI Time Estimate", text: (p) => p.ai_time_estimate ?? "" },
  { header: "Description", text: (p) => p.description },
];

/** Build one Column for each registered custom field definition. */
function customFieldColumns(defs: CustomFieldDefinition[]): Column[] {
  return defs.map<Column>((def) => {
    const get = (p: Project) => p.custom_fields[def.key];
    return {
      header: def.label,
      text: (p) => {
        const v = get(p);
        if (v === null || v === undefined) return "";
        if (typeof v === "boolean") return v ? "Yes" : "No";
        return String(v);
      },
      native: (p) => {
        const v = get(p);
        if (v === null || v === undefined || v === "") return null;
        if (def.type === "number")
          return typeof v === "number" ? v : Number(v);
        if (def.type === "date")
          return typeof v === "string" ? new Date(v) : null;
        if (def.type === "boolean") return Boolean(v);
        return String(v);
      },
      numFmt: def.type === "date" ? "yyyy-mm-dd" : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Filter parsing
// ---------------------------------------------------------------------------

function readMulti(url: URL, key: string): Set<string> {
  const values = url.searchParams.getAll(key);
  return new Set(values.filter((v) => v.length > 0));
}

/** Pull the `cf.<key>.<part>` filter shape out of the query string. */
function readCustomFilters(
  url: URL,
  defs: CustomFieldDefinition[],
): Record<string, CustomFieldFilterValue> {
  const out: Record<string, CustomFieldFilterValue> = {};
  for (const def of defs) {
    const prefix = `cf.${def.key}.`;
    const f: CustomFieldFilterValue = {};
    const text = url.searchParams.get(`${prefix}text`);
    if (text) f.text = text;
    const min = url.searchParams.get(`${prefix}min`);
    if (min) f.min = min;
    const max = url.searchParams.get(`${prefix}max`);
    if (max) f.max = max;
    const from = url.searchParams.get(`${prefix}from`);
    if (from) f.from = from;
    const to = url.searchParams.get(`${prefix}to`);
    if (to) f.to = to;
    const bool = url.searchParams.get(`${prefix}bool`);
    if (bool === "yes" || bool === "no") f.bool = bool;
    const values = url.searchParams.getAll(`${prefix}values`);
    if (values.length > 0) f.values = values;
    out[def.key] = f;
  }
  return out;
}

function applyFilters(
  projects: Project[],
  url: URL,
  customFields: CustomFieldDefinition[],
): Project[] {
  const status = readMulti(url, "status");
  const priority = readMulti(url, "priority");
  const project_type = readMulti(url, "project_type");
  const phase = readMulti(url, "phase");
  const project_lead = readMulti(url, "project_lead");
  const application_product = readMulti(url, "application_product");
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const targetFrom = url.searchParams.get("target_from") ?? "";
  const targetTo = url.searchParams.get("target_to") ?? "";
  const customFilters = readCustomFilters(url, customFields);

  return projects.filter((p) => {
    if (status.size && !status.has(p.status)) return false;
    if (priority.size && !priority.has(p.priority)) return false;
    if (project_type.size && !project_type.has(p.project_type)) return false;
    if (phase.size && !phase.has(p.phase)) return false;
    if (project_lead.size && !project_lead.has(p.project_lead)) return false;
    if (
      application_product.size &&
      !application_product.has(p.application_product)
    ) {
      return false;
    }
    if (targetFrom && (!p.target_date || p.target_date < targetFrom)) {
      return false;
    }
    if (targetTo && (!p.target_date || p.target_date > targetTo)) {
      return false;
    }
    if (search) {
      const haystack =
        `${p.project_id} ${p.name} ${p.description}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    for (const def of customFields) {
      if (!customFieldMatches(p, def, customFilters[def.key])) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(projects: Project[], columns: Column[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(c.header)).join(","));
  for (const p of projects) {
    lines.push(columns.map((c) => csvCell(c.text(p))).join(","));
  }
  // CRLF line endings — friendlier to Excel on Windows. UTF-8 BOM so
  // accented characters render correctly when opened from a fresh
  // download in older Excel versions.
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

async function buildXlsx(
  projects: Project[],
  columns: Column[],
): Promise<Buffer> {
  // Lazy import so the CSV path doesn't pay the exceljs cost. exceljs is
  // already a dependency for the seed importer.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Praxis";
  wb.created = new Date();
  const ws = wb.addWorksheet("Projects", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.header,
    width: Math.min(40, Math.max(12, c.header.length + 4)),
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  for (const p of projects) {
    const row: Record<string, string | number | boolean | Date | null> = {};
    for (const c of columns) {
      row[c.header] = c.native ? c.native(p) : c.text(p);
    }
    ws.addRow(row);
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET = withAuth(async (request: Request) => {
  await requireSession();
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();

  const [all, settings] = await Promise.all([
    ProjectRepository.getAll(),
    SettingsRepository.get(),
  ]);
  const customFields = settings.custom_field_definitions;
  const filtered = applyFilters(all, url, customFields);

  // Stable order so re-exports diff cleanly. The Projects page sort
  // is a UI concern and intentionally not mirrored here.
  filtered.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));

  const columns = [...BUILTIN_COLUMNS, ...customFieldColumns(customFields)];
  const date = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    const buf = await buildXlsx(filtered, columns);
    // Use a Uint8Array view so the runtime typecheck passes — Buffer
    // extends Uint8Array, but the Response body type signature in some
    // Next.js versions narrows to BodyInit which doesn't include Buffer
    // by name.
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="projects-${date}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Default: CSV.
  const body = buildCsv(filtered, columns);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="projects-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
