"use client";

/**
 * Filter bar for the Tasks page (Section 5.2) and My Tasks page (Section 5.3).
 *
 * The same component serves both pages. On My Tasks the parent passes
 * `hideResponsible` so the "assigned to" dropdown is suppressed (the page
 * is already scoped to the current user).
 *
 * The multi-select pattern matches the project filter bar — option counts
 * are small (a few statuses, a few priorities) so a custom dropdown beats
 * pulling in a combobox library. If the contributor list grows beyond ~30
 * names, swap in a search-able dropdown.
 *
 * Blocked is a tri-state: empty (all), "yes" (only blocked), "no" (only
 * unblocked). It sits beside the status dropdown rather than inside it
 * because `task.blocked` is independent of `task.status` — a task can be
 * In Progress AND blocked at the same time.
 */

import { useEffect, useRef, useState } from "react";

import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/display";
import type { Priority, TaskStatus } from "@/lib/db";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export interface TaskFilters {
  status: TaskStatus[];
  priority: Priority[];
  project_id: string[];
  responsible: string[];
  /** Tri-state. "" = either, "yes" = blocked only, "no" = unblocked only. */
  blocked: "" | "yes" | "no";
  due_from: string; // YYYY-MM-DD or ""
  due_to: string;   // YYYY-MM-DD or ""
  search: string;
}

export const EMPTY_TASK_FILTERS: TaskFilters = {
  status: [],
  priority: [],
  project_id: [],
  responsible: [],
  blocked: "",
  due_from: "",
  due_to: "",
  search: "",
};

export function isTaskFilterActive(f: TaskFilters): boolean {
  return (
    f.status.length > 0 ||
    f.priority.length > 0 ||
    f.project_id.length > 0 ||
    f.responsible.length > 0 ||
    f.blocked !== "" ||
    f.due_from !== "" ||
    f.due_to !== "" ||
    f.search !== ""
  );
}

// ---------------------------------------------------------------------------
// Multi-select dropdown — same pattern as project filter bar
// ---------------------------------------------------------------------------

interface MultiSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        ? selected[0]
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
                  <span className="text-gray-800">{opt}</span>
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

interface TaskFilterBarProps {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
  /** Distinct project IDs in the current dataset. */
  projectOptions: string[];
  /** Distinct responsible values in the current dataset. */
  responsibleOptions: string[];
  /** When true, suppress the "Assigned to" dropdown (used on /my-tasks). */
  hideResponsible?: boolean;
}

export function TaskFilterBar({
  filters,
  onChange,
  projectOptions,
  responsibleOptions,
  hideResponsible,
}: TaskFilterBarProps) {
  function update<K extends keyof TaskFilters>(
    key: K,
    value: TaskFilters[K],
  ) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <MultiSelect
        label="Status"
        options={TASK_STATUSES}
        selected={filters.status}
        onChange={(v) => update("status", v)}
      />
      <MultiSelect
        label="Priority"
        options={TASK_PRIORITIES}
        selected={filters.priority}
        onChange={(v) => update("priority", v)}
      />
      <MultiSelect
        label="Project"
        options={projectOptions}
        selected={filters.project_id}
        onChange={(v) => update("project_id", v)}
      />
      {!hideResponsible ? (
        <MultiSelect
          label="Assigned to"
          options={responsibleOptions}
          selected={filters.responsible}
          onChange={(v) => update("responsible", v)}
        />
      ) : null}

      <label className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          Blocked
        </span>
        <select
          aria-label="Blocked filter"
          value={filters.blocked}
          onChange={(e) =>
            update("blocked", e.target.value as TaskFilters["blocked"])
          }
          className="ml-2 border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
        >
          <option value="">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>

      <div className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 shadow-sm">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          Due
        </span>
        <input
          type="date"
          aria-label="Due date from"
          value={filters.due_from}
          onChange={(e) => update("due_from", e.target.value)}
          className="ml-2 border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
        />
        <span className="px-1 text-xs text-gray-400">–</span>
        <input
          type="date"
          aria-label="Due date to"
          value={filters.due_to}
          onChange={(e) => update("due_to", e.target.value)}
          className="border-none bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <input
          type="search"
          placeholder="Search tasks…"
          value={filters.search}
          onChange={(e) => update("search", e.target.value)}
          className="h-9 w-56 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        {isTaskFilterActive(filters) ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_TASK_FILTERS)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}
