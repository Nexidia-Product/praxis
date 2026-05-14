"use client";

/**
 * "Depends on" editor (Section 5.10).
 *
 * Multi-select widget for choosing upstream projects, with per-row
 * dependency type (Blocks Start | Blocks Phase) and an optional required
 * phase when the type is "Blocks Phase". Used by the project form modal.
 *
 * Read-only display variant lives in `dependency-chips.tsx` — that one is
 * what shows up in the quick view, where editing isn't allowed (per the
 * roadmap workspace's "edit happens in the modal" rule).
 *
 * State management:
 *   - The parent owns the canonical `dependencies: ProjectDependency[]`
 *     array; this component is fully controlled.
 *   - Adding a row: pick from the project picker, then it appears with a
 *     default of "Blocks Start". The user can change the type and pick a
 *     required phase from there.
 *   - Removing a row: × on the row.
 *
 * Self-loops are filtered out of the picker server-side AND here; the
 * service layer is the source of truth for cycles, but we save a round
 * trip by hiding the obvious case.
 */

import { useState } from "react";

import { PROJECT_PHASES, statusBadgeClass } from "@/lib/projects/display";
import type {
  DependencyType,
  Project,
  ProjectDependency,
  ProjectId,
  ProjectPhase,
  ProjectStatus,
} from "@/lib/db";

interface DependencyEditorProps {
  /** Project whose dependencies are being edited (null on create). */
  selfId: ProjectId | null;
  /** Current dependencies on the project (controlled). */
  value: ProjectDependency[];
  onChange: (next: ProjectDependency[]) => void;
  /** Full project list, for the picker and status display. */
  allProjects: Project[];
  disabled?: boolean;
}

const DEPENDENCY_TYPES: DependencyType[] = ["Blocks Start", "Blocks Phase"];

export function DependencyEditor({
  selfId,
  value,
  onChange,
  allProjects,
  disabled,
}: DependencyEditorProps) {
  const [pickerValue, setPickerValue] = useState("");

  // Don't allow picking yourself or a project that's already in the list.
  const alreadyDependent = new Set(value.map((d) => d.upstream_id));
  const pickable = allProjects.filter(
    (p) => p.project_id !== selfId && !alreadyDependent.has(p.project_id),
  );
  // Sort by ID for predictable scrolling in the picker.
  pickable.sort((a, b) => a.project_id.localeCompare(b.project_id));

  const projectsById = new Map(allProjects.map((p) => [p.project_id, p]));

  function addDependency() {
    if (!pickerValue) return;
    onChange([
      ...value,
      {
        upstream_id: pickerValue,
        type: "Blocks Start",
        required_phase: null,
      },
    ]);
    setPickerValue("");
  }

  function updateRow(idx: number, patch: Partial<ProjectDependency>) {
    onChange(
      value.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
    );
  }

  function setType(idx: number, type: DependencyType) {
    // Switching to "Blocks Start" clears the required phase; switching to
    // "Blocks Phase" defaults required_phase to the upstream's current
    // phase if available, otherwise the first enum value.
    if (type === "Blocks Start") {
      updateRow(idx, { type, required_phase: null });
      return;
    }
    const dep = value[idx];
    const upstream = projectsById.get(dep.upstream_id);
    updateRow(idx, {
      type,
      required_phase: upstream?.phase ?? PROJECT_PHASES[0],
    });
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
          Depends on
        </h3>
        <p className="text-[11px] text-gray-500">
          {value.length === 0
            ? "No upstream dependencies."
            : `${value.length} upstream ${value.length === 1 ? "project" : "projects"}.`}
        </p>
      </div>

      {value.length > 0 ? (
        <ul className="space-y-2">
          {value.map((dep, idx) => {
            const upstream = projectsById.get(dep.upstream_id);
            return (
              <li
                key={dep.upstream_id}
                className="rounded-md border border-gray-200 bg-white p-2"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-gray-500">
                        {dep.upstream_id}
                      </span>
                      <span className="truncate text-sm text-gray-900">
                        {upstream?.name ?? "(missing)"}
                      </span>
                      {upstream ? (
                        <UpstreamStatusBadge status={upstream.status} />
                      ) : (
                        <span className="inline-flex rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-800 ring-1 ring-inset ring-red-200">
                          MISSING
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
                      <select
                        value={dep.type}
                        onChange={(e) =>
                          setType(idx, e.target.value as DependencyType)
                        }
                        disabled={disabled}
                        className={inputCls}
                        aria-label="Dependency type"
                      >
                        {DEPENDENCY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      {dep.type === "Blocks Phase" ? (
                        <select
                          value={dep.required_phase ?? PROJECT_PHASES[0]}
                          onChange={(e) =>
                            updateRow(idx, {
                              required_phase: e.target.value as ProjectPhase,
                            })
                          }
                          disabled={disabled}
                          className={inputCls}
                          aria-label="Required phase"
                        >
                          {PROJECT_PHASES.map((p) => (
                            <option key={p} value={p}>
                              Until phase: {p}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="self-center text-[11px] italic text-gray-500">
                          Upstream must complete before this can begin.
                        </span>
                      )}
                    </div>
                  </div>
                  {!disabled ? (
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="-m-1 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Remove dependency on ${dep.upstream_id}`}
                      title="Remove"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 5l10 10M15 5L5 15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!disabled ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="dep-picker"
              className="block text-[11px] font-medium uppercase tracking-wider text-gray-600"
            >
              Add upstream project
            </label>
            <select
              id="dep-picker"
              value={pickerValue}
              onChange={(e) => setPickerValue(e.target.value)}
              className={`mt-1 ${inputCls}`}
            >
              <option value="">— Choose a project —</option>
              {pickable.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_id} · {p.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={addDependency}
            disabled={!pickerValue}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UpstreamStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100";
