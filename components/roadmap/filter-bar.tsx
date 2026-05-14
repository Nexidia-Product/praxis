"use client";

/**
 * Shared filter bar for all roadmap views (Sections 5.4–5.8).
 *
 * Smaller than the Projects-page filter bar — we drop the custom-field
 * support and the target-date range, since none of the roadmap views
 * filter by either. The layout is a horizontal row of compact dropdowns
 * to keep the chart area as tall as possible.
 */

import { useEffect, useRef, useState } from "react";

import {
  PORTFOLIO_PROJECT_TYPES,
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
} from "@/lib/projects/display";
import type { RoadmapFilters } from "@/lib/roadmap/filters";

interface RoadmapFilterBarProps {
  filters: RoadmapFilters;
  onChange: (next: RoadmapFilters) => void;
  leadOptions: string[];
  applicationOptions: string[];
  /** Optional: render a checkbox to include closed projects. Default off. */
  includeClosed?: boolean;
  onIncludeClosedChange?: (next: boolean) => void;
}

export function RoadmapFilterBar({
  filters,
  onChange,
  leadOptions,
  applicationOptions,
  includeClosed,
  onIncludeClosedChange,
}: RoadmapFilterBarProps) {
  const set = <K extends keyof RoadmapFilters>(
    key: K,
    value: RoadmapFilters[K],
  ) => onChange({ ...filters, [key]: value });

  const activeCount =
    filters.status.length +
    filters.phase.length +
    filters.priority.length +
    filters.project_type.length +
    filters.project_lead.length +
    filters.application_product.length +
    (filters.search ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
      <input
        type="search"
        placeholder="Search…"
        value={filters.search}
        onChange={(e) => set("search", e.target.value)}
        className="flex-1 min-w-[140px] rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
      />
      <MultiPicker
        label="Status"
        options={PROJECT_STATUSES}
        selected={filters.status}
        onChange={(v) => set("status", v as RoadmapFilters["status"])}
      />
      <MultiPicker
        label="Phase"
        options={PROJECT_PHASES}
        selected={filters.phase}
        onChange={(v) => set("phase", v as RoadmapFilters["phase"])}
      />
      <MultiPicker
        label="Priority"
        options={PRIORITIES}
        selected={filters.priority}
        onChange={(v) => set("priority", v as RoadmapFilters["priority"])}
      />
      <MultiPicker
        label="Type"
        options={PORTFOLIO_PROJECT_TYPES}
        selected={filters.project_type}
        onChange={(v) => set("project_type", v as RoadmapFilters["project_type"])}
      />
      {leadOptions.length > 0 && (
        <MultiPicker
          label="Lead"
          options={leadOptions}
          selected={filters.project_lead}
          onChange={(v) => set("project_lead", v)}
        />
      )}
      {applicationOptions.length > 0 && (
        <MultiPicker
          label="App / Product"
          options={applicationOptions}
          selected={filters.application_product}
          onChange={(v) => set("application_product", v)}
        />
      )}
      {includeClosed !== undefined && onIncludeClosedChange && (
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => onIncludeClosedChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
          />
          Include closed
        </label>
      )}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={() =>
            onChange({
              status: [],
              phase: [],
              priority: [],
              project_type: [],
              project_lead: [],
              application_product: [],
              search: "",
            })
          }
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Clear
        </button>
      )}
    </div>
  );
}

interface MultiPickerProps<T extends string> {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
}

function MultiPicker<T extends string>({
  label,
  options,
  selected,
  onChange,
}: MultiPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
          selected.length > 0
            ? "border-gray-900 bg-gray-900 text-white"
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="rounded bg-white/20 px-1 text-[10px]">
            {selected.length}
          </span>
        )}
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {options.map((opt) => {
            const isOn = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-gray-50 ${
                  isOn ? "font-medium text-gray-900" : "text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  readOnly
                  className="h-3 w-3 rounded border-gray-300 pointer-events-none"
                />
                <span className="truncate">{opt}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
