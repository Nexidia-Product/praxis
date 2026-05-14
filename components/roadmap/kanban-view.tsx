"use client";

/**
 * Kanban roadmap view (Section 5.5).
 *
 * Configurable column field, optional swimlanes, optional WIP limits,
 * and named saved configurations. Implemented with HTML5 drag-and-drop
 * rather than a library — the existing Projects table establishes a
 * pattern of native interactions, and this gives us drop targets for
 * each column without an extra dependency.
 *
 * State responsibilities:
 *   - Local: which column / swimlane / WIP limits are active *right now*.
 *     These start from a saved config or the user's last selection.
 *   - Server: list of saved configs (POST/DELETE under
 *     /api/roadmap/kanban-configs).
 *   - Project record: the underlying field value being changed by drag —
 *     PATCH /api/projects/[id] with the new field.
 */

import { useEffect, useMemo, useState } from "react";

import {
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  PRIORITY_BADGE,
  priorityBadgeClass,
} from "@/lib/projects/display";
import {
  PORTFOLIO_POSITION_BADGE,
  computePortfolioPosition,
} from "@/lib/projects/portfolio-position";
import {
  KANBAN_FIELDS,
  findKanbanField,
  type KanbanField,
} from "@/lib/roadmap/fields";
import type {
  PortfolioQuadrantLabels,
  Project,
  SavedKanbanConfig,
} from "@/lib/db";

// Field values valid for direct write-through. `application_product` and
// `project_lead` are open strings — we *can* write them via drag, but
// that's a foot-gun (a typo'd lead becomes a permanent column). We allow
// drag for the four core enum fields and roadmap_bucket only.
const DRAGGABLE_FIELDS = new Set([
  "status",
  "phase",
  "priority",
  "project_type",
  "roadmap_bucket",
]);

interface KanbanViewProps {
  projects: Project[];
  savedConfigs: SavedKanbanConfig[];
  onUpdateField: (
    projectId: string,
    field: string,
    value: string,
  ) => Promise<void>;
  onSaveConfig: (
    config: Omit<SavedKanbanConfig, "config_id" | "created_at" | "created_by">,
  ) => Promise<SavedKanbanConfig>;
  onDeleteConfig: (configId: string) => Promise<void>;
  onOpenQuickView: (projectId: string) => void;
  canEdit: boolean;
  /** User-facing labels for the strategic-position bucket badge. */
  quadrantLabels: PortfolioQuadrantLabels;
}

interface ActiveConfig {
  configId: string | null;
  columnField: string;
  swimlaneField: string | null;
  wipLimits: Record<string, number>;
  columnOrder: string[];
}

export function KanbanView({
  projects,
  savedConfigs,
  onUpdateField,
  onSaveConfig,
  onDeleteConfig,
  onOpenQuickView,
  canEdit,
  quadrantLabels,
}: KanbanViewProps) {
  const [config, setConfig] = useState<ActiveConfig>({
    configId: null,
    columnField: "status",
    swimlaneField: null,
    wipLimits: {},
    columnOrder: [],
  });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columnField = findKanbanField(config.columnField);
  const swimlaneField = config.swimlaneField
    ? findKanbanField(config.swimlaneField)
    : null;
  const draggable = canEdit && DRAGGABLE_FIELDS.has(config.columnField);

  // ---- Derived: column values for the current field. ----
  const columnValues = useMemo(() => {
    if (!columnField) return [];
    if (columnField.values) {
      return [...columnField.values, ""].filter(
        (v, i, arr) => arr.indexOf(v) === i,
      );
    }
    // Data-derived: collect all values seen on projects, plus "" for
    // unbucketed.
    const set = new Set<string>();
    set.add("");
    for (const p of projects) set.add(columnField.getValue(p));
    let values = Array.from(set);
    if (config.columnOrder.length) {
      const known = new Set(values);
      const ordered: string[] = [];
      for (const v of config.columnOrder) {
        if (known.has(v)) {
          ordered.push(v);
          known.delete(v);
        }
      }
      values = [...ordered, ...Array.from(known).sort()];
    } else {
      values.sort((a, b) => {
        if (a === "") return 1;
        if (b === "") return -1;
        return a.localeCompare(b);
      });
    }
    return values;
  }, [columnField, projects, config.columnOrder]);

  const swimlaneValues = useMemo(() => {
    if (!swimlaneField) return [""];
    if (swimlaneField.values) return [...swimlaneField.values, ""];
    const set = new Set<string>();
    set.add("");
    for (const p of projects) set.add(swimlaneField.getValue(p));
    return Array.from(set).sort((a, b) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [swimlaneField, projects]);

  // ---- Bucket projects into [swimlane][column] cells. ----
  const cells = useMemo(() => {
    const map = new Map<string, Map<string, Project[]>>();
    for (const p of projects) {
      if (!columnField) continue;
      const colValue = columnField.getValue(p);
      const swimValue = swimlaneField ? swimlaneField.getValue(p) : "";
      if (!map.has(swimValue)) map.set(swimValue, new Map());
      const inner = map.get(swimValue)!;
      if (!inner.has(colValue)) inner.set(colValue, []);
      inner.get(colValue)!.push(p);
    }
    return map;
  }, [columnField, swimlaneField, projects]);

  function loadConfig(configId: string | "") {
    if (configId === "") {
      setConfig({
        configId: null,
        columnField: "status",
        swimlaneField: null,
        wipLimits: {},
        columnOrder: [],
      });
      return;
    }
    const found = savedConfigs.find((c) => c.config_id === configId);
    if (!found) return;
    setConfig({
      configId: found.config_id,
      columnField: found.column_field,
      swimlaneField: found.swimlane_field,
      wipLimits: found.wip_limits,
      columnOrder: found.column_order,
    });
  }

  async function handleDrop(projectId: string, columnValue: string) {
    if (!draggable || !columnField) return;
    setError(null);
    try {
      await onUpdateField(projectId, columnField.key, columnValue);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to move card.",
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Columns:
        </span>
        <select
          value={config.columnField}
          onChange={(e) =>
            setConfig({
              ...config,
              configId: null,
              columnField: e.target.value,
            })
          }
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          {KANBAN_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Swimlanes:
        </span>
        <select
          value={config.swimlaneField ?? ""}
          onChange={(e) =>
            setConfig({
              ...config,
              configId: null,
              swimlaneField: e.target.value === "" ? null : e.target.value,
            })
          }
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          <option value="">None</option>
          {KANBAN_FIELDS.filter((f) => f.key !== config.columnField).map(
            (f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ),
          )}
        </select>

        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Saved:
        </span>
        <select
          value={config.configId ?? ""}
          onChange={(e) => loadConfig(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          <option value="">— Custom —</option>
          {savedConfigs.map((c) => (
            <option key={c.config_id} value={c.config_id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowSaveDialog(true)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Save view…
        </button>
        {config.configId && (
          <button
            type="button"
            onClick={async () => {
              if (!config.configId) return;
              if (
                globalThis.confirm(
                  "Delete this saved Kanban configuration?",
                )
              ) {
                await onDeleteConfig(config.configId);
                loadConfig("");
              }
            }}
            className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            Delete view
          </button>
        )}
        {!draggable && canEdit && (
          <span className="ml-auto text-xs text-gray-500">
            Drag-to-update is disabled for this column type.
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {!columnField ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500">
          Select a column field to render the board.
        </div>
      ) : (
        <div className="space-y-4">
          {swimlaneValues.map((swim) => {
            const inner = cells.get(swim);
            // Skip empty swimlanes when the user has multiple swimlanes
            // configured — keeps the chart focused on lanes with work.
            if (
              swimlaneField &&
              (!inner || Array.from(inner.values()).every((v) => v.length === 0))
            ) {
              return null;
            }
            return (
              <KanbanSwimlane
                key={swim}
                swimlaneLabel={
                  swimlaneField ? swim || "Unassigned" : null
                }
                columns={columnValues}
                cells={inner ?? new Map()}
                wipLimits={config.wipLimits}
                onWipChange={(col, n) =>
                  setConfig((prev) => {
                    const next = { ...prev.wipLimits };
                    if (n > 0) next[col] = n;
                    else delete next[col];
                    return { ...prev, wipLimits: next, configId: null };
                  })
                }
                draggable={draggable}
                onDrop={handleDrop}
                onOpenQuickView={onOpenQuickView}
                columnField={columnField}
                quadrantLabels={quadrantLabels}
              />
            );
          })}
        </div>
      )}

      {showSaveDialog && (
        <SaveConfigDialog
          initialName=""
          onCancel={() => setShowSaveDialog(false)}
          onSave={async (name) => {
            const saved = await onSaveConfig({
              name,
              column_field: config.columnField,
              swimlane_field: config.swimlaneField,
              wip_limits: config.wipLimits,
              column_order: columnField?.values
                ? []
                : columnValues.filter((v) => v !== ""),
            });
            setConfig({ ...config, configId: saved.config_id });
            setShowSaveDialog(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swimlane (one band of columns)
// ---------------------------------------------------------------------------

interface KanbanSwimlaneProps {
  swimlaneLabel: string | null;
  columns: string[];
  cells: Map<string, Project[]>;
  wipLimits: Record<string, number>;
  onWipChange: (column: string, limit: number) => void;
  draggable: boolean;
  onDrop: (projectId: string, columnValue: string) => void;
  onOpenQuickView: (id: string) => void;
  columnField: KanbanField;
  quadrantLabels: PortfolioQuadrantLabels;
}

function KanbanSwimlane({
  swimlaneLabel,
  columns,
  cells,
  wipLimits,
  onWipChange,
  draggable,
  onDrop,
  onOpenQuickView,
  columnField,
  quadrantLabels,
}: KanbanSwimlaneProps) {
  return (
    <div>
      {swimlaneLabel !== null && (
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-600">
          {swimlaneLabel}
        </h3>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((colValue) => {
          const items = cells.get(colValue) ?? [];
          const wip = wipLimits[colValue] ?? 0;
          const overWip = wip > 0 && items.length > wip;
          const label = colValue === "" ? "Unassigned" : colValue;
          return (
            <KanbanColumn
              key={colValue}
              label={label}
              columnValue={colValue}
              count={items.length}
              wip={wip}
              overWip={overWip}
              draggable={draggable}
              onWipChange={(n) => onWipChange(colValue, n)}
              onDropProject={(id) => onDrop(id, colValue)}
            >
              {items.map((p) => (
                <KanbanCard
                  key={p.project_id}
                  project={p}
                  draggable={draggable}
                  onOpenQuickView={onOpenQuickView}
                  quadrantLabels={quadrantLabels}
                  showCount={
                    columnField.key === "status" ? null : null
                    // Reserved for future enhancement.
                  }
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

interface KanbanColumnProps {
  label: string;
  columnValue: string;
  count: number;
  wip: number;
  overWip: boolean;
  draggable: boolean;
  onWipChange: (limit: number) => void;
  onDropProject: (id: string) => void;
  children: React.ReactNode;
}

function KanbanColumn({
  label,
  count,
  wip,
  overWip,
  draggable,
  onWipChange,
  onDropProject,
  children,
}: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!draggable) return;
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropProject(id);
      }}
      className={`flex w-72 shrink-0 flex-col rounded-lg border ${
        overWip
          ? "border-red-300 bg-red-50/30"
          : dragOver
            ? "border-gray-900 bg-gray-50"
            : "border-gray-200 bg-gray-50/40"
      }`}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              overWip
                ? "bg-red-100 text-red-800"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {count}
            {wip > 0 ? ` / ${wip}` : ""}
          </span>
        </div>
        <input
          type="number"
          min={0}
          value={wip || ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onWipChange(Number.isFinite(n) ? Math.max(0, n) : 0);
          }}
          placeholder="WIP"
          className="w-12 rounded border border-gray-200 px-1 py-0.5 text-xs"
        />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface KanbanCardProps {
  project: Project;
  draggable: boolean;
  onOpenQuickView: (id: string) => void;
  showCount?: number | null;
  /** User-facing labels for the strategic-position bucket badge. */
  quadrantLabels: PortfolioQuadrantLabels;
}

function KanbanCard({
  project,
  draggable,
  onOpenQuickView,
  quadrantLabels,
}: KanbanCardProps) {
  const [grabbed, setGrabbed] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("text/plain", project.project_id);
        e.dataTransfer.effectAllowed = "move";
        setGrabbed(true);
      }}
      onDragEnd={() => setGrabbed(false)}
      onClick={() => onOpenQuickView(project.project_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenQuickView(project.project_id);
        }
      }}
      className={`group cursor-pointer rounded-md border border-gray-200 bg-white p-2 shadow-sm transition hover:border-gray-300 hover:shadow ${
        grabbed ? "opacity-50" : ""
      }`}
      title={project.description}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] text-gray-500">
          {project.project_id}
        </span>
        <div className="flex items-center gap-1">
          {project.health_score && (
            <span
              className={`h-2 w-2 rounded-full ${HEALTH_DOT[project.health_score]}`}
              title={`${project.health_score} — ${HEALTH_TOOLTIP[project.health_score]}`}
            />
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${priorityBadgeClass(project.priority)}`}
          >
            {project.priority}
          </span>
        </div>
      </div>
      <div className="mt-1 text-sm font-medium text-gray-900">
        {project.name}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
        {(() => {
          // Strategic position badge. Hidden for unknown buckets
          // (no AI complexity score) so cards stay clean — the row
          // only earns the visual weight when there's a real bucket
          // to communicate.
          const pos = computePortfolioPosition(project, quadrantLabels);
          if (pos.key === "unknown") return null;
          return (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PORTFOLIO_POSITION_BADGE[pos.key]}`}
              title={`${project.priority} priority × ${project.ai_complexity_score} complexity`}
            >
              {pos.label}
            </span>
          );
        })()}
        {project.project_lead && (
          <span className="truncate">{project.project_lead}</span>
        )}
        {project.target_date && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5">
            {project.target_date}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save dialog
// ---------------------------------------------------------------------------

interface SaveConfigDialogProps {
  initialName: string;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}

function SaveConfigDialog({
  initialName,
  onCancel,
  onSave,
}: SaveConfigDialogProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">
          Save Kanban view
        </h3>
        <p className="mt-1 text-xs text-gray-600">
          Name this configuration so the team can load it from the Saved
          dropdown.
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          placeholder="e.g. By Phase / Sprint board"
        />
        {error && (
          <p className="mt-2 text-xs text-red-700">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave(name.trim());
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Failed to save.",
                );
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:bg-gray-400"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
