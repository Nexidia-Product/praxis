/**
 * Settings repository — get/update against the singleton `settings` row.
 *
 * The `settings` table holds at most one row (`id='singleton'`, enforced
 * by a CHECK constraint). `get` returns the persisted row if any,
 * otherwise the baked-in defaults defined here. The defaults reflect
 * what the design document calls out: 20 / 40 percent thresholds for
 * Yellow/Red health (Section 5.13), conservative notification defaults
 * (Section 5.12), an empty custom-field list (Section 5.19).
 */

import {
  DEFAULT_RESOURCE_SETTINGS,
  type AppSettings,
  type EnumExtensionsMap,
  type NotificationPreferences,
  type NotificationType,
  type PortfolioQuadrantLabels,
  type ResourceSettings,
  type RolePermissionsMap,
} from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "settings" as const;
const SINGLETON_ID = "singleton";

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  TaskAssigned: "InAppOnly",
  TaskDueSoon: "InAppOnly",
  TaskOverdue: "InAppOnly",
  ProjectBlocked: "InAppOnly",
  DependencyBlocked: "InAppOnly",
  HealthScoreChanged: "InAppOnly",
  IdeaStatusChanged: "InAppOnly",
} satisfies Record<NotificationType, "InAppOnly">;

/**
 * Default role -> permission grants seeded into a fresh settings row.
 *
 * Inlined here (rather than imported from `lib/auth/role-permissions`)
 * to avoid a `lib/db -> lib/auth -> lib/db` import cycle. The auth
 * layer normalizes whatever is read from disk against its catalog, so
 * if this list ever drifts from the catalog the runtime self-corrects
 * on next read.
 */
const DEFAULT_ROLE_PERMISSIONS_SEED: RolePermissionsMap = {
  Admin: [
    "projects.view",
    "projects.create",
    "projects.edit",
    "projects.delete",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "tasks.delete",
    "ideas.review",
    "ideas.convert",
    "roadmap.view",
    "roadmap.export",
    "velocity.view",
    "resources.view",
    "resources.view_all",
    "admin.console",
    "admin.users.manage",
    "admin.roles.manage",
    "admin.custom_fields.manage",
    "admin.templates.manage",
    "admin.health_thresholds.manage",
    "admin.resource_thresholds.manage",
    "admin.project_values.manage",
  ],
  "Project Lead": [
    "projects.view",
    "projects.create",
    "projects.edit",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "tasks.delete",
    "ideas.review",
    "ideas.convert",
    "roadmap.view",
    "roadmap.export",
    "velocity.view",
    "resources.view",
    "resources.view_all",
  ],
  "Team Member": [
    "projects.view",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "roadmap.view",
    "velocity.view",
    "resources.view",
  ],
  Viewer: [
    "projects.view",
    "tasks.view",
    "roadmap.view",
    "velocity.view",
    "resources.view",
  ],
};

const DEFAULT_ENUM_EXTENSIONS: EnumExtensionsMap = {
  status: [],
  phase: [],
  priority: [],
  application_product: [],
};

const DEFAULT_RESOURCE_SETTINGS_SEED: ResourceSettings = DEFAULT_RESOURCE_SETTINGS;

const DEFAULTS: AppSettings = {
  health_score_thresholds: {
    yellow_blocked_or_overdue_pct: 20,
    red_blocked_or_overdue_pct: 40,
    yellow_inactivity_days: 14,
    yellow_target_date_proximity_days: 14,
    yellow_open_tasks_pct: 30,
    yellow_due_soon_tasks_pct: 30,
  },
  branding: {
    logo_url: null,
    primary_color: "#1f2937",
    secondary_color: "#3b82f6",
    font: "Inter",
  },
  notification_defaults: {
    per_type: DEFAULT_NOTIFICATION_PREFERENCES,
    digest_mode: false,
  },
  custom_field_definitions: [],
  kanban_configs: [],
  role_permissions: DEFAULT_ROLE_PERMISSIONS_SEED,
  enum_extensions: DEFAULT_ENUM_EXTENSIONS,
  resource_settings: DEFAULT_RESOURCE_SETTINGS_SEED,
  portfolio_quadrants: {
    quick_win: "Quick Win",
    major_bet: "Major Bet",
    fill_in: "Fill-In",
    deprioritize: "Deprioritize",
  },
};

export const SettingsRepository = {
  /** The defaults applied when the settings row does not yet exist. */
  defaults(): AppSettings {
    // Defensive copy so callers can mutate freely.
    return JSON.parse(JSON.stringify(DEFAULTS)) as AppSettings;
  },

  async get(): Promise<AppSettings> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("id", SINGLETON_ID)
      .maybeSingle();
    if (error) throw new Error(`settings.get failed: ${error.message}`);
    if (!data) return this.defaults();

    // Merge over defaults so a row missing a column added in a later
    // migration still produces a complete AppSettings shape. The defensive
    // merges (enum_extensions, resource_settings, portfolio_quadrants)
    // mirror the JSON-era logic — tolerate partial / hand-edited rows
    // without crashing.
    const defaults = this.defaults();
    const partial = data as Partial<AppSettings>;
    return {
      health_score_thresholds:
        partial.health_score_thresholds ?? defaults.health_score_thresholds,
      branding: partial.branding ?? defaults.branding,
      notification_defaults:
        partial.notification_defaults ?? defaults.notification_defaults,
      custom_field_definitions:
        partial.custom_field_definitions ?? defaults.custom_field_definitions,
      kanban_configs: partial.kanban_configs ?? defaults.kanban_configs,
      role_permissions: partial.role_permissions ?? defaults.role_permissions,
      enum_extensions: mergeEnumExtensions(
        partial.enum_extensions,
        defaults.enum_extensions,
      ),
      resource_settings: mergeResourceSettings(
        partial.resource_settings,
        defaults.resource_settings,
      ),
      portfolio_quadrants: mergePortfolioQuadrants(
        partial.portfolio_quadrants,
        defaults.portfolio_quadrants,
      ),
    };
  },

  /** Replace the entire settings row atomically. */
  async set(settings: AppSettings): Promise<AppSettings> {
    const { error } = await getServiceRoleClient()
      .from(TABLE)
      .upsert({ id: SINGLETON_ID, ...settings });
    if (error) throw new Error(`settings.set failed: ${error.message}`);
    return settings;
  },

  /** Apply a partial patch on top of the current settings. */
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const next: AppSettings = { ...current, ...patch };
    return this.set(next);
  },
};

function mergeEnumExtensions(
  stored: Partial<EnumExtensionsMap> | undefined,
  defaults: EnumExtensionsMap,
): EnumExtensionsMap {
  if (!stored || typeof stored !== "object") return defaults;
  const out: EnumExtensionsMap = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof EnumExtensionsMap>) {
    const value = stored[key];
    if (Array.isArray(value)) {
      out[key] = value;
    }
  }
  return out;
}

function mergeResourceSettings(
  stored: Partial<ResourceSettings> | undefined,
  defaults: ResourceSettings,
): ResourceSettings {
  if (!stored || typeof stored !== "object") return defaults;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  return {
    default_allocation_percent: num(
      stored.default_allocation_percent,
      defaults.default_allocation_percent,
    ),
    workload_weights: {
      project_assignment: num(
        stored.workload_weights?.project_assignment,
        defaults.workload_weights.project_assignment,
      ),
      open_task: num(
        stored.workload_weights?.open_task,
        defaults.workload_weights.open_task,
      ),
      past_due_task: num(
        stored.workload_weights?.past_due_task,
        defaults.workload_weights.past_due_task,
      ),
      bottleneck_task: num(
        stored.workload_weights?.bottleneck_task,
        defaults.workload_weights.bottleneck_task,
      ),
      complexity_low: num(
        stored.workload_weights?.complexity_low,
        defaults.workload_weights.complexity_low,
      ),
      complexity_medium: num(
        stored.workload_weights?.complexity_medium,
        defaults.workload_weights.complexity_medium,
      ),
      complexity_high: num(
        stored.workload_weights?.complexity_high,
        defaults.workload_weights.complexity_high,
      ),
      complexity_very_high: num(
        stored.workload_weights?.complexity_very_high,
        defaults.workload_weights.complexity_very_high,
      ),
      priority_critical: num(
        stored.workload_weights?.priority_critical,
        defaults.workload_weights.priority_critical,
      ),
      priority_high: num(
        stored.workload_weights?.priority_high,
        defaults.workload_weights.priority_high,
      ),
      priority_medium: num(
        stored.workload_weights?.priority_medium,
        defaults.workload_weights.priority_medium,
      ),
      priority_low: num(
        stored.workload_weights?.priority_low,
        defaults.workload_weights.priority_low,
      ),
    },
    workload_buckets: {
      light_max: num(
        stored.workload_buckets?.light_max,
        defaults.workload_buckets.light_max,
      ),
      balanced_max: num(
        stored.workload_buckets?.balanced_max,
        defaults.workload_buckets.balanced_max,
      ),
      heavy_max: num(
        stored.workload_buckets?.heavy_max,
        defaults.workload_buckets.heavy_max,
      ),
    },
    performance_weights: {
      on_time: num(
        stored.performance_weights?.on_time,
        defaults.performance_weights.on_time,
      ),
      blocked_inverse: num(
        stored.performance_weights?.blocked_inverse,
        defaults.performance_weights.blocked_inverse,
      ),
    },
    performance_thresholds: {
      green_min: num(
        stored.performance_thresholds?.green_min,
        defaults.performance_thresholds.green_min,
      ),
      yellow_min: num(
        stored.performance_thresholds?.yellow_min,
        defaults.performance_thresholds.yellow_min,
      ),
    },
    performance_window_days: num(
      stored.performance_window_days,
      defaults.performance_window_days,
    ),
  };
}

function mergePortfolioQuadrants(
  stored: Partial<PortfolioQuadrantLabels> | undefined,
  defaults: PortfolioQuadrantLabels,
): PortfolioQuadrantLabels {
  if (!stored || typeof stored !== "object") return defaults;
  const pick = (v: unknown, fallback: string): string => {
    if (typeof v !== "string") return fallback;
    const trimmed = v.trim();
    return trimmed === "" ? fallback : trimmed;
  };
  return {
    quick_win: pick(stored.quick_win, defaults.quick_win),
    major_bet: pick(stored.major_bet, defaults.major_bet),
    fill_in: pick(stored.fill_in, defaults.fill_in),
    deprioritize: pick(stored.deprioritize, defaults.deprioritize),
  };
}
