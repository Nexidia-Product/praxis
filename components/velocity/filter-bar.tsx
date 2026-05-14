"use client";

/**
 * Filter bar for the Velocity Dashboard (Section 5.15).
 *
 * Drives a parent-owned `VelocityFilters` value through `onChange`. The
 * dashboard refetches whenever the filters object changes — see
 * `dashboard.tsx` for the wiring.
 *
 * Five controls:
 *
 *   - Time range: a fixed-set selector with the five preset windows from
 *     the design doc (30d / 90d / 6mo / 1yr / all) plus a "Custom" mode
 *     that reveals two date inputs.
 *   - Project type: multi-select (each entry is a chip toggle, since
 *     there are only four enum values).
 *   - Application/Product: dropdown populated from filter_options, with
 *     a clear button.
 *   - Project lead: dropdown of distinct lead user_ids.
 *   - Individual contributor view (Admin / self only): a toggle that
 *     re-scopes the metrics to one person.
 *
 * The filter object is built shallow-immutably — every change creates a
 * fresh `VelocityFilters` and emits it. That keeps the parent's
 * dependency comparison cheap and prevents the dashboard from holding a
 * stale filter reference between fetches.
 */

import { useId } from "react";

import { PORTFOLIO_PROJECT_TYPES } from "@/lib/projects/display";
import type {
  VelocityFilters,
  VelocityRangeKind,
} from "@/lib/velocity/types";
import type { ProjectType, UserId, UserRole } from "@/lib/db";

const RANGE_OPTIONS: { value: VelocityRangeKind; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "6mo", label: "6 months" },
  { value: "1yr", label: "1 year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom…" },
];

interface VelocityFilterBarProps {
  value: VelocityFilters;
  /** Called with a fresh filter set on any change. */
  onChange: (next: VelocityFilters) => void;
  /** Filter-option lists from the most recent metrics response. */
  options: {
    application_products: string[];
    project_leads: { user_id: UserId; label: string }[];
  };
  currentUserId: UserId;
  currentUserRole: UserRole;
  /** Optional values for the custom-range start / end date inputs. */
  customStart: string;
  customEnd: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}

export function VelocityFilterBar({
  value,
  onChange,
  options,
  currentUserId,
  currentUserRole,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: VelocityFilterBarProps) {
  const ids = {
    range: useId(),
    product: useId(),
    lead: useId(),
    individual: useId(),
    customStart: useId(),
    customEnd: useId(),
  };

  const isAdmin = currentUserRole === "Admin";
  const me = currentUserId;

  // Toggle-or-untoggle a project type chip.
  function toggleType(t: ProjectType) {
    const next = value.project_types.includes(t)
      ? value.project_types.filter((x) => x !== t)
      : [...value.project_types, t];
    onChange({ ...value, project_types: next });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Time range */}
        <div>
          <label
            htmlFor={ids.range}
            className="block text-xs font-medium text-gray-700"
          >
            Time range
          </label>
          <select
            id={ids.range}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
            value={value.range.kind}
            onChange={(e) =>
              onChange({
                ...value,
                range: { ...value.range, kind: e.target.value as VelocityRangeKind },
              })
            }
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {value.range.kind === "custom" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor={ids.customStart}
                  className="block text-[10px] font-medium uppercase text-gray-500"
                >
                  Start
                </label>
                <input
                  id={ids.customStart}
                  type="date"
                  value={customStart}
                  onChange={(e) => onCustomStartChange(e.target.value)}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor={ids.customEnd}
                  className="block text-[10px] font-medium uppercase text-gray-500"
                >
                  End
                </label>
                <input
                  id={ids.customEnd}
                  type="date"
                  value={customEnd}
                  onChange={(e) => onCustomEndChange(e.target.value)}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Project type chips */}
        <div>
          <label className="block text-xs font-medium text-gray-700">
            Project type
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {PORTFOLIO_PROJECT_TYPES.map((t) => {
              const selected = value.project_types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`rounded px-2 py-1 text-xs ring-1 ring-inset ${
                    selected
                      ? "bg-gray-900 text-white ring-gray-900"
                      : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {t}
                </button>
              );
            })}
            {value.project_types.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange({ ...value, project_types: [] })}
                className="text-xs text-gray-500 underline-offset-2 hover:underline"
              >
                clear
              </button>
            ) : null}
          </div>
        </div>

        {/* Application/Product */}
        <div>
          <label
            htmlFor={ids.product}
            className="block text-xs font-medium text-gray-700"
          >
            Application / product
          </label>
          <select
            id={ids.product}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            value={value.application_products[0] ?? ""}
            onChange={(e) => {
              const next = e.target.value
                ? [e.target.value]
                : [];
              onChange({ ...value, application_products: next });
            }}
          >
            <option value="">All</option>
            {options.application_products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Project lead */}
        <div>
          <label
            htmlFor={ids.lead}
            className="block text-xs font-medium text-gray-700"
          >
            Project lead
          </label>
          <select
            id={ids.lead}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            value={value.project_leads[0] ?? ""}
            onChange={(e) => {
              const next = e.target.value ? [e.target.value] : [];
              onChange({ ...value, project_leads: next });
            }}
          >
            <option value="">All</option>
            {options.project_leads.map((l) => (
              <option key={l.user_id} value={l.user_id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Individual contributor view */}
        <div>
          <label className="block text-xs font-medium text-gray-700">
            Individual view
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id={ids.individual}
              type="checkbox"
              checked={value.individual_user_id === me}
              onChange={(e) =>
                onChange({
                  ...value,
                  individual_user_id: e.target.checked ? me : null,
                })
              }
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor={ids.individual} className="text-sm text-gray-700">
              Just my work
            </label>
          </div>
          {isAdmin ? (
            <p className="mt-1 text-[10px] text-gray-500">
              Admins can also pass <code>?individual=&lt;user_id&gt;</code> in the URL
              to view another user's velocity.
            </p>
          ) : null}
        </div>

        {/* Reset button */}
        <div className="flex items-end">
          <button
            type="button"
            onClick={() =>
              onChange({
                range: { kind: "90d", start: null, end: "" },
                project_types: [],
                application_products: [],
                project_leads: [],
                individual_user_id: null,
              })
            }
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
}
