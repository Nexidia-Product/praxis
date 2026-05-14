"use client";

/**
 * Timeline (Gantt) roadmap view (Section 5.4).
 *
 * Built as a CSS-grid Gantt rather than pulling in a third-party Gantt
 * library — the rest of the app intentionally has zero UI dependencies,
 * and the layout we need (one row per project, fractional-position bars
 * over a calendar header) maps cleanly to a grid + absolute-positioned
 * bars.
 *
 * Interactions:
 *   - Click a bar to open the project quick-view.
 *   - Drag the right edge of a bar to adjust target_date (with confirmation).
 *   - Granularity toggle (weeks / months / quarters).
 *   - Today line rendered as a vertical highlight.
 *
 * The drag uses pointer events with no library: pointerdown captures the
 * starting fraction, pointermove updates a "ghost" bar end, pointerup
 * sends the PATCH. This keeps the drag interaction responsive without
 * round-tripping every move.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  PRIORITY_BADGE,
  STATUS_BADGE,
  priorityBadgeClass,
  statusBadgeClass,
} from "@/lib/projects/display";
import { dependencyHealth, type DependencyHealth } from "@/lib/projects/dependencies";
import type { Project } from "@/lib/db";
import {
  buildWindow,
  fractionToDate,
  formatIsoDate,
  generateTicks,
  projectProjectBar,
  todayUtc,
  type DateGranularity,
  type TimeWindow,
} from "@/lib/roadmap/dates";

interface TimelineViewProps {
  projects: Project[];
  onUpdateTargetDate: (
    projectId: string,
    targetDate: string,
  ) => Promise<void> | void;
  onOpenQuickView: (projectId: string) => void;
  canEdit: boolean;
}

type ColorBy = "priority" | "status";

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 32;
const SIDEBAR_WIDTH = 240;
const MIN_BAR_WIDTH_PCT = 1.5;

/**
 * Tailwind colors translated to hex for SVG `stroke` (Tailwind classes
 * don't apply to SVG attribute-based strokes). These match emerald-500,
 * amber-500, and red-600 visually so the arrows blend with the existing
 * status palette.
 */
const ARROW_COLOR: Record<DependencyHealth, string> = {
  clear: "#10b981",
  "at-risk": "#f59e0b",
  blocked: "#dc2626",
};

export function TimelineView({
  projects,
  onUpdateTargetDate,
  onOpenQuickView,
  canEdit,
}: TimelineViewProps) {
  const [granularity, setGranularity] = useState<DateGranularity>("months");
  const [colorBy, setColorBy] = useState<ColorBy>("priority");
  const [windowSpec, setWindowSpec] = useState<{
    before: number;
    after: number;
  }>({ before: 1, after: 5 });

  /**
   * In-app confirmation flow for drag-to-change-target-date (ROAD-04).
   * The previous implementation called `globalThis.confirm` and `alert`,
   * which renders the browser's native dialog and clashes with the rest
   * of the application's UI. The row now calls
   * `requestTargetDateChange`; we open a modal here, then dispatch
   * `onUpdateTargetDate` only after the user confirms.
   */
  const [pendingDateChange, setPendingDateChange] = useState<{
    projectId: string;
    projectName: string;
    fromLabel: string;
    toIso: string;
    saving: boolean;
    error: string | null;
  } | null>(null);

  const requestTargetDateChange = (
    projectId: string,
    projectName: string,
    fromIso: string | null,
    toIso: string,
  ) => {
    setPendingDateChange({
      projectId,
      projectName,
      fromLabel: fromIso || "(no target)",
      toIso,
      saving: false,
      error: null,
    });
  };

  const cancelDateChange = () => setPendingDateChange(null);

  const confirmDateChange = async () => {
    const pending = pendingDateChange;
    if (!pending || pending.saving) return;
    setPendingDateChange({ ...pending, saving: true, error: null });
    try {
      await Promise.resolve(
        onUpdateTargetDate(pending.projectId, pending.toIso),
      );
      setPendingDateChange(null);
    } catch (err) {
      console.error(err);
      setPendingDateChange({
        ...pending,
        saving: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to update target date.",
      });
    }
  };

  const window: TimeWindow = useMemo(
    () => buildWindow(granularity, windowSpec.before, windowSpec.after),
    [granularity, windowSpec],
  );

  const ticks = useMemo(() => generateTicks(window), [window]);

  const todayFrac = useMemo(() => {
    const today = todayUtc();
    if (today < window.start || today >= window.end) return null;
    return (
      (today.getTime() - window.start.getTime()) /
      (window.end.getTime() - window.start.getTime())
    );
  }, [window]);

  // Sort projects by their bar start so the chart reads top-down by
  // earliest activity. Projects fully outside the window are dropped.
  const rows = useMemo(() => {
    const out: { project: Project; bar: ReturnType<typeof projectProjectBar> }[] =
      [];
    for (const p of projects) {
      const bar = projectProjectBar(p, window);
      if (!bar || bar.hidden) continue;
      out.push({ project: p, bar });
    }
    out.sort((a, b) => {
      const ad = a.bar?.start.getTime() ?? 0;
      const bd = b.bar?.start.getTime() ?? 0;
      if (ad !== bd) return ad - bd;
      return a.project.project_id.localeCompare(b.project.project_id);
    });
    return out;
  }, [projects, window]);

  // ---- Step 6: dependency arrows. -----------------------------------
  //
  // Build an arrow for every dependency edge whose *both* ends are
  // currently visible in `rows` (i.e. inside the window AND not filtered
  // out). An upstream that has been filtered or is outside the window
  // simply doesn't render an arrow — we don't draw "arrows to nowhere".
  //
  // Arrows are colored by `dependencyHealth(dep, upstream)`:
  //   clear   → emerald
  //   at-risk → amber
  //   blocked → red
  //
  // Geometry: the SVG sits over the track column only, starting just
  // below the calendar header. x is expressed in `% of track width`
  // (viewBox 0..100, preserveAspectRatio="none" so x stretches and y
  // stays in absolute pixels); y is the row's vertical midline in pixels.
  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.project.project_id, i));
    return m;
  }, [rows]);

  const arrows = useMemo(() => {
    type Arrow = {
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      health: DependencyHealth;
      label: string;
    };
    const out: Arrow[] = [];
    for (const r of rows) {
      const downstream = r.project;
      if (downstream.dependencies.length === 0) continue;
      const dBar = r.bar;
      if (!dBar) continue;
      const dIdx = rowIndexById.get(downstream.project_id);
      if (dIdx === undefined) continue;
      for (const dep of downstream.dependencies) {
        const uIdx = rowIndexById.get(dep.upstream_id);
        if (uIdx === undefined) continue;
        const upstreamRow = rows[uIdx];
        const uBar = upstreamRow.bar;
        if (!uBar) continue;
        const upstream = upstreamRow.project;
        const health = dependencyHealth(dep, upstream);
        out.push({
          id: `${dep.upstream_id}->${downstream.project_id}`,
          x1: uBar.rightFrac * 100,
          y1: uIdx * ROW_HEIGHT + ROW_HEIGHT / 2,
          x2: dBar.leftFrac * 100,
          y2: dIdx * ROW_HEIGHT + ROW_HEIGHT / 2,
          color: ARROW_COLOR[health],
          health,
          label: `${dep.upstream_id} → ${downstream.project_id} (${health})`,
        });
      }
    }
    return out;
  }, [rows, rowIndexById]);

  return (
    <div className="space-y-3">
      <Toolbar
        granularity={granularity}
        onGranularityChange={setGranularity}
        colorBy={colorBy}
        onColorByChange={setColorBy}
        windowSpec={windowSpec}
        onWindowChange={setWindowSpec}
      />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-sm text-gray-500">
            No projects fall within the selected window. Try expanding the
            range or clearing filters.
          </p>
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm"
          // The chart's intrinsic width is fixed by the SIDEBAR + at least
          // 700px of timeline so columns stay legible on narrow viewports.
          style={{ minWidth: SIDEBAR_WIDTH + 700 }}
        >
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${SIDEBAR_WIDTH}px 1fr`,
            }}
          >
            {/* Header row */}
            <div
              className="border-b border-gray-200 bg-gray-50 px-3 text-xs font-medium uppercase tracking-wider text-gray-600 flex items-center"
              style={{ height: HEADER_HEIGHT }}
            >
              Project
            </div>
            <TimelineHeader
              ticks={ticks}
              window={window}
              todayFrac={todayFrac}
            />

            {/* Project rows */}
            {rows.map(({ project, bar }) => {
              if (!bar) return null;
              return (
                <TimelineRow
                  key={project.project_id}
                  project={project}
                  bar={bar}
                  colorBy={colorBy}
                  window={window}
                  todayFrac={todayFrac}
                  canEdit={canEdit}
                  onOpenQuickView={onOpenQuickView}
                  onRequestTargetDateChange={requestTargetDateChange}
                />
              );
            })}

            {/* Dependency-arrow overlay (Section 5.10). Sits on top of the
                track column only (left = SIDEBAR_WIDTH), starts below the
                calendar header, and is `pointer-events: none` so the bars
                remain clickable. Rendered last so it visually layers above
                the project rows. */}
            {arrows.length > 0 ? (
              <svg
                aria-hidden="true"
                preserveAspectRatio="none"
                viewBox={`0 0 100 ${rows.length * ROW_HEIGHT}`}
                className="pointer-events-none absolute"
                style={{
                  left: SIDEBAR_WIDTH,
                  top: HEADER_HEIGHT,
                  right: 0,
                  height: rows.length * ROW_HEIGHT,
                }}
              >
                <defs>
                  {(["clear", "at-risk", "blocked"] as DependencyHealth[]).map(
                    (h) => (
                      <marker
                        key={h}
                        id={`dep-arrow-${h}`}
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M0,0 L10,5 L0,10 z" fill={ARROW_COLOR[h]} />
                      </marker>
                    ),
                  )}
                </defs>
                {arrows.map((a) => (
                  <line
                    key={a.id}
                    x1={a.x1}
                    y1={a.y1}
                    x2={a.x2}
                    y2={a.y2}
                    stroke={a.color}
                    // strokeWidth in viewBox units; set vectorEffect so the
                    // line stays visually constant under preserveAspectRatio
                    // none stretching.
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={a.health === "at-risk" ? "4 3" : undefined}
                    markerEnd={`url(#dep-arrow-${a.health})`}
                    opacity={0.85}
                  >
                    <title>{a.label}</title>
                  </line>
                ))}
              </svg>
            ) : null}
          </div>
        </div>
      )}
      <Legend colorBy={colorBy} hasArrows={arrows.length > 0} />
      {pendingDateChange ? (
        <TargetDateConfirmModal
          projectId={pendingDateChange.projectId}
          projectName={pendingDateChange.projectName}
          fromLabel={pendingDateChange.fromLabel}
          toIso={pendingDateChange.toIso}
          saving={pendingDateChange.saving}
          error={pendingDateChange.error}
          onCancel={cancelDateChange}
          onConfirm={confirmDateChange}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target-date drag confirmation modal (ROAD-04)
// ---------------------------------------------------------------------------

interface TargetDateConfirmModalProps {
  projectId: string;
  projectName: string;
  fromLabel: string;
  toIso: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * In-app confirmation modal shown after a drag-to-resize gesture on a
 * project's Timeline bar (ROAD-04). Replaces the previous native
 * `confirm()` and `alert()` calls so the dialog matches the application
 * UI. Inline error region surfaces network failures without falling
 * back to a browser `alert`.
 */
function TargetDateConfirmModal({
  projectId,
  projectName,
  fromLabel,
  toIso,
  saving,
  error,
  onCancel,
  onConfirm,
}: TargetDateConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="target-date-confirm-title"
      onClick={(e) => {
        // Allow click-outside to cancel, but ignore clicks inside the
        // dialog itself. Match the export-modal behavior so users get a
        // consistent dismissal pattern across the app.
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2
            id="target-date-confirm-title"
            className="text-base font-semibold tracking-tight text-gray-900"
          >
            Update target date?
          </h2>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-gray-700">
          <p>
            Move the target date for{" "}
            <span className="font-mono text-xs text-gray-500">{projectId}</span>{" "}
            <span className="font-medium text-gray-900">— {projectName}</span>?
          </p>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs">
            <div>
              <span className="text-gray-500">from</span>{" "}
              <span className="text-gray-900">{fromLabel}</span>
            </div>
            <div>
              <span className="text-gray-500">to</span>{" "}
              <span className="text-gray-900">{toIso}</span>
            </div>
          </div>
          {error ? (
            <div role="alert" className="pol-notice pol-notice-err">
              <span aria-hidden="true">!</span>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="pol-btn pol-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="pol-btn pol-btn-primary"
          >
            {saving ? "Saving…" : "Update"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolbarProps {
  granularity: DateGranularity;
  onGranularityChange: (g: DateGranularity) => void;
  colorBy: ColorBy;
  onColorByChange: (c: ColorBy) => void;
  windowSpec: { before: number; after: number };
  onWindowChange: (w: { before: number; after: number }) => void;
}

function Toolbar({
  granularity,
  onGranularityChange,
  colorBy,
  onColorByChange,
  windowSpec,
  onWindowChange,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
        View:
      </span>
      <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
        {(["weeks", "months", "quarters"] as DateGranularity[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGranularityChange(g)}
            className={`rounded px-3 py-0.5 text-xs capitalize ${
              granularity === g
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
        Color:
      </span>
      <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
        {(["priority", "status"] as ColorBy[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColorByChange(c)}
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

      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
        Range:
      </span>
      <div className="inline-flex items-center gap-1 text-xs text-gray-700">
        <button
          type="button"
          onClick={() =>
            onWindowChange({
              before: Math.max(0, windowSpec.before - 1),
              after: windowSpec.after,
            })
          }
          className="rounded border border-gray-200 bg-white px-2 py-0.5 hover:bg-gray-50"
        >
          ◀ Less past
        </button>
        <span>
          −{windowSpec.before} / +{windowSpec.after}
        </span>
        <button
          type="button"
          onClick={() =>
            onWindowChange({
              before: windowSpec.before + 1,
              after: windowSpec.after,
            })
          }
          className="rounded border border-gray-200 bg-white px-2 py-0.5 hover:bg-gray-50"
        >
          More past ▶
        </button>
        <button
          type="button"
          onClick={() =>
            onWindowChange({
              before: windowSpec.before,
              after: Math.max(0, windowSpec.after - 1),
            })
          }
          className="rounded border border-gray-200 bg-white px-2 py-0.5 hover:bg-gray-50"
        >
          ◀ Less future
        </button>
        <button
          type="button"
          onClick={() =>
            onWindowChange({
              before: windowSpec.before,
              after: windowSpec.after + 1,
            })
          }
          className="rounded border border-gray-200 bg-white px-2 py-0.5 hover:bg-gray-50"
        >
          More future ▶
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header strip (calendar)
// ---------------------------------------------------------------------------

interface TimelineHeaderProps {
  ticks: { date: Date; label: string }[];
  window: TimeWindow;
  todayFrac: number | null;
}

function TimelineHeader({ ticks, window, todayFrac }: TimelineHeaderProps) {
  const totalMs = window.end.getTime() - window.start.getTime();
  return (
    <div
      className="relative border-b border-gray-200 bg-gray-50"
      style={{ height: HEADER_HEIGHT }}
    >
      {ticks.map((t, i) => {
        const left = ((t.date.getTime() - window.start.getTime()) / totalMs) * 100;
        return (
          <div
            key={i}
            className="absolute top-0 h-full border-l border-gray-200 px-1.5 text-[11px] font-medium text-gray-600 flex items-center"
            style={{ left: `${left}%` }}
          >
            {t.label}
          </div>
        );
      })}
      {todayFrac !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-blue-500"
          style={{ left: `${todayFrac * 100}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project row
// ---------------------------------------------------------------------------

interface TimelineRowProps {
  project: Project;
  bar: NonNullable<ReturnType<typeof projectProjectBar>>;
  colorBy: ColorBy;
  window: TimeWindow;
  todayFrac: number | null;
  canEdit: boolean;
  onOpenQuickView: (id: string) => void;
  /**
   * Signals that the user has finished a drag-to-resize gesture and
   * wants to change the project's target date. The parent shows the
   * in-app confirmation modal (ROAD-04) and dispatches the actual
   * update only after the user confirms — the row itself never reaches
   * the network or the JSON store.
   */
  onRequestTargetDateChange: (
    projectId: string,
    projectName: string,
    fromIso: string | null,
    toIso: string,
  ) => void;
}

function TimelineRow({
  project,
  bar,
  colorBy,
  window,
  todayFrac,
  canEdit,
  onOpenQuickView,
  onRequestTargetDateChange,
}: TimelineRowProps) {
  const colorClass =
    colorBy === "priority"
      ? priorityBadgeClass(project.priority)
      : statusBadgeClass(project.status);

  const widthPct = Math.max(
    MIN_BAR_WIDTH_PCT,
    (bar.rightFrac - bar.leftFrac) * 100,
  );
  const leftPct = bar.leftFrac * 100;

  // ---- Drag-to-resize end of bar (changes target_date) ----
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragRightFrac, setDragRightFrac] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  function onResizeStart(e: React.PointerEvent) {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    const track = trackRef.current;
    if (!track) return;
    track.setPointerCapture(e.pointerId);
    setDragRightFrac(bar.rightFrac);
  }

  function onResizeMove(e: React.PointerEvent) {
    if (!dragging) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setDragRightFrac(Math.max(bar.leftFrac + 0.005, Math.min(1, frac)));
  }

  function onResizeEnd() {
    if (!dragging) return;
    setDragging(false);
    const finalFrac = dragRightFrac;
    setDragRightFrac(null);
    if (finalFrac === null) return;
    const newDate = fractionToDate(finalFrac, window);
    const iso = formatIsoDate(newDate);
    const previous = project.target_date;
    if (iso === previous) return;
    // Hand off to the parent — it shows the in-app confirmation modal
    // (ROAD-04) and dispatches the network update only after the user
    // confirms, so neither `confirm()` nor `alert()` runs here.
    onRequestTargetDateChange(
      project.project_id,
      project.name,
      previous ?? null,
      iso,
    );
  }

  const previewWidthPct =
    dragRightFrac !== null
      ? Math.max(
          MIN_BAR_WIDTH_PCT,
          (dragRightFrac - bar.leftFrac) * 100,
        )
      : null;

  return (
    <>
      {/* Sidebar cell */}
      <button
        type="button"
        onClick={() => onOpenQuickView(project.project_id)}
        className="flex h-full items-center gap-2 border-b border-gray-100 px-3 text-left text-sm text-gray-900 transition hover:bg-gray-50"
        style={{ height: ROW_HEIGHT }}
      >
        <span className="font-mono text-[10px] text-gray-500">
          {project.project_id}
        </span>
        <span className="truncate">{project.name}</span>
      </button>

      {/* Track cell with bar */}
      <div
        ref={trackRef}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="relative border-b border-gray-100"
        style={{ height: ROW_HEIGHT }}
      >
        {todayFrac !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-blue-500/30 pointer-events-none"
            style={{ left: `${todayFrac * 100}%` }}
            aria-hidden
          />
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenQuickView(project.project_id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenQuickView(project.project_id);
            }
          }}
          title={`${project.project_id} · ${project.name}\n${formatIsoDate(bar.start)} → ${
            bar.openEnded ? "(no target date)" : formatIsoDate(bar.end)
          }`}
          className={`absolute top-1/2 flex h-5 -translate-y-1/2 cursor-pointer items-center rounded px-1.5 text-[10px] font-medium ring-1 ring-inset ${colorClass} ${
            bar.openEnded ? "ring-dashed" : ""
          }`}
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            opacity: dragging ? 0.4 : 1,
          }}
        >
          <span className="truncate">{project.name}</span>
          {canEdit && (
            <span
              role="separator"
              onPointerDown={onResizeStart}
              title="Drag to adjust target date"
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/0 hover:bg-black/10"
              aria-label="Resize end of bar"
            />
          )}
        </div>
        {previewWidthPct !== null && (
          <>
            <div
              className="absolute top-1/2 h-5 -translate-y-1/2 rounded border-2 border-dashed border-gray-700 bg-gray-200/40"
              style={{ left: `${leftPct}%`, width: `${previewWidthPct}%` }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute top-1 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white"
              style={{
                left: `${(dragRightFrac ?? 0) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              {formatIsoDate(fractionToDate(dragRightFrac ?? 0, window))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend({
  colorBy,
  hasArrows,
}: {
  colorBy: ColorBy;
  hasArrows: boolean;
}) {
  // Branch on `colorBy` and stay inside one branch — TS can't narrow the
  // union when items and map are computed independently, so we duplicate
  // the JSX rather than fight the type system.
  if (colorBy === "priority") {
    const keys = Object.keys(PRIORITY_BADGE) as Array<
      keyof typeof PRIORITY_BADGE
    >;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
        <span className="font-medium uppercase tracking-wider">Legend:</span>
        {keys.map((k) => (
          <span
            key={k}
            className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${PRIORITY_BADGE[k]}`}
          >
            {k}
          </span>
        ))}
        {hasArrows ? <ArrowLegend /> : null}
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="h-3 w-0.5 bg-blue-500" />
          <span>Today</span>
        </span>
      </div>
    );
  }
  const keys = Object.keys(STATUS_BADGE) as Array<keyof typeof STATUS_BADGE>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
      <span className="font-medium uppercase tracking-wider">Legend:</span>
      {keys.map((k) => (
        <span
          key={k}
          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${STATUS_BADGE[k]}`}
        >
          {k}
        </span>
      ))}
      {hasArrows ? <ArrowLegend /> : null}
      <span className="ml-auto inline-flex items-center gap-1">
        <span className="h-3 w-0.5 bg-blue-500" />
        <span>Today</span>
      </span>
    </div>
  );
}

/**
 * Small inline legend strip explaining the dependency arrow colors. Shown
 * only when at least one arrow is rendered, so the chart stays uncluttered
 * for project sets that don't use dependencies.
 */
function ArrowLegend() {
  const items: { health: DependencyHealth; label: string; dashed?: boolean }[] =
    [
      { health: "clear", label: "Dep: clear" },
      { health: "at-risk", label: "Dep: at-risk", dashed: true },
      { health: "blocked", label: "Dep: blocked" },
    ];
  return (
    <span className="inline-flex items-center gap-2 border-l border-gray-200 pl-2">
      {items.map((it) => (
        <span key={it.health} className="inline-flex items-center gap-1">
          <svg width="14" height="6" aria-hidden>
            <line
              x1={0}
              y1={3}
              x2={14}
              y2={3}
              stroke={ARROW_COLOR[it.health]}
              strokeWidth={1.5}
              strokeDasharray={it.dashed ? "3 2" : undefined}
            />
          </svg>
          <span>{it.label}</span>
        </span>
      ))}
    </span>
  );
}
