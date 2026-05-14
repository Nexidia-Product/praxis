"use client";

/**
 * Portfolio Bubble Chart roadmap view (Section 5.6).
 *
 * 2x2 scatter plot used in portfolio reviews. Default axes are AI
 * Complexity (X) by Priority (Y) with bubble size proportional to
 * estimated duration (or stakeholder count when no estimate exists).
 * Both axes and the bubble color metric are configurable.
 *
 * Built as a single SVG: the math is small, the points are few (under
 * 100 in any realistic team), and a custom SVG keeps us inside the
 * "zero UI dependencies" guardrail used elsewhere in the app.
 *
 * Bubble write-back: dragging a bubble updates the project field
 * underlying the X or Y axis. Only enum-valued fields support write-back
 * — derived values like "days to target" can't be cleanly inverted, so
 * dragging snaps the bubble back rather than persisting.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { BUBBLE_AXES, findBubbleAxis } from "@/lib/roadmap/fields";
import type { PortfolioQuadrantLabels, Project } from "@/lib/db";

interface BubbleViewProps {
  projects: Project[];
  onUpdateField: (
    projectId: string,
    field: string,
    value: string,
  ) => Promise<void>;
  onOpenQuickView: (projectId: string) => void;
  canEdit: boolean;
  /**
   * Canonical strategic-position labels from settings. Used as the
   * default quadrant labels when the chart is configured with the
   * default axes (AI Complexity × Priority) — that's the
   * configuration where the corners line up with Quick Win / Major
   * Bet / Fill-In / Deprioritize. For non-default axis combinations
   * the chart still lets users edit the labels locally; those edits
   * don't write back to settings.
   */
  quadrantLabels: PortfolioQuadrantLabels;
}

type ColorByOption = "project_type" | "application_product" | "priority";

interface QuadrantLabels {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
}

/**
 * The chart's default-axis configuration: AI Complexity (X) × Priority
 * (Y). When both keys match these, the quadrant labels are derived from
 * the canonical strategic-position labels in settings; that wiring also
 * fixes the persistence bug where local quadrant edits used to vanish
 * on refresh.
 */
const CANONICAL_X_KEY = "ai_complexity_score";
const CANONICAL_Y_KEY = "priority";

/**
 * Map a `PortfolioQuadrantLabels` (semantic keys) to the bubble
 * chart's `QuadrantLabels` (visual corners). Only valid for the
 * canonical axes — caller checks `xKey`/`yKey` before using.
 */
function quadrantsFromSettings(
  labels: PortfolioQuadrantLabels,
): QuadrantLabels {
  return {
    // Low complexity (left) × High priority (top) = Quick Win
    topLeft: labels.quick_win,
    // High complexity (right) × High priority (top) = Major Bet
    topRight: labels.major_bet,
    // Low complexity (left) × Low priority (bottom) = Fill-In
    bottomLeft: labels.fill_in,
    // High complexity (right) × Low priority (bottom) = Deprioritize
    bottomRight: labels.deprioritize,
  };
}

const PADDING = { top: 30, right: 30, bottom: 60, left: 70 };
const VIEW_W = 800;
const VIEW_H = 520;
const PLOT_W = VIEW_W - PADDING.left - PADDING.right;
const PLOT_H = VIEW_H - PADDING.top - PADDING.bottom;

const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
];

const FIELDS_WRITABLE_BY_DRAG = new Set([
  "ai_complexity_score",
  "priority",
  "project_type",
]);

/**
 * Pixel offset for a bubble at a given stack index. Index 0 sits at
 * the center; subsequent bubbles fan out in concentric hex rings.
 * Ring 1 (indexes 1..6) at radius 9, ring 2 (7..18) at radius 18,
 * ring 3 (19..36) at radius 27, etc. Numbers are picked so adjacent
 * bubbles in a ring just clear each other for the default radius
 * (≈8-12px), making each individually hoverable without the cluster
 * overflowing the tick spacing.
 */
function stackOffset(index: number): { dx: number; dy: number } {
  if (index === 0) return { dx: 0, dy: 0 };
  // Find which ring `index` falls into. Ring k holds 6k bubbles, so
  // total bubbles up through ring k is 1 + 6 * (1 + 2 + ... + k)
  // = 1 + 3k(k+1). Solve for the smallest k where 1 + 3k(k+1) > index.
  let ring = 1;
  let consumed = 1; // index 0 is the center
  while (consumed + 6 * ring <= index) {
    consumed += 6 * ring;
    ring += 1;
  }
  const positionInRing = index - consumed; // 0..(6*ring - 1)
  const angle = (positionInRing / (6 * ring)) * 2 * Math.PI;
  const radius = 9 * ring;
  return {
    dx: Math.cos(angle) * radius,
    dy: Math.sin(angle) * radius,
  };
}

export function BubbleView({
  projects,
  onUpdateField,
  onOpenQuickView,
  canEdit,
  quadrantLabels,
}: BubbleViewProps) {
  const [xKey, setXKey] = useState(CANONICAL_X_KEY);
  const [yKey, setYKey] = useState(CANONICAL_Y_KEY);
  const [colorBy, setColorBy] = useState<ColorByOption>("project_type");
  // For canonical axes (Complexity × Priority), labels come from
  // settings. For other axis combinations, labels stay local and the
  // user can edit them — those edits don't write back to settings (a
  // user shouldn't be able to rename "Quick Win" globally just because
  // they put a custom axis on the chart).
  const [quadrants, setQuadrants] = useState<QuadrantLabels>(() =>
    quadrantsFromSettings(quadrantLabels),
  );
  // Re-sync local labels when settings change OR when the user
  // returns to the canonical axis pair. The dependency on `xKey` /
  // `yKey` keeps the chart in sync if a user edits labels locally
  // for a non-canonical axis, then switches back to the canonical
  // pair — they should see the canonical settings labels again.
  const onCanonicalAxes =
    xKey === CANONICAL_X_KEY && yKey === CANONICAL_Y_KEY;
  useEffect(() => {
    if (onCanonicalAxes) {
      setQuadrants(quadrantsFromSettings(quadrantLabels));
    }
  }, [onCanonicalAxes, quadrantLabels]);
  const [editingQuadrants, setEditingQuadrants] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement | null>(null);

  const xAxis = findBubbleAxis(xKey);
  const yAxis = findBubbleAxis(yKey);

  // ---- Map projects to plot coordinates. ----
  // Projects whose (x, y) coordinates collide get a stackIndex that the
  // renderer uses to fan them out in a small radial spiral (ROAD-13).
  // Without this, three projects at "Unset complexity / High priority"
  // stack on the same pixel and the user only sees one bubble. Ten
  // projects can look like four. The offset is tiny (2-6px) so the
  // visual still reads as "these are at the same tick" — it just makes
  // every project hoverable and clickable.
  const points = useMemo(() => {
    if (!xAxis || !yAxis) return [];
    const raw = projects
      .map((p) => {
        const xv = xAxis.getValue(p);
        const yv = yAxis.getValue(p);
        if (xv === null || yv === null) return null;
        return { project: p, xv, yv };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    // Bucket by exact (x, y) pair. Object key uses a string compound
    // because Map keys can't be tuples and reference equality won't
    // collapse equal-valued objects.
    const buckets = new Map<string, number>();
    return raw.map((pt) => {
      const key = `${pt.xv}|${pt.yv}`;
      const stackIndex = buckets.get(key) ?? 0;
      buckets.set(key, stackIndex + 1);
      return { ...pt, stackIndex };
    });
  }, [projects, xAxis, yAxis]);

  // ---- Color scale. ----
  const colorMap = useMemo(() => {
    const set = new Set<string>();
    for (const { project } of points) {
      const value =
        colorBy === "project_type"
          ? project.project_type
          : colorBy === "priority"
            ? project.priority
            : project.application_product;
      if (value) set.add(value);
    }
    const map = new Map<string, string>();
    Array.from(set)
      .sort()
      .forEach((v, i) => {
        map.set(v, PALETTE[i % PALETTE.length]);
      });
    return map;
  }, [points, colorBy]);

  // ---- Bubble size: based on resource count (proxy for project size). ----
  const radiusFor = (p: Project) => {
    const n = (p.project_lead ? 1 : 0) + p.additional_resources.length;
    return 8 + Math.min(n * 2, 16);
  };

  // ---- Axis scale builders. ----
  function scaleX(value: number): number {
    if (!xAxis) return 0;
    const min = xAxis.ticks[0].value;
    const max = xAxis.ticks[xAxis.ticks.length - 1].value;
    const span = max - min || 1;
    const frac = (value - min) / span;
    return PADDING.left + frac * PLOT_W;
  }

  function scaleY(value: number): number {
    if (!yAxis) return 0;
    const min = yAxis.ticks[0].value;
    const max = yAxis.ticks[yAxis.ticks.length - 1].value;
    const span = max - min || 1;
    const frac = (value - min) / span;
    // Y is inverted in SVG.
    return PADDING.top + (1 - frac) * PLOT_H;
  }

  function unscaleX(px: number): number {
    if (!xAxis) return 0;
    const min = xAxis.ticks[0].value;
    const max = xAxis.ticks[xAxis.ticks.length - 1].value;
    const frac = (px - PADDING.left) / PLOT_W;
    return min + frac * (max - min);
  }

  function unscaleY(py: number): number {
    if (!yAxis) return 0;
    const min = yAxis.ticks[0].value;
    const max = yAxis.ticks[yAxis.ticks.length - 1].value;
    const frac = (PADDING.top + PLOT_H - py) / PLOT_H;
    return min + frac * (max - min);
  }

  // ---- Drag handling for write-back. ----
  function clientToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const xRatio = VIEW_W / rect.width;
    const yRatio = VIEW_H / rect.height;
    return {
      x: (clientX - rect.left) * xRatio,
      y: (clientY - rect.top) * yRatio,
    };
  }

  function nearestTick(
    axis: NonNullable<ReturnType<typeof findBubbleAxis>>,
    raw: number,
  ): { value: number; label: string } {
    // Exclude the "—" sentinel tick (ROAD-13) from drag targets — that
    // bucket exists so unscored projects show up on the chart, not as
    // a place users can drag a project *to*. Without this filter,
    // dragging would write "—" as the field value and the server-side
    // enum validator would reject it.
    const candidates = axis.ticks.filter((t) => t.label !== "—");
    const search = candidates.length > 0 ? candidates : axis.ticks;
    let best = search[0];
    let bestDelta = Math.abs(raw - best.value);
    for (const t of search) {
      const d = Math.abs(raw - t.value);
      if (d < bestDelta) {
        best = t;
        bestDelta = d;
      }
    }
    return best;
  }

  function onPointerDown(
    e: React.PointerEvent<SVGCircleElement>,
    projectId: string,
  ) {
    if (!canEdit) return;
    e.stopPropagation();
    setDragId(projectId);
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    setDragPos({ x, y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId) return;
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    setDragPos({
      x: Math.max(PADDING.left, Math.min(PADDING.left + PLOT_W, x)),
      y: Math.max(PADDING.top, Math.min(PADDING.top + PLOT_H, y)),
    });
  }

  function onPointerUp() {
    if (!dragId || !dragPos || !xAxis || !yAxis) {
      setDragId(null);
      setDragPos(null);
      return;
    }
    const project = projects.find((p) => p.project_id === dragId);
    if (!project) {
      setDragId(null);
      setDragPos(null);
      return;
    }
    const xWritable = FIELDS_WRITABLE_BY_DRAG.has(xAxis.key);
    const yWritable = FIELDS_WRITABLE_BY_DRAG.has(yAxis.key);
    const updates: Promise<unknown>[] = [];

    if (xWritable) {
      const tick = nearestTick(xAxis, unscaleX(dragPos.x));
      const currentX = xAxis.getValue(project);
      if (currentX !== tick.value) {
        const ok = globalThis.confirm(
          `Update ${xAxis.label} for ${project.project_id} to "${tick.label}"?`,
        );
        if (ok) {
          updates.push(onUpdateField(project.project_id, xAxis.key, tick.label));
        }
      }
    }
    if (yWritable) {
      const tick = nearestTick(yAxis, unscaleY(dragPos.y));
      const currentY = yAxis.getValue(project);
      if (currentY !== tick.value) {
        const ok = globalThis.confirm(
          `Update ${yAxis.label} for ${project.project_id} to "${tick.label}"?`,
        );
        if (ok) {
          updates.push(onUpdateField(project.project_id, yAxis.key, tick.label));
        }
      }
    }

    setDragId(null);
    setDragPos(null);
    Promise.all(updates).catch((err) => {
      console.error(err);
      globalThis.alert("Failed to update project field.");
    });
  }

  // ---- Quadrant boundaries (mid-axis) ----
  const midX = xAxis ? scaleX((xAxis.ticks[0].value + xAxis.ticks[xAxis.ticks.length - 1].value) / 2) : 0;
  const midY = yAxis ? scaleY((yAxis.ticks[0].value + yAxis.ticks[yAxis.ticks.length - 1].value) / 2) : 0;

  const xWritable = xAxis ? FIELDS_WRITABLE_BY_DRAG.has(xAxis.key) : false;
  const yWritable = yAxis ? FIELDS_WRITABLE_BY_DRAG.has(yAxis.key) : false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          X axis:
        </span>
        <select
          value={xKey}
          onChange={(e) => setXKey(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          {BUBBLE_AXES.map((a) => (
            <option key={a.key} value={a.key} disabled={a.key === yKey}>
              {a.label}
            </option>
          ))}
        </select>

        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Y axis:
        </span>
        <select
          value={yKey}
          onChange={(e) => setYKey(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          {BUBBLE_AXES.map((a) => (
            <option key={a.key} value={a.key} disabled={a.key === xKey}>
              {a.label}
            </option>
          ))}
        </select>

        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Color:
        </span>
        <select
          value={colorBy}
          onChange={(e) => setColorBy(e.target.value as ColorByOption)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          <option value="project_type">Project Type</option>
          <option value="application_product">App / Product</option>
          <option value="priority">Priority</option>
        </select>

        {/* Edit quadrant labels (BubbleView). When on the canonical
            Complexity × Priority axes, labels come from settings and
            local edits would be silently overwritten on the next sync
            — so we hide the button and route the user to the admin
            page where edits actually persist. For non-canonical axes,
            local edits make sense (the chart is in "scratch" mode)
            and the button stays. */}
        {onCanonicalAxes ? (
          <a
            href="/admin/configuration?tab=portfolio-quadrants"
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            title="Quadrant labels here come from Admin → Configuration → Portfolio quadrants"
          >
            Edit quadrant labels →
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setEditingQuadrants((v) => !v)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {editingQuadrants ? "Done" : "Edit quadrant labels"}
          </button>
        )}

        {canEdit && (
          <span className="ml-auto text-xs text-gray-500">
            {xWritable || yWritable
              ? `Drag to update ${[
                  xWritable && xAxis?.label,
                  yWritable && yAxis?.label,
                ]
                  .filter(Boolean)
                  .join(" / ")}`
              : "Selected axes are read-only."}
          </span>
        )}
      </div>

      {editingQuadrants && (
        <QuadrantEditor labels={quadrants} onChange={setQuadrants} />
      )}

      {points.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500">
          No projects have values on both selected axes.{" "}
          {!xAxis?.getValue && !yAxis?.getValue
            ? null
            : "AI Complexity values are populated by Step 10's AI integration; until then, projects without that field won't appear when it's an axis."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full max-w-full"
            style={{ minWidth: 600 }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {/* Quadrant backgrounds */}
            <rect
              x={PADDING.left}
              y={PADDING.top}
              width={midX - PADDING.left}
              height={midY - PADDING.top}
              fill="#f9fafb"
            />
            <rect
              x={midX}
              y={PADDING.top}
              width={PADDING.left + PLOT_W - midX}
              height={midY - PADDING.top}
              fill="#f3f4f6"
            />
            <rect
              x={PADDING.left}
              y={midY}
              width={midX - PADDING.left}
              height={PADDING.top + PLOT_H - midY}
              fill="#f3f4f6"
            />
            <rect
              x={midX}
              y={midY}
              width={PADDING.left + PLOT_W - midX}
              height={PADDING.top + PLOT_H - midY}
              fill="#f9fafb"
            />

            {/* Quadrant labels */}
            <text
              x={(PADDING.left + midX) / 2}
              y={(PADDING.top + midY) / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-gray-400 text-sm font-semibold uppercase tracking-wider"
              style={{ pointerEvents: "none" }}
            >
              {quadrants.topLeft}
            </text>
            <text
              x={(midX + PADDING.left + PLOT_W) / 2}
              y={(PADDING.top + midY) / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-gray-400 text-sm font-semibold uppercase tracking-wider"
              style={{ pointerEvents: "none" }}
            >
              {quadrants.topRight}
            </text>
            <text
              x={(PADDING.left + midX) / 2}
              y={(midY + PADDING.top + PLOT_H) / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-gray-400 text-sm font-semibold uppercase tracking-wider"
              style={{ pointerEvents: "none" }}
            >
              {quadrants.bottomLeft}
            </text>
            <text
              x={(midX + PADDING.left + PLOT_W) / 2}
              y={(midY + PADDING.top + PLOT_H) / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-gray-400 text-sm font-semibold uppercase tracking-wider"
              style={{ pointerEvents: "none" }}
            >
              {quadrants.bottomRight}
            </text>

            {/* Plot border + mid-axis lines */}
            <rect
              x={PADDING.left}
              y={PADDING.top}
              width={PLOT_W}
              height={PLOT_H}
              fill="none"
              stroke="#9ca3af"
              strokeWidth={1}
            />
            <line
              x1={midX}
              x2={midX}
              y1={PADDING.top}
              y2={PADDING.top + PLOT_H}
              stroke="#9ca3af"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <line
              x1={PADDING.left}
              x2={PADDING.left + PLOT_W}
              y1={midY}
              y2={midY}
              stroke="#9ca3af"
              strokeDasharray="4 3"
              strokeWidth={1}
            />

            {/* X-axis ticks */}
            {xAxis?.ticks.map((t) => (
              <g key={`xt-${t.value}`}>
                <line
                  x1={scaleX(t.value)}
                  x2={scaleX(t.value)}
                  y1={PADDING.top + PLOT_H}
                  y2={PADDING.top + PLOT_H + 5}
                  stroke="#9ca3af"
                  strokeWidth={1}
                />
                <text
                  x={scaleX(t.value)}
                  y={PADDING.top + PLOT_H + 18}
                  textAnchor="middle"
                  className="fill-gray-700 text-[11px]"
                >
                  {t.label}
                </text>
              </g>
            ))}
            {xAxis && (
              <text
                x={PADDING.left + PLOT_W / 2}
                y={PADDING.top + PLOT_H + 42}
                textAnchor="middle"
                className="fill-gray-900 text-xs font-semibold uppercase tracking-wider"
              >
                {xAxis.label}
              </text>
            )}

            {/* Y-axis ticks */}
            {yAxis?.ticks.map((t) => (
              <g key={`yt-${t.value}`}>
                <line
                  x1={PADDING.left - 5}
                  x2={PADDING.left}
                  y1={scaleY(t.value)}
                  y2={scaleY(t.value)}
                  stroke="#9ca3af"
                  strokeWidth={1}
                />
                <text
                  x={PADDING.left - 8}
                  y={scaleY(t.value)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-gray-700 text-[11px]"
                >
                  {t.label}
                </text>
              </g>
            ))}
            {yAxis && (
              <text
                x={18}
                y={PADDING.top + PLOT_H / 2}
                textAnchor="middle"
                className="fill-gray-900 text-xs font-semibold uppercase tracking-wider"
                transform={`rotate(-90 18 ${PADDING.top + PLOT_H / 2})`}
              >
                {yAxis.label}
              </text>
            )}

            {/* Bubbles */}
            {points.map(({ project, xv, yv, stackIndex }) => {
              const isDrag = dragId === project.project_id;
              const baseX = isDrag && dragPos ? dragPos.x : scaleX(xv);
              const baseY = isDrag && dragPos ? dragPos.y : scaleY(yv);
              // Radial fan-out for overlapping bubbles (ROAD-13). Index
              // 0 sits dead center; 1-6 form a small ring at radius 8,
              // 7-18 a wider ring at radius 16, etc. Holds the visual
              // signal that these projects share a tick while still
              // letting each be hovered, clicked, or dragged. Skipped
              // while dragging so the cursor stays under the bubble.
              const offset = isDrag ? { dx: 0, dy: 0 } : stackOffset(stackIndex);
              const cx = baseX + offset.dx;
              const cy = baseY + offset.dy;
              const r = radiusFor(project);
              const colorKey =
                colorBy === "project_type"
                  ? project.project_type
                  : colorBy === "priority"
                    ? project.priority
                    : project.application_product;
              const color = colorMap.get(colorKey ?? "") ?? PALETTE[0];
              const isHover = hoverId === project.project_id;
              return (
                <g key={project.project_id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={color}
                    fillOpacity={isHover || isDrag ? 0.9 : 0.65}
                    stroke={color}
                    strokeWidth={isHover || isDrag ? 2 : 1}
                    style={{
                      cursor: canEdit && (xWritable || yWritable) ? "grab" : "pointer",
                    }}
                    onPointerDown={(e) => onPointerDown(e, project.project_id)}
                    onMouseEnter={() => setHoverId(project.project_id)}
                    onMouseLeave={() =>
                      setHoverId((h) =>
                        h === project.project_id ? null : h,
                      )
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isDrag) {
                        onOpenQuickView(project.project_id);
                      }
                    }}
                  >
                    <title>
                      {project.project_id} · {project.name}
                    </title>
                  </circle>
                  {isHover && (
                    <g style={{ pointerEvents: "none" }}>
                      <rect
                        x={cx + r + 4}
                        y={cy - 18}
                        width={Math.max(120, project.name.length * 6.2 + 20)}
                        height={36}
                        rx={4}
                        fill="white"
                        stroke="#9ca3af"
                      />
                      <text
                        x={cx + r + 14}
                        y={cy - 4}
                        className="fill-gray-900 text-[11px] font-medium"
                      >
                        {project.project_id}
                      </text>
                      <text
                        x={cx + r + 14}
                        y={cy + 9}
                        className="fill-gray-700 text-[10px]"
                      >
                        {project.name.slice(0, 22)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Color legend */}
      {colorMap.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-700">
          <span className="font-medium uppercase tracking-wider text-gray-500">
            {colorBy === "project_type"
              ? "Type"
              : colorBy === "priority"
                ? "Priority"
                : "App / Product"}
            :
          </span>
          {Array.from(colorMap.entries()).map(([k, color]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quadrant labels editor
// ---------------------------------------------------------------------------

interface QuadrantEditorProps {
  labels: QuadrantLabels;
  onChange: (next: QuadrantLabels) => void;
}

function QuadrantEditor({ labels, onChange }: QuadrantEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
      <label className="space-y-1">
        <span className="font-medium text-gray-600">Top-left</span>
        <input
          type="text"
          value={labels.topLeft}
          onChange={(e) =>
            onChange({ ...labels, topLeft: e.target.value })
          }
          className="w-full rounded-md border border-gray-200 px-2 py-1"
        />
      </label>
      <label className="space-y-1">
        <span className="font-medium text-gray-600">Top-right</span>
        <input
          type="text"
          value={labels.topRight}
          onChange={(e) =>
            onChange({ ...labels, topRight: e.target.value })
          }
          className="w-full rounded-md border border-gray-200 px-2 py-1"
        />
      </label>
      <label className="space-y-1">
        <span className="font-medium text-gray-600">Bottom-left</span>
        <input
          type="text"
          value={labels.bottomLeft}
          onChange={(e) =>
            onChange({ ...labels, bottomLeft: e.target.value })
          }
          className="w-full rounded-md border border-gray-200 px-2 py-1"
        />
      </label>
      <label className="space-y-1">
        <span className="font-medium text-gray-600">Bottom-right</span>
        <input
          type="text"
          value={labels.bottomRight}
          onChange={(e) =>
            onChange({ ...labels, bottomRight: e.target.value })
          }
          className="w-full rounded-md border border-gray-200 px-2 py-1"
        />
      </label>
    </div>
  );
}
