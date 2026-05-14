/**
 * Merged option lists for the four extensible project enums.
 *
 * The four enums (status, phase, priority, application_product) ship
 * with a built-in set of values (defined as code constants in this
 * file or imported from `lib/projects/display.ts`) and accept admin-
 * added extensions stored in `settings.enum_extensions`. UI dropdowns,
 * filter chips, and write-side validators should consume the merged
 * list returned from `getEnumOptions(...)` rather than iterating the
 * raw constants — otherwise admin-added values won't appear.
 *
 * Each option carries a `source` flag so the admin UI can render
 * built-ins as locked, and so consumers that care about the difference
 * (e.g. a "system status only" filter) can branch on it.
 *
 * Built-in semantics are preserved:
 *
 *   - For `status`, the built-in flags (`is_open`, `is_terminal`)
 *     match the existing definitions in `lib/projects/service.ts` and
 *     `lib/health.ts`. Admin-added statuses can declare these flags
 *     too via the extension's metadata.
 *   - For `priority`, the built-in `rank` follows Critical(0) → Low(3)
 *     ordering used by the projects table sort and by the AI
 *     prioritization input. Admin-added priorities pick a rank
 *     (typically a fractional value to insert between built-ins).
 *   - For `phase`, the built-in `order` follows Appendix C and is
 *     used to compute dependency phase satisfaction. Admin-added
 *     phases pick an order to slot into the lifecycle.
 */

import type {
  EnumExtension,
  ExtensibleEnumKey,
  Priority,
  ProjectPhase,
  ProjectStatus,
} from "@/lib/db";
import { SettingsRepository } from "@/lib/db";
import {
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  SYSTEM_APPLICATION_PRODUCTS,
} from "@/lib/projects/display";

/**
 * Shape of a single option in a merged list. Common across all four
 * enums; metadata fields (`is_open`, `rank`, etc.) are populated
 * conditionally based on which enum is being asked about.
 */
export interface EnumOption {
  /** Stable identifier — matches what's stored on Project records. */
  id: string;
  /** Display label rendered in dropdowns and badges. */
  label: string;
  /** Where this option came from. Built-ins are uneditable. */
  source: "system" | "extension";
  /** Whether the option is hidden from new dropdowns. */
  archived: boolean;
  // Per-enum metadata (only set when relevant).
  is_open?: boolean;
  is_terminal?: boolean;
  rank?: number;
  order?: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Built-in metadata
// ---------------------------------------------------------------------------

/**
 * The "open" status set used by the Projects page default filter and
 * Now/Next/Later auto-placement (Section 5.1). Mirrors the literal
 * comparisons in `lib/projects/service.ts` — kept in sync by code
 * review; if either side moves, both should.
 */
const SYSTEM_OPEN_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
]);

const SYSTEM_TERMINAL_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "Completed",
  "Canceled",
]);

/** Critical = 0 (most urgent), Low = 3. Used by the projects-table sort. */
const SYSTEM_PRIORITY_RANK: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const SYSTEM_PHASE_ORDER: Record<string, number> = Object.fromEntries(
  PROJECT_PHASES.map((p, i) => [p, i]),
);

// ---------------------------------------------------------------------------
// Built-in option lists (computed at module load)
// ---------------------------------------------------------------------------

const SYSTEM_STATUS_OPTIONS: EnumOption[] = PROJECT_STATUSES.map((s) => ({
  id: s,
  label: s,
  source: "system",
  archived: false,
  is_open: SYSTEM_OPEN_STATUSES.has(s),
  is_terminal: SYSTEM_TERMINAL_STATUSES.has(s),
}));

const SYSTEM_PHASE_OPTIONS: EnumOption[] = PROJECT_PHASES.map((p, i) => ({
  id: p,
  label: p,
  source: "system",
  archived: false,
  order: i,
}));

const SYSTEM_PRIORITY_OPTIONS: EnumOption[] = (PRIORITIES as Priority[]).map(
  (p) => ({
    id: p,
    label: p,
    source: "system",
    archived: false,
    rank: SYSTEM_PRIORITY_RANK[p as string] ?? 99,
  }),
);

/**
 * Application/Product ships with a small set of built-in values
 * (see `SYSTEM_APPLICATION_PRODUCTS` in `lib/projects/display.ts`) so
 * recurring categories — currently just "Admin" for internal /
 * operational work — are available out of the box. Admin-curated
 * extensions are merged on top.
 */
const SYSTEM_APP_OPTIONS: EnumOption[] = SYSTEM_APPLICATION_PRODUCTS.map(
  (id) => ({
    id,
    label: id,
    source: "system",
    archived: false,
  }),
);

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

function extensionToOption(
  e: EnumExtension,
  enumKey: ExtensibleEnumKey,
): EnumOption {
  const opt: EnumOption = {
    id: e.id,
    label: e.label,
    source: "extension",
    archived: !!e.archived,
    description: e.description,
  };
  if (enumKey === "status") {
    opt.is_open = e.is_open ?? true;
    opt.is_terminal = e.is_terminal ?? false;
  }
  if (enumKey === "priority") {
    opt.rank = typeof e.rank === "number" ? e.rank : 99;
  }
  if (enumKey === "phase") {
    opt.order = typeof e.order === "number" ? e.order : 999;
  }
  return opt;
}

function systemOptionsFor(enumKey: ExtensibleEnumKey): EnumOption[] {
  switch (enumKey) {
    case "status":
      return SYSTEM_STATUS_OPTIONS;
    case "phase":
      return SYSTEM_PHASE_OPTIONS;
    case "priority":
      return SYSTEM_PRIORITY_OPTIONS;
    case "application_product":
      return SYSTEM_APP_OPTIONS;
  }
}

/**
 * Sort the merged option list in the order that's most useful per
 * enum:
 *
 *   - status: built-in display order, then extensions appended in
 *     the order they were added (most-recent last);
 *   - phase: by `order` ascending so admin-inserted phases slot in
 *     correctly;
 *   - priority: by `rank` ascending so an admin-added "Urgent" with
 *     rank 0.5 lands between Critical and High;
 *   - application_product: alphabetical (no inherent ordering).
 */
function sortOptions(
  options: EnumOption[],
  enumKey: ExtensibleEnumKey,
): EnumOption[] {
  const out = [...options];
  switch (enumKey) {
    case "phase":
      out.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      return out;
    case "priority":
      out.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
      return out;
    case "application_product":
      out.sort((a, b) => a.label.localeCompare(b.label));
      return out;
    case "status":
      // Stable: system order first, then extensions in stored order.
      return out;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronous merge given an already-loaded extensions map. Useful in
 * server pages that read settings once and pass the relevant slice to
 * client components — avoids each call site repeating the full read.
 *
 * `includeArchived` controls whether archived extensions are returned.
 * Pass `true` from the admin editor (it shows everything with a toggle)
 * and from any context that needs to display a record's existing value
 * even if that value has since been archived. Pass `false` (the default)
 * for new-record dropdowns.
 */
export function mergeEnumOptions(
  enumKey: ExtensibleEnumKey,
  extensions: EnumExtension[],
  includeArchived = false,
): EnumOption[] {
  const system = systemOptionsFor(enumKey);
  const ext = extensions.map((e) => extensionToOption(e, enumKey));
  const merged = [...system, ...ext];
  const filtered = includeArchived
    ? merged
    : merged.filter((o) => !o.archived);
  return sortOptions(filtered, enumKey);
}

/**
 * Async helper that reads the live settings file and returns the
 * merged option list for a single enum. Use in server components and
 * API routes that don't already have a loaded settings object.
 */
export async function getEnumOptions(
  enumKey: ExtensibleEnumKey,
  includeArchived = false,
): Promise<EnumOption[]> {
  const settings = await SettingsRepository.get();
  return mergeEnumOptions(
    enumKey,
    settings.enum_extensions[enumKey] ?? [],
    includeArchived,
  );
}

/**
 * Bulk loader for pages that render multiple dropdowns. Reads settings
 * once and returns a complete map of all four merged option lists.
 */
export async function getAllEnumOptions(
  includeArchived = false,
): Promise<Record<ExtensibleEnumKey, EnumOption[]>> {
  const settings = await SettingsRepository.get();
  return {
    status: mergeEnumOptions(
      "status",
      settings.enum_extensions.status ?? [],
      includeArchived,
    ),
    phase: mergeEnumOptions(
      "phase",
      settings.enum_extensions.phase ?? [],
      includeArchived,
    ),
    priority: mergeEnumOptions(
      "priority",
      settings.enum_extensions.priority ?? [],
      includeArchived,
    ),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product ?? [],
      includeArchived,
    ),
  };
}

/**
 * Lookup table form: id → option metadata. Convenient for badge
 * rendering and other "given an arbitrary stored value, what do I
 * show?" use cases. Always includes archived options so a record's
 * archived value still resolves to its label and metadata.
 */
export function indexEnumOptions(
  options: EnumOption[],
): Record<string, EnumOption> {
  const out: Record<string, EnumOption> = {};
  for (const o of options) out[o.id] = o;
  return out;
}

/** True if `id` is one of the locked, code-defined system values. */
export function isSystemEnumValue(
  enumKey: ExtensibleEnumKey,
  id: string,
): boolean {
  return systemOptionsFor(enumKey).some((o) => o.id === id);
}

/**
 * Validate a candidate value against the merged option list (system +
 * non-archived extensions). Used by write-side service validators so
 * an attacker can't POST an arbitrary status string and bypass the
 * dropdown.
 *
 * Allow archived values to pass — a project may legitimately retain an
 * archived value if that's what was set before archiving. We just
 * don't surface them in new-record dropdowns.
 */
export function isValidEnumValue(
  enumKey: ExtensibleEnumKey,
  candidate: string,
  extensions: EnumExtension[],
): boolean {
  const all = mergeEnumOptions(enumKey, extensions, /*includeArchived*/ true);
  return all.some((o) => o.id === candidate);
}
