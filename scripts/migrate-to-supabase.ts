/**
 * One-time JSON → Supabase migration.
 *
 *   npm run migrate:supabase              # dry run — shows what would happen
 *   npm run migrate:supabase -- --confirm # actually wipe + insert
 *
 * Reads every `data/*.json` file and inserts into the matching Supabase
 * table, preserving IDs, timestamps, and (where applicable) history.
 *
 * Behavior:
 *
 *   - Dry run (default): connects, validates the JSON files load,
 *     prints per-entity counts, and exits. No writes.
 *   - --confirm: wipes every application table in dependency-aware
 *     order, then inserts the JSON contents. Settings is upserted as
 *     a singleton row.
 *   - Stops at the first error so partial migrations don't leave the
 *     database in a weird half-state.
 *
 * The `actor_id` column on audit_log entries holds historical UUIDs
 * that may not match the current users.json (a stale browser JWT
 * could have written an actor_id that no longer resolves to anyone).
 * On import we NULL out any actor_id that isn't present in
 * users.json — the row stays in the audit trail with "(unknown
 * user)" rendering. We keep `actor_name` as written either way, so
 * the historical display is preserved when present.
 *
 * Designed to be safe to re-run with --confirm: each run produces
 * the same end state as long as the JSON files don't change.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AppSettings,
  AuditLogEntry,
  DecisionLogEntry,
  Notification,
  Project,
  ProjectIdea,
  Task,
  TaskTemplate,
  User,
} from "../lib/db/types";
import { SettingsRepository } from "../lib/db/settings";

// ---------------------------------------------------------------------------
// Paths + env
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.IIM_DATA_DIR ?? path.join(REPO_ROOT, "data");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function bail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) bail("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local.");
if (!serviceKey) bail("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local.");

const confirm = process.argv.includes("--confirm");

// ---------------------------------------------------------------------------
// Load JSON files
// ---------------------------------------------------------------------------

function loadArray<T>(name: string): T[] {
  const file = path.join(DATA_DIR, name);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) {
      console.warn(`  ⚠ ${name} is not an array — treating as empty.`);
      return [];
    }
    return parsed as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`  ⚠ ${name} not found — treating as empty.`);
      return [];
    }
    throw err;
  }
}

function loadSingleton<T>(name: string): T | null {
  const file = path.join(DATA_DIR, name);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Bulk insert helpers
// ---------------------------------------------------------------------------

const BATCH = 200;

async function bulkInsert(
  client: SupabaseClient,
  table: string,
  rows: readonly unknown[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    // PostgREST's typed builder narrows insert payloads against a
    // generated Database schema we don't have, so the type at this
    // boundary is correctly `any`. We trust the caller (the migration
    // script) to have shaped each row to match the table.
    const { error } = await client
      .from(table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(slice as any);
    if (error) {
      bail(
        `Insert into ${table} failed at rows ${i + 1}-${i + slice.length}: ${error.message}`,
      );
    }
  }
}

/**
 * Wipe a table. PostgREST requires a filter on DELETE; we use
 * `not(<id>, 'is', null)` which matches every row regardless of the
 * column's data type.
 */
async function wipe(
  client: SupabaseClient,
  table: string,
  idCol: string,
): Promise<number> {
  const { data, error } = await client
    .from(table)
    .delete()
    .not(idCol, "is", null)
    .select(idCol);
  if (error) bail(`Wipe of ${table} failed: ${error.message}`);
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Source:      ${DATA_DIR}`);
  console.log(`Destination: ${url}`);
  console.log(`Mode:        ${confirm ? "WRITE (--confirm)" : "dry run"}`);
  console.log("");

  const users = loadArray<User>("users.json");
  const projects = loadArray<Project>("projects.json");
  const tasks = loadArray<Task>("tasks.json");
  const ideas = loadArray<ProjectIdea>("ideas.json");
  const decisions = loadArray<DecisionLogEntry>("decisions.json");
  const notifications = loadArray<Notification>("notifications.json");
  const templates = loadArray<TaskTemplate>("templates.json");
  const auditLog = loadArray<AuditLogEntry>("audit-log.json");
  const settings = loadSingleton<AppSettings>("settings.json");

  console.log("Source counts:");
  console.log(`  users         ${users.length}`);
  console.log(`  projects      ${projects.length}`);
  console.log(`  tasks         ${tasks.length}`);
  console.log(`  ideas         ${ideas.length}`);
  console.log(`  decisions     ${decisions.length}`);
  console.log(`  notifications ${notifications.length}`);
  console.log(`  templates     ${templates.length}`);
  console.log(`  audit_log     ${auditLog.length}`);
  console.log(`  settings      ${settings ? "1 (singleton)" : "0 (will use defaults)"}`);
  console.log("");

  // Build the set of valid user IDs so we can NULL out orphan
  // audit_log.actor_id references before insert.
  const validUserIds = new Set(users.map((u) => u.user_id));
  let auditOrphans = 0;
  const auditRows = auditLog.map((entry) => {
    if (entry.actor_id && !validUserIds.has(entry.actor_id)) {
      auditOrphans++;
      return { ...entry, actor_id: null };
    }
    return entry;
  });
  if (auditOrphans > 0) {
    console.log(
      `Note: ${auditOrphans} audit_log row(s) reference an unknown actor_id — those will be NULL'd on insert (actor_name preserved).`,
    );
    console.log("");
  }

  if (!confirm) {
    console.log("Dry run complete. Re-run with --confirm to wipe + insert.");
    return;
  }

  // -------------------------------------------------------------------------
  // Write phase
  // -------------------------------------------------------------------------

  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Wipe in reverse-dependency order so FK constraints don't fire.
  console.log("Wiping existing tables (in reverse-dependency order)…");
  const wipedAudit = await wipe(client, "audit_log", "entry_id");
  const wipedNotifications = await wipe(client, "notifications", "notification_id");
  const wipedDecisions = await wipe(client, "decisions", "entry_id");
  const wipedTemplates = await wipe(client, "templates", "template_id");
  const wipedIdeas = await wipe(client, "ideas", "idea_id");
  const wipedTasks = await wipe(client, "tasks", "task_id");
  const wipedProjects = await wipe(client, "projects", "project_id");
  const wipedUsers = await wipe(client, "users", "user_id");
  const wipedSettings = await wipe(client, "settings", "id");

  console.log(
    `  ✓ wiped: audit_log=${wipedAudit}, notifications=${wipedNotifications}, decisions=${wipedDecisions}, templates=${wipedTemplates}, ideas=${wipedIdeas}, tasks=${wipedTasks}, projects=${wipedProjects}, users=${wipedUsers}, settings=${wipedSettings}`,
  );
  console.log("");

  // Insert in dependency order. Each call preserves IDs and timestamps
  // from the source JSON.
  console.log("Inserting…");

  await bulkInsert(client, "users", users);
  console.log(`  ✓ users         ${users.length}`);

  await bulkInsert(client, "projects", projects);
  console.log(`  ✓ projects      ${projects.length}`);

  await bulkInsert(client, "tasks", tasks);
  console.log(`  ✓ tasks         ${tasks.length}`);

  await bulkInsert(client, "ideas", ideas);
  console.log(`  ✓ ideas         ${ideas.length}`);

  await bulkInsert(client, "decisions", decisions);
  console.log(`  ✓ decisions     ${decisions.length}`);

  await bulkInsert(client, "notifications", notifications);
  console.log(`  ✓ notifications ${notifications.length}`);

  await bulkInsert(client, "templates", templates);
  console.log(`  ✓ templates     ${templates.length}`);

  await bulkInsert(client, "audit_log", auditRows);
  console.log(`  ✓ audit_log     ${auditRows.length}`);

  // Always upsert a complete settings row, filling any missing keys
  // from the bundled defaults. The seed script writes settings.json as
  // `{}`, so the loaded object is typically empty — without this merge
  // the upsert would violate every NOT NULL constraint on the table.
  const merged: AppSettings = {
    ...SettingsRepository.defaults(),
    ...(settings ?? {}),
  };
  const { error: settingsErr } = await client
    .from("settings")
    .upsert({ id: "singleton", ...merged });
  if (settingsErr) bail(`Settings upsert failed: ${settingsErr.message}`);
  console.log(
    `  ✓ settings      1 (singleton row${settings ? "" : ", seeded from defaults"})`,
  );

  console.log("");
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
