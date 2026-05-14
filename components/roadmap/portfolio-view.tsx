"use client";

/**
 * Portfolio view (Section 5.6).
 *
 * Replaces the bubble chart as the default Portfolio surface. Projects
 * are grouped into five sections — Quick Win / Major Bet / Fill-In /
 * Deprioritize / Unscored — and shown as compact rows in each section.
 * The bubble chart is still reachable via a List/Chart toggle at the
 * top.
 *
 * Why grouped sections instead of a single sortable table:
 *   - The strategic frame is the point. A "Major Bet" with 8 projects
 *     visible together tells a story; the same 8 spread through a
 *     mixed list does not.
 *   - The Projects page already provides the single-table view with
 *     a Position column for cross-bucket comparison.
 *   - Empty buckets are themselves informative ("we have no Quick
 *     Wins this quarter") in a way a missing row in a flat table is
 *     not.
 *
 * Why no drag-and-drop: bucket assignment is derived from priority ×
 * complexity. Dragging a project between buckets would have to
 * silently rewrite those fields (confusing) or be a no-op. The "open
 * quick view to edit priority/complexity" action is clearer.
 *
 * Within each section, projects sort by Priority descending, then
 * Target Date ascending. Column headers are clickable to re-sort
 * just that section. Sort state and per-section collapse state live
 * in component state; collapse state additionally persists in
 * localStorage so a user's preferred set of open sections survives
 * navigation. Sort state intentionally resets — a per-section sort
 * is a glance-time tool, not a saved preference.
 */

import { useEffect, useMemo, useState } from "react";

import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  priorityBadgeClass,
} from "@/lib/projects/display";
import {
  PORTFOLIO_POSITION_BADGE,
  PORTFOLIO_POSITION_KEYS,
  computePortfolioPosition,
  type PortfolioPositionKey,
} from "@/lib/projects/portfolio-position";
import type {
  PortfolioQuadrantLabels,
  Priority,
  Project,
} from "@/lib/db";

import { BubbleView } from "@/components/roadmap/bubble-view";

interface PortfolioViewProps {
  projects: Project[];
  onUpdateField: (
    projectId: string,
    field: string,
    value: string,
  ) => Promise<void>;
  onOpenQuickView: (projectId: string) => void;
  canEdit: boolean;
  quadrantLabels: PortfolioQuadrantLabels;
}

type Mode = "list" | "chart";

const MODE_STORAGE_KEY = "iim:portfolio:mode";
const COLLAPSED_STORAGE_KEY = "iim:portfolio:collapsed";

const PRIORITY_ORDER: Record<Priority, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/**
 * Section order on the page. The four "real" buckets in canonical
 * order, then Unscored at the bottom — Unscored is informational
 * (these projects need an AI complexity score) rather than strategic,
 * so it earns the least real estate.
 */
const SECTION_ORDER: (PortfolioPositionKey | "unknown")[] = [
  ...PORTFOLIO_POSITION_KEYS,
  "unknown",
];

/**
 * Per-section descriptions surfaced as a one-line subtitle. Keeps the
 * strategic intent of each bucket visible without needing the user to
 * remember what "Major Bet" means.
 */
const SECTION_DESCRIPTIONS: Record<PortfolioPositionKey | "unknown", string> = {
  quick_win: "High priority, low/medium complexity — high-impact, low-effort.",
  major_bet: "High priority, high/very-high complexity — strategic investments.",
  fill_in: "Lower priority, lower complexity — worth doing when capacity opens.",
  deprioritize:
    "Lower priority, high/very-high complexity — strong candidates for cutting.",
  unknown:
    "These projects don't have an AI complexity score yet. Open a project and run the AI Advisor to bucket them.",
};

type SortColumn =
  | "project_id"
  | "name"
  | "priority"
  | "complexity"
  | "lead"
  | "target"
  | "health";
type SortDir = "asc" | "desc";

/** Default sort: by priority descending, then target date ascending. */
const DEFAULT_SORT: { column: SortColumn; dir: SortDir } = {
  column: "priority",
  dir: "desc",
};

const COMPLEXITY_ORDER: Record<string, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  "Very High": 4,
};

const HEALTH_ORDER: Record<string, number> = {
  Red: 0,
  Yellow: 1,
  Green: 2,
};

function compareProjects(
  a: Project,
  b: Project,
  column: SortColumn,
  dir: SortDir,
): number {
  let cmp = 0;
  switch (column) {
    case "project_id":
      cmp = a.project_id.localeCompare(b.project_id);
      break;
    case "name":
      cmp = a.name.localeCompare(b.name);
      break;
    case "priority":
      cmp = (PRIORITY_ORDER[a.priority] ?? 0) - (PRIORITY_ORDER[b.priority] ?? 0);
      break;
    case "complexity":
      cmp =
        (COMPLEXITY_ORDER[a.ai_complexity_score ?? ""] ?? 0) -
        (COMPLEXITY_ORDER[b.ai_complexity_score ?? ""] ?? 0);
      break;
    case "lead":
      cmp = (a.project_lead || "").localeCompare(b.project_lead || "");
      break;
    case "target": {
      // Null target dates sort last regardless of direction — they're
      // explicitly "no commitment", which is less informative than
      // any concrete date.
      const aDate = a.target_date ?? "";
      const bDate = b.target_date ?? "";
      if (!aDate && !bDate) cmp = 0;
      else if (!aDate) return 1;
      else if (!bDate) return -1;
      else cmp = aDate.localeCompare(bDate);
      break;
    }
    case "health":
      cmp =
        (HEALTH_ORDER[a.health_score ?? ""] ?? 99) -
        (HEALTH_ORDER[b.health_score ?? ""] ?? 99);
      break;
  }
  return dir === "asc" ? cmp : -cmp;
}

/** Default secondary sort applied after the user-chosen primary sort. */
function defaultTiebreaker(a: Project, b: Project): number {
  return compareProjects(a, b, "target", "asc");
}

export function PortfolioView({
  projects,
  onUpdateField,
  onOpenQuickView,
  canEdit,
  quadrantLabels,
}: PortfolioViewProps) {
  // List/Chart toggle. Initialized from localStorage so a heavy
  // bubble-chart user keeps their preference across sessions; falls
  // back to "list" on first visit and during SSR.
  const [mode, setMode] = useState<Mode>("list");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "list" || stored === "chart") setMode(stored);
    } catch {
      // localStorage may be unavailable (private mode, etc.) — fine.
    }
  }, []);
  function setModePersisted(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Ignore.
    }
  }

  // Per-section collapse state. Defaults to all-expanded. The map
  // tracks only the *collapsed* keys; missing key = expanded. That
  // way an arrival on a new bucket (after a label rename, say)
  // defaults to expanded rather than mysteriously hidden.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setCollapsed(new Set(parsed.filter((v) => typeof v === "string")));
        }
      }
    } catch {
      // Ignore.
    }
  }, []);
  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(
          COLLAPSED_STORAGE_KEY,
          JSON.stringify(Array.from(next)),
        );
      } catch {
        // Ignore.
      }
      return next;
    });
  }

  // Per-section sort state. Keyed by bucket key so each section can
  // sort independently — Major Bet might want sort-by-target, Quick
  // Win sort-by-health, simultaneously.
  const [sorts, setSorts] = useState<
    Record<string, { column: SortColumn; dir: SortDir }>
  >({});
  function clickSort(bucket: string, column: SortColumn) {
    setSorts((prev) => {
      const current = prev[bucket] ?? DEFAULT_SORT;
      const dir: SortDir =
        current.column === column && current.dir === "desc" ? "asc" : "desc";
      return { ...prev, [bucket]: { column, dir } };
    });
  }

  // Bucket projects. Computed once per (projects, labels) change so
  // sort state changes don't re-bucket — they only re-order rows
  // within the section.
  const buckets = useMemo(() => {
    const map = new Map<PortfolioPositionKey | "unknown", Project[]>();
    for (const key of SECTION_ORDER) map.set(key, []);
    for (const p of projects) {
      const pos = computePortfolioPosition(p, quadrantLabels);
      map.get(pos.key)!.push(p);
    }
    return map;
  }, [projects, quadrantLabels]);

  // Sort each bucket's rows according to the section's current sort
  // state. Memo dependency on `sorts` and `buckets` keeps the sort
  // cheap when neither changes.
  const sortedBuckets = useMemo(() => {
    const out = new Map<string, Project[]>();
    for (const [key, rows] of buckets) {
      const sort = sorts[key] ?? DEFAULT_SORT;
      const sorted = [...rows].sort((a, b) => {
        const primary = compareProjects(a, b, sort.column, sort.dir);
        if (primary !== 0) return primary;
        return defaultTiebreaker(a, b);
      });
      out.set(key, sorted);
    }
    return out;
  }, [buckets, sorts]);

  // ---- Chart mode: defer to the existing BubbleView. ----
  if (mode === "chart") {
    return (
      <div className="space-y-3">
        <ModeToggle mode={mode} onChange={setModePersisted} />
        <BubbleView
          projects={projects}
          onUpdateField={onUpdateField}
          onOpenQuickView={onOpenQuickView}
          canEdit={canEdit}
          quadrantLabels={quadrantLabels}
        />
      </div>
    );
  }

  // ---- List mode (default). ----
  return (
    <div className="space-y-3">
      <ModeToggle mode={mode} onChange={setModePersisted} />
      <div className="space-y-3">
        {SECTION_ORDER.map((key) => {
          const rows = sortedBuckets.get(key) ?? [];
          // Hide the Unscored section entirely when empty — keeping
          // it visible would imply a problem to fix when there's
          // none. The four real buckets stay visible even at zero.
          if (key === "unknown" && rows.length === 0) return null;
          const label =
            key === "unknown" ? "Unscored" : quadrantLabels[key];
          const sort = sorts[key] ?? DEFAULT_SORT;
          const isCollapsed = collapsed.has(key);
          return (
            <BucketSection
              key={key}
              bucketKey={key}
              label={label}
              description={SECTION_DESCRIPTIONS[key]}
              rows={rows}
              sort={sort}
              collapsed={isCollapsed}
              onToggleCollapsed={() => toggleCollapsed(key)}
              onSort={(c) => clickSort(key, c)}
              onOpenQuickView={onOpenQuickView}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View-mode toggle (List / Chart)
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Portfolio view mode"
      className="inline-flex rounded-md border border-gray-200 bg-white p-0.5"
    >
      {(["list", "chart"] as const).map((m) => {
        const active = m === mode;
        const label = m === "list" ? "List" : "Chart";
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(m)}
            className={`px-3 py-1 text-xs font-medium transition ${
              active
                ? "rounded bg-gray-900 text-white"
                : "rounded text-gray-600 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One bucket section
// ---------------------------------------------------------------------------

interface BucketSectionProps {
  bucketKey: PortfolioPositionKey | "unknown";
  label: string;
  description: string;
  rows: Project[];
  sort: { column: SortColumn; dir: SortDir };
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSort: (column: SortColumn) => void;
  onOpenQuickView: (projectId: string) => void;
}

function BucketSection({
  bucketKey,
  label,
  description,
  rows,
  sort,
  collapsed,
  onToggleCollapsed,
  onSort,
  onOpenQuickView,
}: BucketSectionProps) {
  const headerId = `portfolio-section-${bucketKey}`;
  const panelId = `portfolio-panel-${bucketKey}`;
  const empty = rows.length === 0;
  // Use the existing badge palette so the section header chip matches
  // the table column and the Kanban card badge — one visual language
  // for "this is a Quick Win" everywhere it appears.
  const badgeClass = PORTFOLIO_POSITION_BADGE[bucketKey];

  return (
    <section
      aria-labelledby={headerId}
      className="rounded-md border border-gray-200 bg-white"
    >
      <button
        id={headerId}
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50"
      >
        <span
          aria-hidden="true"
          className={`text-xs text-gray-500 transition ${collapsed ? "" : "rotate-90"}`}
          style={{ display: "inline-block", width: 10 }}
        >
          ▶
        </span>
        <span
          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${badgeClass}`}
        >
          {label}
        </span>
        <span className="text-sm font-medium text-gray-900">
          {rows.length} {rows.length === 1 ? "project" : "projects"}
        </span>
        <span className="hidden flex-1 truncate text-xs text-gray-500 md:inline">
          {description}
        </span>
      </button>

      {!collapsed && (
        <div id={panelId}>
          {empty ? (
            <div className="border-t border-dashed border-gray-200 px-3 py-6 text-center text-xs italic text-gray-500">
              No projects in this bucket.
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  <tr>
                    <Th
                      label="ID"
                      column="project_id"
                      sort={sort}
                      onSort={onSort}
                      width="w-24"
                    />
                    <Th
                      label="Name"
                      column="name"
                      sort={sort}
                      onSort={onSort}
                    />
                    <Th
                      label="Priority"
                      column="priority"
                      sort={sort}
                      onSort={onSort}
                      width="w-28"
                    />
                    <Th
                      label="Complexity"
                      column="complexity"
                      sort={sort}
                      onSort={onSort}
                      width="w-32"
                    />
                    <Th
                      label="Lead"
                      column="lead"
                      sort={sort}
                      onSort={onSort}
                      width="w-32"
                    />
                    <Th
                      label="Target"
                      column="target"
                      sort={sort}
                      onSort={onSort}
                      width="w-28"
                    />
                    <Th
                      label="Health"
                      column="health"
                      sort={sort}
                      onSort={onSort}
                      width="w-24"
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((p) => (
                    <Row key={p.project_id} project={p} onOpen={onOpenQuickView} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Th({
  label,
  column,
  sort,
  onSort,
  width,
}: {
  label: string;
  column: SortColumn;
  sort: { column: SortColumn; dir: SortDir };
  onSort: (column: SortColumn) => void;
  width?: string;
}) {
  const active = sort.column === column;
  return (
    <th scope="col" className={`px-3 py-2 ${width ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-gray-200 ${
          active ? "text-gray-900" : ""
        }`}
      >
        {label}
        {active ? (
          <span aria-hidden="true" className="text-[10px]">
            {sort.dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

function Row({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (id: string) => void;
}) {
  return (
    <tr
      onClick={() => onOpen(project.project_id)}
      className="cursor-pointer hover:bg-gray-50"
    >
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
        {project.project_id}
      </td>
      <td className="px-3 py-2 text-gray-900">{project.name}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityBadgeClass(project.priority)}`}
        >
          {project.priority}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
        {project.ai_complexity_score ?? (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
        {project.project_lead || (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
        {project.target_date || (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {project.health_score ? (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[project.health_score]}`}
            title={HEALTH_TOOLTIP[project.health_score]}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health_score]}`}
            />
            {project.health_score}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
    </tr>
  );
}
