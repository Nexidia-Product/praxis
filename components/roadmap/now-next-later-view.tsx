"use client";

/**
 * Now / Next / Later roadmap view (Section 5.7).
 *
 * Three fixed columns plus an "Unplaced" overflow lane. Auto-placement
 * suggests a column for each project (see lib/roadmap/placement.ts);
 * dragging a card to a column writes the value to roadmap_bucket so the
 * placement is locked in.
 *
 * Distinct from the Kanban view: those columns map to operational state
 * (status / phase). These map to *time horizon* — communication, not
 * workflow.
 */

import { useMemo, useState } from "react";

import {
  HEALTH_DOT,
  PRIORITY_BADGE,
  STATUS_BADGE,
  priorityBadgeClass,
  statusBadgeClass,
} from "@/lib/projects/display";
import {
  NNL_COLUMNS,
  isAutoPlaced,
  resolveBucket,
  type NowNextLaterBucket,
} from "@/lib/roadmap/placement";
import { findKanbanField, KANBAN_FIELDS } from "@/lib/roadmap/fields";
import type { Project } from "@/lib/db";

const SWIMLANE_OPTIONS = KANBAN_FIELDS.filter((f) =>
  ["application_product", "project_type", "project_lead"].includes(f.key),
);

interface NowNextLaterViewProps {
  projects: Project[];
  onUpdateField: (
    projectId: string,
    field: string,
    value: string,
  ) => Promise<void>;
  onOpenQuickView: (projectId: string) => void;
  canEdit: boolean;
}

type ColorBy = "priority" | "status";

export function NowNextLaterView({
  projects,
  onUpdateField,
  onOpenQuickView,
  canEdit,
}: NowNextLaterViewProps) {
  const [swimlaneKey, setSwimlaneKey] = useState<string>("");
  const [colorBy, setColorBy] = useState<ColorBy>("priority");
  const [error, setError] = useState<string | null>(null);

  const swimlaneField = swimlaneKey ? findKanbanField(swimlaneKey) : null;

  // Each project has a resolved bucket plus an auto-placed flag. Closed
  // projects are filtered out (resolveBucket returns null for them).
  const placed = useMemo(() => {
    const out: {
      project: Project;
      bucket: NowNextLaterBucket;
      auto: boolean;
      swimlaneValue: string;
    }[] = [];
    for (const p of projects) {
      const bucket = resolveBucket(p);
      if (!bucket) continue;
      out.push({
        project: p,
        bucket,
        auto: isAutoPlaced(p),
        swimlaneValue: swimlaneField ? swimlaneField.getValue(p) : "",
      });
    }
    return out;
  }, [projects, swimlaneField]);

  // Build the [swimlane][bucket] grid.
  const grid = useMemo(() => {
    const map = new Map<string, Map<NowNextLaterBucket, typeof placed>>();
    for (const item of placed) {
      const key = item.swimlaneValue;
      if (!map.has(key)) map.set(key, new Map());
      const inner = map.get(key)!;
      if (!inner.has(item.bucket)) inner.set(item.bucket, []);
      inner.get(item.bucket)!.push(item);
    }
    return map;
  }, [placed]);

  const swimlaneValues = useMemo(() => {
    if (!swimlaneField) return [""];
    const set = new Set<string>();
    for (const p of projects) set.add(swimlaneField.getValue(p));
    const arr = Array.from(set).filter((v) => v !== "");
    arr.sort();
    return arr.length > 0 ? arr : [""];
  }, [swimlaneField, projects]);

  async function handleDrop(projectId: string, bucket: NowNextLaterBucket) {
    if (!canEdit) return;
    setError(null);
    try {
      await onUpdateField(projectId, "roadmap_bucket", bucket);
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
          Group rows by:
        </span>
        <select
          value={swimlaneKey}
          onChange={(e) => setSwimlaneKey(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          <option value="">None</option>
          {SWIMLANE_OPTIONS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Color:
        </span>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
          {(["priority", "status"] as ColorBy[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColorBy(c)}
              className={`rounded px-3 py-0.5 text-xs capitalize ${
                colorBy === c
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">
            Auto
          </span>
          = system-suggested placement, drag to lock in
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {placed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500">
          No active projects to place.
        </div>
      ) : (
        <div className="space-y-4">
          {swimlaneValues.map((swim) => {
            const inner = grid.get(swim);
            return (
              <div key={swim || "_default"} className="space-y-3">
                {swimlaneField && (
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-600">
                    {swim || "Unassigned"}
                  </h3>
                )}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {/* The three primary horizon columns. Unplaced is
                      rendered separately below as a wide overflow
                      lane (Section 5.7) — it's conceptually "off the
                      timeline" and shouldn't visually compete with
                      the three actual horizons. */}
                  {NNL_COLUMNS.filter((b) => b !== "Unplaced").map((bucket) => {
                    const items = inner?.get(bucket) ?? [];
                    return (
                      <NNLColumn
                        key={bucket}
                        bucket={bucket}
                        items={items}
                        canEdit={canEdit}
                        colorBy={colorBy}
                        onDropProject={(id) => handleDrop(id, bucket)}
                        onOpenQuickView={onOpenQuickView}
                      />
                    );
                  })}
                </div>
                {/* Unplaced overflow lane (Section 5.7). Always
                    rendered so users can drag a project here to park
                    it — without an always-visible drop target there's
                    no way to manually move something into Unplaced.
                    Visually quieter than the three horizon columns
                    (no fixed minimum height, lighter empty state) so
                    it doesn't compete for attention when empty. */}
                {(() => {
                  const items = inner?.get("Unplaced") ?? [];
                  return (
                    <NNLColumn
                      bucket="Unplaced"
                      items={items}
                      canEdit={canEdit}
                      colorBy={colorBy}
                      onDropProject={(id) => handleDrop(id, "Unplaced")}
                      onOpenQuickView={onOpenQuickView}
                    />
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One column
// ---------------------------------------------------------------------------

interface NNLColumnProps {
  bucket: NowNextLaterBucket;
  items: { project: Project; bucket: NowNextLaterBucket; auto: boolean }[];
  canEdit: boolean;
  colorBy: ColorBy;
  onDropProject: (id: string) => void;
  onOpenQuickView: (id: string) => void;
}

const COLUMN_DESC: Record<NowNextLaterBucket, string> = {
  Now: "Active and committed for the current cycle.",
  Next: "Committed; starting within ~1 quarter.",
  Later: "Planned but not yet scheduled.",
  Unplaced:
    "Paused or unsigned to a horizon — drag to place, or update status / target date.",
};

function NNLColumn({
  bucket,
  items,
  canEdit,
  colorBy,
  onDropProject,
  onOpenQuickView,
}: NNLColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  // Unplaced is a parking lot, not a horizon — visually quieter so it
  // doesn't compete with the Now/Next/Later columns. Dashed border,
  // smaller minimum height when empty, lighter idle background.
  const isUnplaced = bucket === "Unplaced";
  const empty = items.length === 0;
  const baseBorder = isUnplaced ? "border-dashed" : "";
  const minHeight = isUnplaced && empty ? "min-h-[60px]" : "min-h-[120px]";
  return (
    <div
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!canEdit) return;
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropProject(id);
      }}
      className={`flex ${minHeight} flex-col rounded-lg border ${baseBorder} ${
        dragOver
          ? "border-gray-900 bg-gray-50"
          : "border-gray-200 bg-gray-50/40"
      }`}
    >
      <div className="border-b border-gray-200 px-3 py-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">{bucket}</h4>
          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
            {items.length}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500">
          {COLUMN_DESC[bucket]}
        </p>
      </div>
      <div className="flex-1 space-y-2 p-2">
        {items.map(({ project, auto }) => (
          <NNLCard
            key={project.project_id}
            project={project}
            auto={auto}
            canEdit={canEdit}
            colorBy={colorBy}
            onOpenQuickView={onOpenQuickView}
          />
        ))}
        {items.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-gray-400">
            Drag projects here.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------

interface NNLCardProps {
  project: Project;
  auto: boolean;
  canEdit: boolean;
  colorBy: ColorBy;
  onOpenQuickView: (id: string) => void;
}

function NNLCard({
  project,
  auto,
  canEdit,
  colorBy,
  onOpenQuickView,
}: NNLCardProps) {
  const [grabbed, setGrabbed] = useState(false);
  const colorBadge =
    colorBy === "priority"
      ? priorityBadgeClass(project.priority)
      : statusBadgeClass(project.status);
  const colorLabel =
    colorBy === "priority" ? project.priority : project.status;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={canEdit}
      onDragStart={(e) => {
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
      className={`cursor-pointer rounded-md border bg-white p-2 shadow-sm transition hover:border-gray-300 hover:shadow ${
        auto ? "border-dashed border-gray-300" : "border-gray-200"
      } ${grabbed ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] text-gray-500">
          {project.project_id}
        </span>
        <div className="flex items-center gap-1">
          {project.health_score && (
            <span
              className={`h-2 w-2 rounded-full ${HEALTH_DOT[project.health_score]}`}
              title={`Health: ${project.health_score}`}
            />
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${colorBadge}`}
          >
            {colorLabel}
          </span>
          {auto && (
            <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-medium uppercase text-gray-500">
              Auto
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 text-sm font-medium text-gray-900">
        {project.name}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
        <span className="truncate">{project.application_product}</span>
        {project.project_lead && (
          <span className="truncate">· {project.project_lead}</span>
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
