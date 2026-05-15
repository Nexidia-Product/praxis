/**
 * One-time data migration: import the existing Tiger Team spreadsheet
 * into the JSON store. Per the design document (Section 9, Step 12), this
 * is the migration path from spreadsheet-as-system-of-record to the IIM
 * application.
 *
 * Usage:
 *   npm run seed
 *
 * Environment overrides:
 *   IIM_DATA_DIR        Override the default ./data target directory.
 *   IIM_SEED_SOURCE     Path to the .xlsx file. Defaults to the project's
 *                       canonical location: ./Tiger_Team_Projects.xlsx, then
 *                       /mnt/project/Tiger_Team_Projects.xlsx as a fallback.
 *   IIM_ADMIN_EMAIL     Email for the default Admin user. Defaults to
 *                       admin@example.com — change this for any deployment
 *                       you actually intend to expose.
 *   IIM_ADMIN_PASSWORD  Plaintext password for the default Admin. Defaults
 *                       to "ChangeMe!2026". Will be hashed with bcrypt
 *                       before being written. The default is documented in
 *                       the README so the team knows to rotate it.
 *   IIM_ADMIN_NAME      Display name for the default Admin. Defaults to
 *                       "Default Admin".
 *
 * Re-run behavior: WIPE AND REPLACE. Every run truncates every JSON file
 * and rewrites it from the spreadsheet. The spreadsheet is the source of
 * truth until the IIM app goes live (per Section 9, Step 12).
 *
 * Spreadsheet not on disk? The script falls back to the pre-built
 * snapshot under `data/seed/` (committed to version control by Step 1
 * specifically for this case). The fallback path produces a usable
 * `data/` folder including the default admin user — the only thing it
 * misses is changes made in the spreadsheet since the snapshot was
 * taken. To refresh: place the spreadsheet at the repo root or set
 * `IIM_SEED_SOURCE`, then re-run.
 *
 * Behavior on data quality issues:
 *   - Blank trailing rows in either sheet (an ID with no name) are skipped
 *     silently — they're a known artifact of the spreadsheet.
 *   - If any task references a project name not present in the Projects
 *     sheet, the script prints every offender and exits non-zero WITHOUT
 *     writing anything. The spreadsheet must be fixed first.
 *
 * What this script does:
 *   - Imports projects and tasks from the spreadsheet.
 *   - Collects unresolved human names into data/seed/users-to-invite.json.
 *   - Creates ONE default Admin user (Section 9, Step 2) so the application
 *     is accessible on first run. Other users are added by the Admin
 *     through the Manage Users UI.
 *
 * What this script does NOT do:
 *   - It does NOT resolve "Min" / "Josh" / etc. to user IDs. Those names
 *     stay as plain strings in `project_lead`, `additional_resources`,
 *     and `responsible`, and surface in `data/seed/users-to-invite.json`
 *     as a checklist for the Admin.
 *   - It does NOT populate AI fields, health scores, dependencies,
 *     roadmap buckets, or document links. Those are post-migration
 *     concerns — leaving them empty is correct.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

import type {
  IdeaStatus,
  IdeaUrgency,
  NotificationPreferences,
  Priority,
  Project,
  ProjectId,
  ProjectIdea,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
  Task,
  TaskStatus,
  User,
} from "../lib/db/types";
import { PROJECT_TYPES as CANONICAL_PROJECT_TYPES } from "../lib/projects/display";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const DATA_DIR = process.env.IIM_DATA_DIR ?? path.join(REPO_ROOT, "data");
const SEED_DIR = path.join(DATA_DIR, "seed");

const SOURCE_CANDIDATES = [
  process.env.IIM_SEED_SOURCE,
  path.join(REPO_ROOT, "Tiger_Team_Projects.xlsx"),
  "/mnt/project/Tiger_Team_Projects.xlsx",
].filter((p): p is string => Boolean(p));

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

/**
 * ExcelJS exposes cell values as primitives, dates, formula objects, or
 * rich-text objects. Coerce to a clean string. Empty / NaN / `null` collapse
 * to `""` so downstream code can use `.trim()` without guarding.
 */
function asString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isNaN(value) ? "" : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  // ExcelJS rich-text and formula shapes both expose a string-friendly form:
  if (typeof value === "object" && value !== null) {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
    if ("result" in value) return asString(value.result as ExcelJS.CellValue);
  }
  return "";
}

/** Empty/missing cell → `null`. Date cell → ISO date (`YYYY-MM-DD`). */
function asDateOrNull(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = asString(value);
  if (str === "") return null;
  // The spreadsheet stores dates as Date instances, so this branch
  // shouldn't fire in practice — but if a manual entry slips through as
  // text, attempt to parse it rather than guess at the format.
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Splits "Brett, Jeremy, Presales Team" → ["Brett", "Jeremy", "Presales Team"]. */
function splitList(value: ExcelJS.CellValue): string[] {
  const str = asString(value);
  if (str === "") return [];
  return str
    .split(/[,/]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function asYesNo(value: ExcelJS.CellValue): boolean {
  return asString(value).toLowerCase() === "yes";
}

/**
 * Parse the "Time Estimate (in Hours)" cell into a number or null. The
 * spreadsheet contains a mix of:
 *   - Blank cells                 → null
 *   - Single numbers (3, 1.5)     → that number
 *   - Numeric strings ("3", "1.5") → that number
 *   - Ranges ("48 to 64")         → the midpoint, with a warning
 *   - Anything else               → null, with a warning
 *
 * Ranges are coerced rather than rejected because four real tasks in
 * the seed file use them and rejecting would drop the data entirely.
 * The midpoint is the most informationally honest reading — high end
 * would be conservative, low end optimistic, midpoint is neutral.
 *
 * Out-of-range values (negative, > 999) are clamped to null with a
 * warning so the import doesn't fail validation downstream.
 */
function asEstimateHours(
  value: ExcelJS.CellValue,
  warnings: string[],
  ctx: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 999) return null;
    return value;
  }
  const str = asString(value);
  if (str === "") return null;
  // Range: "48 to 64", "32-40", "8 - 16". Allow a few separators so
  // minor formatting drift in the spreadsheet still parses.
  const rangeMatch = str.match(
    /^\s*(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*$/i,
  );
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const mid = (lo + hi) / 2;
    if (mid < 0 || mid > 999) return null;
    warnings.push(
      `${ctx}: time estimate "${str}" interpreted as midpoint ${mid}h.`,
    );
    return mid;
  }
  // Plain numeric string.
  const n = Number(str);
  if (Number.isFinite(n) && n >= 0 && n <= 999) return n;
  warnings.push(
    `${ctx}: time estimate "${str}" not recognized; importing as null.`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// Enum coercion (defensive — Section 4 enums match the spreadsheet exactly,
// but we still guard so a typo in a future edit produces a clean error).
// ---------------------------------------------------------------------------

const PROJECT_TYPES: ReadonlySet<ProjectType> = new Set(
  CANONICAL_PROJECT_TYPES,
);
const PRIORITIES: ReadonlySet<Priority> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
]);
const PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
  "Completed",
  "Canceled",
]);
const PROJECT_PHASES: ReadonlySet<ProjectPhase> = new Set([
  "Qualification",
  "Prioritization",
  "Planning",
  "Data Modeling",
  "Application Development",
  "Customer Validation",
  "Deployment Readiness",
  "Handover",
  "Closeout",
]);
const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "Not Started",
  "In Progress",
  "Blocked",
  "Delayed",
  "On Hold",
  "Complete",
  "Canceled",
]);

const IDEA_STATUSES: ReadonlySet<IdeaStatus> = new Set([
  "New",
  "Under Review",
  "Approved",
  "Rejected",
  "Converted",
]);

const IDEA_URGENCIES: ReadonlySet<IdeaUrgency> = new Set([
  "Low",
  "Medium",
  "High",
  "Critical",
]);

function checkEnum<T extends string>(
  set: ReadonlySet<T>,
  value: string,
  errors: string[],
  context: string,
): T | null {
  if (set.has(value as T)) return value as T;
  errors.push(`${context}: unrecognized value ${JSON.stringify(value)}`);
  return null;
}

/**
 * Coerce a Priority cell. Blank cells default to `"Medium"` because the
 * spreadsheet allows blanks but the schema makes Priority non-nullable
 * (Section 4). Recording an explicit "Medium" matches the convention in
 * tools like Linear and Jira, where the absence of a priority means "not
 * yet triaged" — operationally, that's middle-of-the-pack.
 */
function readPriority(
  value: ExcelJS.CellValue,
  errors: string[],
  context: string,
): Priority | null {
  const str = asString(value);
  if (str === "") return "Medium";
  return checkEnum(PRIORITIES, str, errors, `${context} priority`);
}

// ---------------------------------------------------------------------------
// Sheet readers
// ---------------------------------------------------------------------------

interface ProjectsSheetRow {
  rowNumber: number;
  raw: Record<string, ExcelJS.CellValue>;
}

interface TasksSheetRow {
  rowNumber: number;
  raw: Record<string, ExcelJS.CellValue>;
}

function readSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  headerRowNumber: number = 1,
): { rowNumber: number; raw: Record<string, ExcelJS.CellValue> }[] {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    throw new Error(
      `Sheet ${JSON.stringify(sheetName)} not found in source workbook.`,
    );
  }
  // The New Project Ideas sheet stores its real headers on row 2 (row 1 is a
  // merged-cell spanning title). Callers can override the header row number
  // for sheets that don't follow the default row-1 convention.
  const headerRow = sheet.getRow(headerRowNumber).values as ExcelJS.CellValue[];
  // ExcelJS row.values is 1-indexed (slot 0 is null). Build a column-name
  // → column-index map from the header row.
  const headers: string[] = [];
  for (let i = 1; i < headerRow.length; i++) {
    headers[i] = asString(headerRow[i]);
  }

  const rows: { rowNumber: number; raw: Record<string, ExcelJS.CellValue> }[] =
    [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return; // skip title + header rows
    const values = row.values as ExcelJS.CellValue[];
    const raw: Record<string, ExcelJS.CellValue> = {};
    for (let i = 1; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue;
      raw[header] = values[i] ?? null;
    }
    rows.push({ rowNumber, raw });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

const SEED_USER_ID = "seed-import";
const SEED_TIMESTAMP = new Date().toISOString();

function transformProjects(
  rows: ProjectsSheetRow[],
  errors: string[],
): { projects: Project[]; nameToId: Map<string, ProjectId> } {
  const projects: Project[] = [];
  const nameToId = new Map<string, ProjectId>();

  for (const { rowNumber, raw } of rows) {
    const projectId = asString(raw["Project ID"]);
    const name = asString(raw["Project Name"]);
    // Skip blank trailing rows — an ID with no name is a placeholder.
    if (projectId === "" || name === "") continue;

    if (nameToId.has(name)) {
      errors.push(
        `Projects row ${rowNumber}: duplicate project name ${JSON.stringify(name)} (already used by ${nameToId.get(name)}).`,
      );
      continue;
    }

    const ctx = `Projects row ${rowNumber} (${projectId})`;
    const projectType = checkEnum(
      PROJECT_TYPES,
      asString(raw["Project Type"]),
      errors,
      `${ctx} project_type`,
    );
    const priority = readPriority(raw["Priority"], errors, ctx);
    const status = checkEnum(
      PROJECT_STATUSES,
      asString(raw["Status"]),
      errors,
      `${ctx} status`,
    );
    const phase = checkEnum(
      PROJECT_PHASES,
      asString(raw["Phase"]),
      errors,
      `${ctx} phase`,
    );

    if (!projectType || !priority || !status || !phase) continue;

    const dateAdded =
      asDateOrNull(raw["Date Added"]) ?? SEED_TIMESTAMP.slice(0, 10);

    projects.push({
      project_id: projectId,
      name,
      description: asString(raw["Project Description"]),
      application_product: asString(raw["Application/Product"]),
      project_type: projectType,
      date_added: dateAdded,
      priority,
      status,
      phase,
      primary_stakeholders: splitList(raw["Primary Stakeholders"]),
      // Names stay as strings; Step 2 will resolve them to user IDs.
      project_lead: asString(raw["Project Lead"]),
      additional_resources: splitList(raw["Additional Resources"]),
      resource_allocations: {},
      target_date: asDateOrNull(raw["Target Date"]),
      ai_complexity_score: null,
      ai_time_estimate: null,
      roadmap_bucket: null,
      roadmap_timeline_start: null,
      github_issue_id: null,
      jira_issue_id: null,
      health_score: null,
      health_score_history: [],
      status_history: [],
      depends_on: [],
      dependencies: [],
      external_dependencies: [],
      document_links: [],
      custom_fields: {},
      created_by: SEED_USER_ID,
      updated_at: SEED_TIMESTAMP,
    });
    nameToId.set(name, projectId);
  }

  return { projects, nameToId };
}

function transformTasks(
  rows: TasksSheetRow[],
  nameToId: Map<string, ProjectId>,
  errors: string[],
  warnings: string[],
): Task[] {
  const tasks: Task[] = [];

  for (const { rowNumber, raw } of rows) {
    const taskId = asString(raw["Task ID"]);
    const name = asString(raw["Task"]);
    // Skip blank trailing rows.
    if (taskId === "" || name === "") continue;

    const ctx = `Tasks row ${rowNumber} (${taskId})`;
    const projectName = asString(raw["Project"]);
    if (projectName === "") {
      errors.push(`${ctx}: missing parent project name.`);
      continue;
    }
    const projectId = nameToId.get(projectName);
    if (!projectId) {
      errors.push(
        `${ctx}: parent project ${JSON.stringify(projectName)} not found in Projects sheet.`,
      );
      continue;
    }

    const status = checkEnum(
      TASK_STATUSES,
      asString(raw["Status"]),
      errors,
      `${ctx} status`,
    );
    const priority = readPriority(raw["Priority"], errors, ctx);
    if (!status || !priority) continue;

    tasks.push({
      task_id: taskId,
      project_id: projectId,
      task_name: name,
      detailed_description: asString(raw["Detailed Description"]),
      status,
      priority,
      // Name stays as string; Step 2 resolves to user ID.
      responsible: asString(raw["Responsible"]),
      additional_assignees: [],
      target_date: asDateOrNull(raw["Target Date"]),
      blocked: asYesNo(raw["Blocked?"]),
      blocker_issue_task: asString(raw["Blocker Issue/Task"]),
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comment_history: [],
      // Section 4.2 follow-up: import the "Time Estimate (in Hours)"
      // column when present. Ranges (e.g. "48 to 64") are coerced to
      // their midpoint with a warning so all real data flows through;
      // unrecognized values become null with a warning so the import
      // doesn't fail validation.
      estimate_hours: asEstimateHours(
        raw["Time Estimate (in Hours)"],
        warnings,
        ctx,
      ),
      comments: asString(raw["Comments"]),
      document_links: [],
      template_id: null,
      created_at: SEED_TIMESTAMP,
      updated_at: SEED_TIMESTAMP,
    });
  }

  return tasks;
}

/**
 * Collect every distinct human name referenced as a Project Lead, Additional
 * Resource, or Task Responsible. Step 2 reads this file to know who needs
 * to be invited.
 */
function collectInviteList(projects: Project[], tasks: Task[]): string[] {
  const names = new Set<string>();
  for (const p of projects) {
    if (p.project_lead) names.add(p.project_lead);
    for (const r of p.additional_resources) names.add(r);
  }
  for (const t of tasks) {
    if (t.responsible) names.add(t.responsible);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Default Admin user (Section 9, Step 2)
// ---------------------------------------------------------------------------
//
// The application requires at least one Admin to be reachable on first run
// so the operator can sign in and invite the rest of the team through the
// Manage Users UI. We create exactly one — anything more is the Admin's
// job from the UI.
//
// Defaults are intentionally conspicuous (admin@example.com /
// ChangeMe!2026) so leaving them in place feels wrong. Every deployment
// should override IIM_ADMIN_EMAIL and IIM_ADMIN_PASSWORD before running
// the seed for the first time.

const DEFAULT_ADMIN_EMAIL = "admin@example.com";
const DEFAULT_ADMIN_NAME = "Default Admin";

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  TaskAssigned: "InAppOnly",
  TaskDueSoon: "InAppOnly",
  TaskOverdue: "InAppOnly",
  ProjectBlocked: "InAppOnly",
  DependencyBlocked: "InAppOnly",
  HealthScoreChanged: "InAppOnly",
  IdeaStatusChanged: "InAppOnly",
};

async function buildDefaultAdmin(): Promise<User> {
  const email = (process.env.IIM_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
  const name = (process.env.IIM_ADMIN_NAME ?? DEFAULT_ADMIN_NAME).trim();

  // Identity (password, invite tokens, etc.) is owned by Supabase
  // Auth — the seed produces just the application profile.
  // `migrate:auth-users` creates the matching auth.users row and
  // generates a recovery link so the admin can set a real password.
  return {
    user_id: randomUUID(),
    email,
    name,
    role: "Admin",
    active: true,
    notification_preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    digest_mode: false,
    created_at: SEED_TIMESTAMP,
    updated_at: SEED_TIMESTAMP,
  };
}

// ---------------------------------------------------------------------------
// Ideas import (Section 5.17 / 5.18)
// ---------------------------------------------------------------------------
//
// Reads the "New Project Ideas" tab from the Tiger Team spreadsheet and
// maps each row to a `ProjectIdea`. Rows whose Status is "Approved" are
// skipped — those have already been promoted to projects (their
// "Project Number" column points at a record in the Projects tab), so
// re-importing them would create a duplicate ideas queue entry the
// admin would just have to dismiss.
//
// The sheet's header is on row 2 (row 1 is a spanning section title:
// "Please complete these fields for any new project ideas" / "Admin Use
// Only"). Header columns in the seed file at time of writing:
//
//   Name | Description | Requested By Name | Urgency | Requested Target Date
//   | Key Stakeholders | Comments | Status | Converted to Project? | Project Number
//
// `Comments` maps to admin_comments (per the data model — Section 4.6).
// Blank Urgency and Status default to "Low" / "New" since those are the
// least-committal values; the admin can re-triage from the Ideas page.

type IdeaSheetRow = {
  rowNumber: number;
  raw: Record<string, ExcelJS.CellValue>;
};

function readIdeaUrgency(
  value: ExcelJS.CellValue,
  errors: string[],
  ctx: string,
): IdeaUrgency | null {
  const str = asString(value);
  if (str === "") return "Low";
  if (IDEA_URGENCIES.has(str as IdeaUrgency)) return str as IdeaUrgency;
  errors.push(`${ctx} urgency: unrecognized value ${JSON.stringify(str)}.`);
  return null;
}

function readIdeaStatus(
  value: ExcelJS.CellValue,
  errors: string[],
  ctx: string,
): IdeaStatus | null {
  const str = asString(value);
  if (str === "") return "New";
  if (IDEA_STATUSES.has(str as IdeaStatus)) return str as IdeaStatus;
  errors.push(`${ctx} status: unrecognized value ${JSON.stringify(str)}.`);
  return null;
}

function transformIdeas(
  rows: IdeaSheetRow[],
  errors: string[],
): ProjectIdea[] {
  const ideas: ProjectIdea[] = [];

  for (const { rowNumber, raw } of rows) {
    const name = asString(raw["Name"]);
    const description = asString(raw["Description"]);
    // Skip blank trailing rows — a row with no name or description is a
    // placeholder. Treat either missing as "not really a row".
    if (name === "" && description === "") continue;

    const ctx = `New Project Ideas row ${rowNumber}`;

    // Skip rows whose admin status is "Approved" — those have already been
    // promoted to a project (their Project Number column points at the
    // resulting Projects-tab record). Re-importing them as ideas would
    // duplicate the work in the review queue.
    const rawStatus = asString(raw["Status"]);
    if (rawStatus.toLowerCase() === "approved") continue;

    if (name === "") {
      errors.push(`${ctx}: missing idea Name (description is present).`);
      continue;
    }

    const urgency = readIdeaUrgency(raw["Urgency"], errors, ctx);
    const status = readIdeaStatus(raw["Status"], errors, ctx);
    if (!urgency || !status) continue;

    // submitter_name is non-nullable on the schema; default blank to
    // "Admin" to match the convention several rows already use in the
    // spreadsheet (e.g. the seeded backlog entries from leadership).
    const submitterName = asString(raw["Requested By Name"]) || "Admin";

    const convertedProjectId =
      asYesNo(raw["Converted to Project?"]) &&
      asString(raw["Project Number"]) !== ""
        ? asString(raw["Project Number"])
        : null;

    ideas.push({
      idea_id: randomUUID(),
      submitter_name: submitterName,
      // Spreadsheet doesn't carry an email column — leave null and let
      // the admin add one if they want follow-up notifications.
      submitter_email: null,
      idea_name: name,
      description,
      urgency,
      requested_target_date: asDateOrNull(raw["Requested Target Date"]),
      key_stakeholders: asString(raw["Key Stakeholders"]),
      submitted_at: SEED_TIMESTAMP,
      status,
      admin_comments: asString(raw["Comments"]),
      converted_to_project_id: convertedProjectId,
      ai_overlap_analysis: null,
    });
  }

  return ideas;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function resolveSource(): string | null {
  const fs = require("node:fs") as typeof import("node:fs");
  for (const candidate of SOURCE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Load the pre-built snapshot under `data/seed/` as a fallback when the
 * spreadsheet isn't available. Step 1 committed those snapshot files to
 * version control specifically so a new clone can produce sample data
 * without the source spreadsheet — the seed/README documents this.
 *
 * Returns `null` if the snapshot files aren't usable (missing, empty, or
 * malformed); the caller will then surface a helpful "no source" error.
 */
function loadSnapshotProjectsAndTasks(): {
  projects: Project[];
  tasks: Task[];
} | null {
  const fs = require("node:fs") as typeof import("node:fs");
  const projectsPath = path.join(SEED_DIR, "projects.json");
  const tasksPath = path.join(SEED_DIR, "tasks.json");
  if (!fs.existsSync(projectsPath) || !fs.existsSync(tasksPath)) return null;

  try {
    const projects = JSON.parse(fs.readFileSync(projectsPath, "utf8")) as Project[];
    const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8")) as Task[];
    if (!Array.isArray(projects) || !Array.isArray(tasks)) return null;
    if (projects.length === 0 && tasks.length === 0) return null;
    return { projects, tasks };
  } catch {
    return null;
  }
}

/**
 * Companion to `loadSnapshotProjectsAndTasks` for the ideas queue.
 * Returns `null` (not an empty array) when the snapshot file is
 * missing or malformed so the caller can distinguish "no source, no
 * snapshot" from "snapshot says zero ideas". An empty array IS valid:
 * a snapshot taken from a spreadsheet whose New Project Ideas tab
 * contained only Approved (and therefore skipped) rows produces
 * exactly that.
 */
function loadSnapshotIdeas(): ProjectIdea[] | null {
  const fs = require("node:fs") as typeof import("node:fs");
  const ideasPath = path.join(SEED_DIR, "ideas.json");
  if (!fs.existsSync(ideasPath)) return null;
  try {
    const ideas = JSON.parse(fs.readFileSync(ideasPath, "utf8")) as ProjectIdea[];
    if (!Array.isArray(ideas)) return null;
    return ideas;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Source resolution: prefer the spreadsheet (it's the source of truth
  // until the IIM app goes live), fall back to the pre-built snapshot
  // under data/seed/ if the spreadsheet isn't on disk. Either way the
  // script produces a working data/ folder; the difference is whether
  // edits made in the spreadsheet since the snapshot was taken get
  // picked up.
  const source = resolveSource();
  let projects: Project[];
  let tasks: Task[];
  let ideas: ProjectIdea[];

  if (source) {
    console.log(`Reading spreadsheet: ${source}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);

    const projectRows = readSheet(workbook, "Projects");
    const taskRows = readSheet(workbook, "Tasks");
    // The New Project Ideas tab's header lives on row 2 — row 1 is a
    // merged-cell spanning title.
    const ideaRows = readSheet(workbook, "New Project Ideas", 2);

    const errors: string[] = [];
    const warnings: string[] = [];
    const transformed = transformProjects(projectRows, errors);
    const builtTasks = transformTasks(
      taskRows,
      transformed.nameToId,
      errors,
      warnings,
    );
    const builtIdeas = transformIdeas(ideaRows, errors);

    if (errors.length > 0) {
      console.error(`\nSeed FAILED with ${errors.length} error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
      console.error(
        "\nNothing was written. Fix the spreadsheet and re-run `npm run seed`.",
      );
      process.exit(1);
    }

    // Non-fatal data-quality warnings (e.g. coerced time-estimate
    // ranges) surface here so the operator sees what got transformed
    // rather than wondering why a "48 to 64" cell now reads "56".
    if (warnings.length > 0) {
      console.warn(`\nSeed completed with ${warnings.length} warning(s):`);
      for (const w of warnings) console.warn(`  - ${w}`);
    }

    projects = transformed.projects;
    tasks = builtTasks;
    ideas = builtIdeas;
  } else {
    const snapshot = loadSnapshotProjectsAndTasks();
    if (!snapshot) {
      console.error(
        "Could not find the Tiger Team spreadsheet OR a usable snapshot.\n" +
          "Tried these paths for the spreadsheet:\n  " +
          SOURCE_CANDIDATES.join("\n  ") +
          "\n\nPlace the spreadsheet at one of those paths (or set " +
          "IIM_SEED_SOURCE), or restore data/seed/projects.json and " +
          "data/seed/tasks.json so the seed can fall back to them.",
      );
      process.exit(1);
    }
    console.log(
      `Spreadsheet not found — falling back to snapshot under ${SEED_DIR}/.`,
    );
    console.log(
      "  (Run with IIM_SEED_SOURCE=<path-to-xlsx> or place the spreadsheet at " +
        "the repo root to re-import the latest data.)",
    );
    projects = snapshot.projects;
    tasks = snapshot.tasks;
    // Ideas are sourced from the spreadsheet's New Project Ideas tab;
    // when the spreadsheet isn't available, try the snapshot under
    // data/seed/ideas.json. If that's missing too, fall back to an
    // empty queue rather than failing — the application is still
    // usable with no ideas pending review.
    ideas = loadSnapshotIdeas() ?? [];
  }

  // Wipe-and-replace every JSON file. The seed dir is created if missing.
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SEED_DIR, { recursive: true });

  const admin = await buildDefaultAdmin();

  writeJson(path.join(DATA_DIR, "projects.json"), projects);
  writeJson(path.join(DATA_DIR, "tasks.json"), tasks);
  writeJson(path.join(DATA_DIR, "ideas.json"), ideas);
  writeJson(path.join(DATA_DIR, "users.json"), [admin]);
  writeJson(path.join(DATA_DIR, "notifications.json"), []);
  writeJson(path.join(DATA_DIR, "decisions.json"), []);
  writeJson(path.join(DATA_DIR, "templates.json"), []);
  writeJson(path.join(DATA_DIR, "settings.json"), {});

  // Recompute the to-invite list from whichever source we used. Skipped
  // when running from the snapshot, since the snapshot directory already
  // ships with users-to-invite.json from the last spreadsheet run.
  if (source) {
    const inviteList = collectInviteList(projects, tasks);
    writeJson(path.join(SEED_DIR, "users-to-invite.json"), inviteList);
    console.log(
      `Wrote ${inviteList.length} unique names to ${path.join(SEED_DIR, "users-to-invite.json")}`,
    );
    console.log(`Inviteable names: ${inviteList.join(", ")}`);
  }

  console.log(`Wrote ${projects.length} projects, ${tasks.length} tasks.`);
  console.log(`Wrote ${ideas.length} idea(s) from the New Project Ideas tab.`);
  console.log(
    `Wrote default Admin user: ${admin.email} (role: ${admin.role}).`,
  );
  if (
    !process.env.IIM_ADMIN_EMAIL ||
    !process.env.IIM_ADMIN_PASSWORD
  ) {
    console.log(
      "  ⚠ Using the default email and/or password. Set IIM_ADMIN_EMAIL " +
        "and IIM_ADMIN_PASSWORD before running this seed for any deployment " +
        "you intend to expose.",
    );
  }

  // Step 8 (Section 5.13): seed an initial health score on every project
  // so the Projects table doesn't render every Health column as "—" on
  // first load. Without this, scores wouldn't appear until either the
  // user edits each project (firing the service-layer hook) or the
  // 07:00 UTC daily sweep runs.
  //
  // Dynamic import: `lib/health.ts` transitively imports through
  // `lib/db`, which reads from IIM_DATA_DIR. We resolved IIM_DATA_DIR at
  // top of file via the `DATA_DIR` constant, but `lib/db/store.ts` reads
  // `process.env.IIM_DATA_DIR` lazily on each call — by the time we
  // import, both point at the same directory.
  //
  // We call recalculateAllHealthScores rather than recalculating one
  // project at a time so the upstream-health rollup correctly sees
  // every project's persisted state.
  const { recalculateAllHealthScores } = await import("../lib/health");
  const changed = await recalculateAllHealthScores();
  console.log(`Computed initial health scores for ${changed} project(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
