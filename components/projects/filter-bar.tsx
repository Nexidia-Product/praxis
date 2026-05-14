"use client";

/**
 * Filter bar for the Projects page.
 *
 * Five enum filters (Status, Phase, Priority, Type, Lead, App/Product), a
 * target-date range, and a free-text search over Project ID + name +
 * description (Section 5.1). All filters are multi-select except the
 * date range and search.
 *
 * The bar exposes its state up to the table component via a controlled
 * `filters`/`onChange` interface so the table can apply the filters in
 * memory and pass the same shape to the CSV export endpoint without
 * duplicating the filter list.
 *
 * Implementation note: we use a tiny "checkbox dropdown" pattern rather
 * than pulling in a full combobox library — the option counts are small
 * (under a dozen each) and the rest of the app intentionally has zero
 * UI dependencies. If the filter list grows past two dozen items per
 * field, swap in a search-able combobox.
 */

import { useEffect, useRef, useState } from "react";

import {
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from "@/lib/projects/display";
import type { EnumOption } from "@/lib/projects/enum-options";
import { PORTFOLIO_POSITION_KEYS } from "@/lib/projects/portfolio-position";
import type {
  CustomFieldDefinition,
  PortfolioQuadrantLabels,
  Priority,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

/**
 * Per-custom-field filter shape. The active fields depend on the
 * field's `type` — anything else stays empty:
 *
 *   text      `text`              substring match (case-insensitive)
 *   number    `min` / `max`       inclusive range
 *   date      `from` / `to`       YYYY-MM-DD inclusive range
 *   boolean   `bool` "yes"|"no"|""   tri-state (empty = either)
 *   select    `values[]`          multi-select OR
 *
 * Stored under `filters.custom[def.key]` keyed by the *current* set of
 * definitions. When a definition is removed admin-side, stale entries
 * become inert — the table's filter loop only reads keys with a live
 * definition.
 */
export interface CustomFieldFilter {
  text?: string;
  min?: string;
  max?: string;
  from?: string;
  to?: string;
  bool?: "" | "yes" | "no";
  values?: string[];
}

export interface ProjectFilters {
  status: ProjectStatus[];
  phase: ProjectPhase[];
  priority: Priority[];
  project_type: ProjectType[];
  project_lead: string[];
  application_product: string[];
  /**
   * Multi-select on the strategic-position bucket keys (quick_win,
   * major_bet, fill_in, deprioritize, unknown). The filter operates
   * on the *bucket key*, not the user-facing label, so renaming the
   * label doesn't invalidate saved filter state.
   */
  portfolio_position: string[];
  target_from: string; // YYYY-MM-DD or ""
  target_to: string;   // YYYY-MM-DD or ""
  search: string;
  /** Per-custom-field filter values, keyed by `CustomFieldDefinition.key`. */
  custom: Record<string, CustomFieldFilter>;
}

export const EMPTY_FILTERS: ProjectFilters = {
  status: [],
  phase: [],
  priority: [],
  project_type: [],
  project_lead: [],
  application_product: [],
  portfolio_position: [],
  target_from: "",
  target_to: "",
  search: "",
  custom: {},
};

/**
 * Test whether a single custom-field filter has any active value. Used by
 * `isFilterActive` and the export query encoder so we don't ship empty
 * keys.
 */
export function isCustomFilterActive(f: CustomFieldFilter | undefined): boolean {
  if (!f) return false;
  if (f.text) return true;
  if (f.min || f.max) return true;
  if (f.from || f.to) return true;
  if (f.bool) return true;
  if (f.values && f.values.length > 0) return true;
  return false;
}

/** Encode a filter set into a URL query string for the export endpoint. */
export function filtersToQueryString(filters: ProjectFilters): string {
  const params = new URLSearchParams();
  for (const s of filters.status) params.append("status", s);
  for (const p of filters.phase) params.append("phase", p);
  for (const p of filters.priority) params.append("priority", p);
  for (const t of filters.project_type) params.append("project_type", t);
  for (const l of filters.project_lead) params.append("project_lead", l);
  for (const a of filters.application_product)
    params.append("application_product", a);
  for (const pos of filters.portfolio_position)
    params.append("portfolio_position", pos);
  if (filters.target_from) params.set("target_from", filters.target_from);
  if (filters.target_to) params.set("target_to", filters.target_to);
  if (filters.search) params.set("search", filters.search);
  // Custom-field filters use a `cf.<key>.<part>` namespace so the server
  // can pick them up without colliding with any built-in name. Lists of
  // selected values get the `cf.<key>.values` repeated-param treatment.
  for (const [key, f] of Object.entries(filters.custom)) {
    if (!isCustomFilterActive(f)) continue;
    if (f.text) params.set(`cf.${key}.text`, f.text);
    if (f.min) params.set(`cf.${key}.min`, f.min);
    if (f.max) params.set(`cf.${key}.max`, f.max);
    if (f.from) params.set(`cf.${key}.from`, f.from);
    if (f.to) params.set(`cf.${key}.to`, f.to);
    if (f.bool) params.set(`cf.${key}.bool`, f.bool);
    if (f.values) {
      for (const v of f.values) params.append(`cf.${key}.values`, v);
    }
  }
  return params.toString();
}

export function isFilterActive(filters: ProjectFilters): boolean {
  return (
    filters.status.length > 0 ||
    filters.phase.length > 0 ||
    filters.priority.length > 0 ||
    filters.project_type.length > 0 ||
    filters.project_lead.length > 0 ||
    filters.application_product.length > 0 ||
    filters.portfolio_position.length > 0 ||
    filters.target_from !== "" ||
    filters.target_to !== "" ||
    filters.search !== "" ||
    Object.values(filters.custom).some(isCustomFilterActive)
  );
}

// ---------------------------------------------------------------------------
// Multi-select checkbox dropdown
// ---------------------------------------------------------------------------

interface MultiSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
  /**
   * Optional display-label override per option key. Used when the
   * stored values are stable internal keys (e.g. `quick_win`) but the
   * UI should render the user-facing label (e.g. "Quick Win"). When
   * omitted, the option key itself is shown — back-compatible with all
   * existing call sites.
   */
  optionLabels?: Partial<Record<T, string>>;
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
  optionLabels,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const display = (opt: T): string => optionLabels?.[opt] ?? opt;

  // Close on outside click. Using mousedown so the click that toggles the
  // button doesn't immediately re-open by hitting the document handler.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(opt: T) {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  }

  const summary =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? display(selected[0])
        : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm text-gray-900 shadow-sm transition hover:border-gray-400"
      >
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            {label}
          </span>
          <span className="truncate text-sm text-gray-900">{summary}</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="h-3 w-3 text-gray-500"
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full min-w-[12rem] overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-gray-500">
              No options.
            </div>
          ) : (
            options.map((opt) => {
              const checked = selected.includes(opt);
              return (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
                  />
                  <span className="text-gray-800">{display(opt)}</span>
                </label>
              );
            })
          )}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface ProjectFilterBarProps {
  filters: ProjectFilters;
  onChange: (next: ProjectFilters) => void;
  /** Distinct project_lead values in the current dataset. */
  leadOptions: string[];
  /** Distinct application_product values in the current dataset. */
  applicationOptions: string[];
  /**
   * Merged option lists from `lib/projects/enum-options`. Optional —
   * when omitted we fall back to the static built-in arrays so admin
   * extensions won't appear, but the bar still works. The Projects
   * page passes them in.
   */
  statusOptions?: EnumOption[];
  phaseOptions?: EnumOption[];
  priorityOptions?: EnumOption[];
  /** Admin-defined custom field definitions, rendered as their own filters. */
  customFields: CustomFieldDefinition[];
  /**
   * User-facing labels for the four strategic-position buckets. Used
   * by the Position dropdown to render renamed labels while still
   * storing the stable bucket keys in filter state.
   */
  quadrantLabels: PortfolioQuadrantLabels;
}

export function ProjectFilterBar({
  filters,
  onChange,
  leadOptions,
  applicationOptions,
  statusOptions,
  phaseOptions,
  priorityOptions,
  customFields,
  quadrantLabels,
}: ProjectFilterBarProps) {
  // Resolve to a `string[]` of IDs for the multi-select dropdowns.
  // We'd love to also surface labels, but the existing `MultiSelect`
  // shape is `readonly T[]` where T is the actual filter value, and
  // values stored on Project records are the IDs — so for now ID is
  // both the option key and the displayed text. Renaming a value via
  // the admin matrix updates dropdowns app-wide on next page load.
  const statusList = statusOptions
    ? statusOptions.map((o) => o.id)
    : (PROJECT_STATUSES as string[]);
  const phaseList = phaseOptions
    ? phaseOptions.map((o) => o.id)
    : (PROJECT_PHASES as string[]);
  const priorityList = priorityOptions
    ? priorityOptions.map((o) => o.id)
    : (PRIORITIES as string[]);

  function update<K extends keyof ProjectFilters>(
    key: K,
    value: ProjectFilters[K],
  ) {
    onChange({ ...filters, [key]: value });
  }

  /** Patch the per-field custom filter, leaving the others untouched. */
  function updateCustom(key: string, patch: Partial<CustomFieldFilter>) {
    const prev = filters.custom[key] ?? {};
    onChange({
      ...filters,
      custom: { ...filters.custom, [key]: { ...prev, ...patch } },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <MultiSelect
          label="Status"
          options={statusList}
          selected={filters.status}
          onChange={(v) => update("status", v)}
        />
        <MultiSelect
          label="Phase"
          options={phaseList}
          selected={filters.phase}
          onChange={(v) => update("phase", v)}
        />
        <MultiSelect
          label="Priority"
          options={priorityList}
          selected={filters.priority}
          onChange={(v) => update("priority", v)}
        />
        <MultiSelect
          label="Position"
          options={PORTFOLIO_POSITION_KEYS}
          selected={
            filters.portfolio_position.filter((p) =>
              (PORTFOLIO_POSITION_KEYS as readonly string[]).includes(p),
            ) as typeof PORTFOLIO_POSITION_KEYS extends readonly (infer U)[]
              ? U[]
              : never
          }
          onChange={(v) => update("portfolio_position", v as string[])}
          optionLabels={{
            quick_win: quadrantLabels.quick_win,
            major_bet: quadrantLabels.major_bet,
            fill_in: quadrantLabels.fill_in,
            deprioritize: quadrantLabels.deprioritize,
          }}
        />
        <MultiSelect
          label="Type"
          options={PROJECT_TYPES}
          selected={filters.project_type}
          onChange={(v) => update("project_type", v)}
        />
        <MultiSelect
          label="Project Lead"
          options={leadOptions}
          selected={filters.project_lead}
          onChange={(v) => update("project_lead", v)}
        />
        <MultiSelect
          label="App/Product"
          options={applicationOptions}
          selected={filters.application_product}
          onChange={(v) => update("application_product", v)}
        />

        <div className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Target
          </span>
          <input
            type="date"
            aria-label="Target date from"
            value={filters.target_from}
            onChange={(e) => update("target_from", e.target.value)}
            className="ml-2 border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
          />
          <span className="px-1 text-xs text-gray-400">–</span>
          <input
            type="date"
            aria-label="Target date to"
            value={filters.target_to}
            onChange={(e) => update("target_to", e.target.value)}
            className="border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            placeholder="Search projects…"
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            className="h-9 w-56 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
          {isFilterActive(filters) ? (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      {customFields.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-gray-200 bg-gray-50 p-2">
          <span className="self-center px-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Custom
          </span>
          {customFields.map((def) => (
            <CustomFieldFilterInput
              key={def.key}
              def={def}
              value={filters.custom[def.key]}
              onChange={(patch) => updateCustom(def.key, patch)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-custom-field filter inputs
// ---------------------------------------------------------------------------

interface CustomFieldFilterInputProps {
  def: CustomFieldDefinition;
  value: CustomFieldFilter | undefined;
  onChange: (patch: Partial<CustomFieldFilter>) => void;
}

function CustomFieldFilterInput({
  def,
  value,
  onChange,
}: CustomFieldFilterInputProps) {
  const v = value ?? {};

  if (def.type === "select") {
    return (
      <MultiSelect
        label={def.label}
        options={def.options ?? []}
        selected={v.values ?? []}
        onChange={(values) => onChange({ values })}
      />
    );
  }

  if (def.type === "boolean") {
    return (
      <label className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          {def.label}
        </span>
        <select
          aria-label={def.label}
          value={v.bool ?? ""}
          onChange={(e) =>
            onChange({ bool: e.target.value as "" | "yes" | "no" })
          }
          className="ml-2 border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
        >
          <option value="">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
    );
  }

  if (def.type === "number") {
    return (
      <div className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          {def.label}
        </span>
        <input
          type="number"
          aria-label={`${def.label} minimum`}
          placeholder="min"
          value={v.min ?? ""}
          onChange={(e) => onChange({ min: e.target.value })}
          className="ml-2 w-16 border-none bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
        />
        <span className="px-1 text-xs text-gray-400">–</span>
        <input
          type="number"
          aria-label={`${def.label} maximum`}
          placeholder="max"
          value={v.max ?? ""}
          onChange={(e) => onChange({ max: e.target.value })}
          className="w-16 border-none bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
        />
      </div>
    );
  }

  if (def.type === "date") {
    return (
      <div className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          {def.label}
        </span>
        <input
          type="date"
          aria-label={`${def.label} from`}
          value={v.from ?? ""}
          onChange={(e) => onChange({ from: e.target.value })}
          className="ml-2 border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
        />
        <span className="px-1 text-xs text-gray-400">–</span>
        <input
          type="date"
          aria-label={`${def.label} to`}
          value={v.to ?? ""}
          onChange={(e) => onChange({ to: e.target.value })}
          className="border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
        />
      </div>
    );
  }

  // text — substring match
  return (
    <label className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
        {def.label}
      </span>
      <input
        type="text"
        aria-label={def.label}
        placeholder="contains…"
        value={v.text ?? ""}
        onChange={(e) => onChange({ text: e.target.value })}
        className="ml-2 w-32 border-none bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
      />
    </label>
  );
}
