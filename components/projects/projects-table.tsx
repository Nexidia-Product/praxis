"use client";

/**
 * Projects page main view (Section 5.1).
 *
 * Owns the in-memory state for the page:
 *
 *   - the project list (initialized from server-side props, then mutated
 *     locally as PATCH/POST/DELETE responses come back)
 *   - the filter set (`ProjectFilters`)
 *   - the sort column + direction
 *   - the "open status toggle" (open / completed / canceled / all)
 *   - which project is open in the quick-view panel
 *   - which project is open in the form modal (or null = create mode)
 *
 * No URL state syncing yet — the filter set lives in component state. If
 * the team starts wanting to share filtered links (e.g. "look at this
 * Slack URL for all blocked Complaints projects"), this is the obvious
 * place to add `nuqs` or `useSearchParams` wiring.
 *
 * Inline edits — status, phase, priority — fire one optimistic PATCH per
 * change. The bulk-action bar that previously lived here was removed
 * when the row checkbox was dropped; multi-row edits would need a new
 * affordance (a multiselect-via-shift-click pattern, or batch edit
 * server-side) if the team starts wanting them again.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  priorityBadgeClass,
  statusBadgeClass,
} from "@/lib/projects/display";
import { customFieldMatches } from "@/lib/projects/custom-filter";
import { rollupDependencyHealth } from "@/lib/projects/dependencies";
import type { EnumOption } from "@/lib/projects/enum-options";
import {
  PORTFOLIO_POSITION_BADGE,
  computePortfolioPosition,
} from "@/lib/projects/portfolio-position";
import type {
  CustomFieldDefinition,
  PortfolioQuadrantLabels,
  Priority,
  Project,
  ProjectGroup,
  ProjectPhase,
  ProjectStatus,
  TaskTemplate,
  UserRole,
} from "@/lib/db";
import { AiPriorityReviewModal } from "./ai-priority-review";
import { ProjectFormModal } from "./form-modal";
import { ProjectQuickView } from "./quick-view";
import {
  EMPTY_FILTERS,
  ProjectFilterBar,
  filtersToQueryString,
  type ProjectFilters,
} from "./filter-bar";

// ---------------------------------------------------------------------------
// Status visibility toggle (Section 5.1)
// ---------------------------------------------------------------------------

type StatusGroup = "open" | "completed" | "canceled" | "all";

const STATUS_GROUP_FILTER: Record<StatusGroup, (s: ProjectStatus) => boolean> =
  {
    open: (s) =>
      s === "Not Started" ||
      s === "In Planning" ||
      s === "In Progress" ||
      s === "Blocked" ||
      s === "On Hold" ||
      s === "Delayed",
    completed: (s) => s === "Completed",
    canceled: (s) => s === "Canceled",
    all: () => true,
  };

const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  open: "Open",
  completed: "Completed",
  canceled: "Canceled",
  all: "All",
};

// ---------------------------------------------------------------------------
// Sort columns
// ---------------------------------------------------------------------------

type SortKey =
  | "project_id"
  | "name"
  | "application_product"
  | "project_type"
  | "status"
  | "phase"
  | "priority"
  | "portfolio_position"
  | "project_lead"
  | "target_date"
  | "date_added";

/**
 * Default priority sort order for the four built-in values. Admin-added
 * priorities receive a rank from `enumOptions.priority[].rank`; values
 * not found in either map fall back to a high sentinel and sort to the
 * end. The rank map is computed per-render from the merged enum options
 * and threaded into `compareProjects`.
 */
const SYSTEM_PRIORITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function compareProjects(
  a: Project,
  b: Project,
  key: SortKey,
  priorityRank: Map<string, number>,
  quadrantLabels: PortfolioQuadrantLabels,
): number {
  if (key === "priority") {
    const ar = priorityRank.get(a.priority) ?? 99;
    const br = priorityRank.get(b.priority) ?? 99;
    return ar - br;
  }
  if (key === "portfolio_position") {
    // Sort by canonical bucket order (Quick Win → Major Bet → Fill-In →
    // Deprioritize → unknown), not by label string. This holds even
    // when admins have renamed the labels (e.g. "Quick Win" → "Easy
    // Wins"); the bucket each project lands in is determined by
    // priority × complexity, not by the label.
    return (
      computePortfolioPosition(a, quadrantLabels).sortWeight -
      computePortfolioPosition(b, quadrantLabels).sortWeight
    );
  }
  if (key === "target_date") {
    // Nulls always sort after non-null in ascending order — they're
    // unscheduled, so they belong at the bottom of "soonest first".
    const av = a.target_date ?? "";
    const bv = b.target_date ?? "";
    if (av === bv) return 0;
    if (av === "") return 1;
    if (bv === "") return -1;
    return av < bv ? -1 : 1;
  }
  const av = String(a[key as keyof Project] ?? "").toLowerCase();
  const bv = String(b[key as keyof Project] ?? "").toLowerCase();
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProjectsTableProps {
  initialProjects: Project[];
  customFields: CustomFieldDefinition[];
  currentUserRole: UserRole;
  /**
   * Optional permission map (`PermissionKey -> boolean`). When provided,
   * `canEdit` / `canDelete` are derived from `projects.edit` and
   * `projects.delete` instead of the role. The role-only fallback below
   * keeps existing tests working without wiring permissions through
   * every render path; production callers should always pass this so
   * the Roles & permissions matrix actually changes what users see.
   */
  permissions?: Record<string, boolean>;
  /** Available task templates — passed to the form modal on create. */
  templates?: TaskTemplate[];
  /**
   * Merged option lists for the four extensible enums (built-in values
   * plus admin-added extensions, archived excluded). When omitted (e.g.
   * tests) the form-modal and filter-bar fall back to the built-in
   * arrays defined in `lib/projects/display.ts`.
   */
  enumOptions?: {
    status: EnumOption[];
    phase: EnumOption[];
    priority: EnumOption[];
    application_product: EnumOption[];
  };
  /**
   * The four user-facing labels for the strategic-position bucket
   * (Quick Win / Major Bet / Fill-In / Deprioritize, or whatever the
   * admin renamed them to). Threaded down from the page so the table
   * column, sort comparator, and filter dropdown all use the same
   * labels.
   */
  quadrantLabels: PortfolioQuadrantLabels;
  /**
   * Whether AI Advisor features are enabled in this environment.
   * Resolved server-side from process.env.AI_ENABLED and passed down
   * so the AI priority review button (here) and the Generate AI
   * estimate button (inside the form modal) can hide themselves in
   * production. Persisted AI output — the AI Suggestion banner on
   * the project form, the overlap analysis on idea records — still
   * renders for everyone regardless of this flag; we're only
   * gating the *trigger* affordances.
   */
  aiEnabled: boolean;
  /**
   * Every project group in the system. Used to render the small
   * "in a group" indicator next to project names and to feed the
   * Related groups panel inside the quick view. Optional so older
   * callers that haven't been updated still type-check; missing
   * means "no indicator, no panel."
   */
  groups?: ProjectGroup[];
}

export function ProjectsTable({
  initialProjects,
  customFields,
  currentUserRole,
  permissions,
  templates,
  enumOptions,
  quadrantLabels,
  aiEnabled,
  groups = [],
}: ProjectsTableProps) {
  // Index groups by their member project IDs once per render so the
  // per-row indicator and the quick-view panel can both look up
  // "what groups does this project belong to?" in O(1).
  const groupsByProject = useMemo(() => {
    const m = new Map<string, ProjectGroup[]>();
    for (const g of groups) {
      for (const pid of g.member_project_ids) {
        const list = m.get(pid) ?? [];
        list.push(g);
        m.set(pid, list);
      }
    }
    return m;
  }, [groups]);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [filters, setFilters] = useState<ProjectFilters>(EMPTY_FILTERS);
  const [statusGroup, setStatusGroup] = useState<StatusGroup>("open");
  const [sortKey, setSortKey] = useState<SortKey>("date_added");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAiReview, setShowAiReview] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // Health-recalculation button state. We keep an in-flight flag so
  // the button can show a "Recalculating…" affordance, and a small
  // toast-style result message that auto-clears after a few seconds.
  // The recalc itself is wired via the dedicated
  // `/api/projects/recalculate-health` endpoint (Section 5.13) — see
  // the route doc for why this is separate from the admin-only
  // threshold-edit recalc.
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);

  // Permission-based gating with role fallback. The fallback mirrors
  // the previous hardcoded behavior so we don't regress existing flows
  // when `permissions` isn't passed; new callers should always pass it
  // so an admin can grant `projects.edit` to a Team Member from the
  // Roles & permissions matrix and have it actually show up.
  const canEdit = permissions
    ? permissions["projects.edit"] === true
    : currentUserRole === "Admin" || currentUserRole === "Project Lead";
  const canCreate = permissions
    ? permissions["projects.create"] === true
    : currentUserRole === "Admin" || currentUserRole === "Project Lead";
  const canDelete = permissions
    ? permissions["projects.delete"] === true
    : currentUserRole === "Admin";

  // ---- Derived option lists for the filter bar / form datalists. ----
  const leadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      if (p.project_lead) set.add(p.project_lead);
    }
    return Array.from(set).sort();
  }, [projects]);

  /**
   * Per-render priority rank lookup. Combines the system ordering
   * (Critical=0 → Low=3) with admin-added rank values from
   * `enumOptions.priority`. The result is fed to `compareProjects` so
   * sorting by priority places admin values correctly. Values not
   * present in either map fall through to a high sentinel and sort
   * last.
   */
  const priorityRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(SYSTEM_PRIORITY_ORDER)) m.set(k, v);
    if (enumOptions) {
      for (const o of enumOptions.priority) {
        if (typeof o.rank === "number") m.set(o.id, o.rank);
      }
    }
    return m;
  }, [enumOptions]);

  const applicationOptions = useMemo(() => {
    // Admin-curated values come first (in their declared order from the
    // settings file), then any application_product strings discovered in
    // the dataset that aren't already covered. Deduped, case-insensitive.
    const seen = new Set<string>();
    const out: string[] = [];
    if (enumOptions) {
      for (const o of enumOptions.application_product) {
        const key = o.id.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(o.id);
        }
      }
    }
    for (const p of projects) {
      if (!p.application_product) continue;
      const key = p.application_product.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p.application_product);
      }
    }
    // Sort the dataset-discovered tail alphabetically; preserve admin
    // order for the curated head.
    const curatedCount = enumOptions?.application_product.length ?? 0;
    const head = out.slice(0, curatedCount);
    const tail = out.slice(curatedCount).sort();
    return [...head, ...tail];
  }, [projects, enumOptions]);

  // Per-row dependency-health rollup (Section 5.10). Computed once per
  // project-list render so each row reads its value with O(1) Map lookup
  // rather than re-walking dependencies on every render. Entries with
  // `null` (no dependencies) are absent from the map; the row reads
  // `dependencyRollup.get(id)` and renders nothing when it's `undefined`.
  const dependencyRollup = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.project_id, p]));
    const out = new Map<string, "clear" | "at-risk" | "blocked">();
    for (const p of projects) {
      const r = rollupDependencyHealth(p, byId);
      if (r) out.set(p.project_id, r);
    }
    return out;
  }, [projects]);

  // ---- Filtering + sorting. ----
  const visibleProjects = useMemo(() => {
    const groupTest = STATUS_GROUP_FILTER[statusGroup];
    const search = filters.search.trim().toLowerCase();

    const filtered = projects.filter((p) => {
      if (!groupTest(p.status)) return false;
      if (filters.status.length && !filters.status.includes(p.status)) return false;
      if (filters.phase.length && !filters.phase.includes(p.phase)) return false;
      if (filters.priority.length && !filters.priority.includes(p.priority))
        return false;
      if (
        filters.project_type.length &&
        !filters.project_type.includes(p.project_type)
      )
        return false;
      if (
        filters.project_lead.length &&
        !filters.project_lead.includes(p.project_lead)
      )
        return false;
      if (
        filters.application_product.length &&
        !filters.application_product.includes(p.application_product)
      )
        return false;
      if (filters.portfolio_position.length) {
        const pos = computePortfolioPosition(p, quadrantLabels);
        if (!filters.portfolio_position.includes(pos.key)) return false;
      }
      if (filters.target_from) {
        if (!p.target_date || p.target_date < filters.target_from) return false;
      }
      if (filters.target_to) {
        if (!p.target_date || p.target_date > filters.target_to) return false;
      }
      if (search) {
        const haystack =
          `${p.project_id} ${p.name} ${p.description}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      // Custom-field filters. Each definition's filter is an independent
      // AND clause — a project must pass every active custom-field filter
      // to be visible. Definitions removed admin-side become inert.
      for (const def of customFields) {
        const f = filters.custom[def.key];
        if (!customFieldMatches(p, def, f)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const cmp = compareProjects(a, b, sortKey, priorityRank, quadrantLabels);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [
    projects,
    filters,
    statusGroup,
    sortKey,
    sortDir,
    customFields,
    priorityRank,
    quadrantLabels,
  ]);

  // ---- Counts for the status toggle buttons. ----
  const statusCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = {
      open: 0,
      completed: 0,
      canceled: 0,
      all: projects.length,
    };
    for (const p of projects) {
      if (STATUS_GROUP_FILTER.open(p.status)) counts.open++;
      else if (STATUS_GROUP_FILTER.completed(p.status)) counts.completed++;
      else if (STATUS_GROUP_FILTER.canceled(p.status)) counts.canceled++;
    }
    return counts;
  }, [projects]);

  // ---- Helpers for mutating the in-memory list after API responses. ----
  function applyUpdated(updated: Project) {
    setProjects((prev) =>
      prev.map((p) => (p.project_id === updated.project_id ? updated : p)),
    );
  }

  function applyCreated(created: Project) {
    setProjects((prev) => [created, ...prev]);
  }

  // ---- Inline status edit. Used by both the row select and the quick view. ----
  async function changeStatus(
    project: Project,
    status: ProjectStatus,
    summary?: string,
  ) {
    // Short-circuit when there's nothing to do: same status AND no
    // summary. A same-status call with a summary is the deliberate
    // "annotate the current status" flow from the Status tab and
    // must reach the server so the entry gets archived.
    const trimmed = summary?.trim() ?? "";
    if (status === project.status && trimmed.length === 0) return;
    setGlobalError(null);
    // Optimistic so the dropdown feels instant; revert on failure.
    const prev = projects;
    if (status !== project.status) {
      applyUpdated({ ...project, status });
    }
    // Build the patch body. Only include status_summary when the
    // caller actually supplied one — keeps the wire payload minimal
    // and matches what the deliberate "Status" tab editor sends.
    const body: Record<string, unknown> = { status };
    if (trimmed.length > 0) {
      body.status_summary = trimmed;
    }
    const res = await fetch(`/api/projects/${project.project_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    if (!res.ok || !data.project) {
      setProjects(prev);
      setGlobalError(data.error ?? "Could not update status.");
      return;
    }
    applyUpdated(data.project);
  }

  /**
   * Patch a single field optimistically. Used for inline phase/priority
   * edits on the quick-view panel — same pattern as `changeStatus` but
   * generalized over the field name so we don't duplicate the
   * fetch/revert plumbing twice. Returns nothing; surfaces errors via
   * `setGlobalError`.
   */
  async function patchField<K extends "phase" | "priority">(
    project: Project,
    field: K,
    value: K extends "phase" ? ProjectPhase : Priority,
  ) {
    if (project[field] === value) return;
    setGlobalError(null);
    const prev = projects;
    applyUpdated({ ...project, [field]: value } as Project);
    const res = await fetch(`/api/projects/${project.project_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    if (!res.ok || !data.project) {
      setProjects(prev);
      setGlobalError(data.error ?? `Could not update ${field}.`);
      return;
    }
    applyUpdated(data.project);
  }

  async function changePhase(project: Project, phase: ProjectPhase) {
    return patchField(project, "phase", phase);
  }
  async function changePriority(project: Project, priority: Priority) {
    return patchField(project, "priority", priority);
  }

  /**
   * Force-refresh every project's health score. Hits the on-demand
   * recalc endpoint (which gates on `projects.view` rather than the
   * admin threshold-edit permission) and re-fetches the project list
   * so any badges that flipped show the new color immediately.
   *
   * Note: the dataset rarely needs this — health scores recompute
   * automatically when a task is updated or a project field changes,
   * via post-hooks in the project / task service layers. The button
   * is the trust escape hatch ("I know I made changes, I want to be
   * sure"), not the primary path.
   */
  async function recalcAllHealthScores() {
    if (recalcBusy) return;
    setGlobalError(null);
    setRecalcResult(null);
    setRecalcBusy(true);
    try {
      const res = await fetch("/api/projects/recalculate-health", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        changed?: number;
        error?: string;
      };
      if (!res.ok) {
        setGlobalError(data.error ?? "Could not recalculate health scores.");
        return;
      }
      // Pull the freshly-scored projects so any flipped badges show.
      // `cache: "no-store"` is necessary because Next caches GET /api
      // responses by default; the recalc's whole purpose is to bypass
      // staleness, so we do too.
      const refresh = await fetch("/api/projects", { cache: "no-store" });
      if (refresh.ok) {
        const refreshData = (await refresh.json().catch(() => ({}))) as {
          projects?: Project[];
        };
        if (refreshData.projects) setProjects(refreshData.projects);
      }
      const n = data.changed ?? 0;
      setRecalcResult(
        n === 0
          ? "Health scores recalculated — no changes."
          : `Health scores recalculated — ${n} project${n === 1 ? "" : "s"} updated.`,
      );
    } catch (err) {
      setGlobalError(
        err instanceof Error
          ? err.message
          : "Could not recalculate health scores.",
      );
    } finally {
      setRecalcBusy(false);
    }
  }

  // Auto-clear the recalc result message after 5s so it doesn't sit
  // stale on the toolbar. We don't dismiss errors automatically; those
  // stay until the user takes an action.
  useEffect(() => {
    if (!recalcResult) return;
    const t = window.setTimeout(() => setRecalcResult(null), 5000);
    return () => window.clearTimeout(t);
  }, [recalcResult]);

  // ---- Sort header click. ----
  function handleSortClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column type. Date columns descending
      // ("most recent first"), everything else ascending.
      setSortDir(
        key === "date_added" || key === "target_date" ? "desc" : "asc",
      );
    }
  }

  // ---- Export. ----
  function exportFile(format: "csv" | "xlsx") {
    const qs = filtersToQueryString({
      ...filters,
      // Translate the status group toggle into explicit status filters so the
      // export endpoint produces the same row set the user sees on screen.
      status:
        filters.status.length > 0
          ? filters.status
          : statusGroup === "all"
            ? []
            : PROJECT_STATUSES.filter((s) => STATUS_GROUP_FILTER[statusGroup](s)),
    });
    const params = new URLSearchParams(qs);
    if (format === "xlsx") params.set("format", "xlsx");
    const final = params.toString();
    window.location.href = `/api/projects/export${final ? `?${final}` : ""}`;
  }

  // ---- Render. ----
  const quickViewProject =
    quickViewId !== null
      ? projects.find((p) => p.project_id === quickViewId) ?? null
      : null;

  return (
    <div className="space-y-3">
      {/* Status group toggle + new button */}
      <div className="toolbar">
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: "var(--pol-radius)",
            background: "var(--card)",
            padding: 2,
          }}
        >
          {(Object.keys(STATUS_GROUP_LABEL) as StatusGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setStatusGroup(g)}
              style={{
                padding: "3px 12px",
                border: "none",
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background:
                  statusGroup === g ? "var(--brand)" : "transparent",
                color: statusGroup === g ? "#fff" : "var(--t2)",
                transition: "background 0.1s, color 0.1s",
              }}
            >
              {STATUS_GROUP_LABEL[g]}
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: 0.85,
                }}
              >
                {statusCounts[g]}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {recalcResult ? (
            <span
              role="status"
              style={{
                fontSize: 11,
                color: "var(--ok)",
                paddingRight: 4,
              }}
            >
              {recalcResult}
            </span>
          ) : null}
          <button
            type="button"
            onClick={recalcAllHealthScores}
            disabled={recalcBusy}
            className="pol-btn pol-btn-secondary"
            title="Recalculate every project's health score against the current thresholds. Useful if a badge looks stale after recent edits."
          >
            {recalcBusy ? "Recalculating…" : "↻ Recalc health"}
          </button>
          {canCreate && aiEnabled ? (
            <button
              type="button"
              onClick={() => setShowAiReview(true)}
              className="pol-btn pol-btn-secondary"
              title="Ask the AI Advisor to rank open projects with rationales. Advisory only — nothing is auto-applied."
            >
              ✦ AI priority review
            </button>
          ) : null}
          <ExportMenu onExport={exportFile} />
          {canCreate ? (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="pol-btn pol-btn-primary"
            >
              + New project
            </button>
          ) : null}
        </div>
      </div>

      <ProjectFilterBar
        filters={filters}
        onChange={setFilters}
        leadOptions={leadOptions}
        applicationOptions={applicationOptions}
        statusOptions={enumOptions?.status}
        phaseOptions={enumOptions?.phase}
        priorityOptions={enumOptions?.priority}
        customFields={customFields}
        quadrantLabels={quadrantLabels}
      />

      {globalError ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{globalError}</span>
        </div>
      ) : null}

      {/* Table */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--pol-radius)",
          overflow: "hidden",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ fontSize: "var(--fs-sm)" }}>
            <thead
              style={{
                background: "var(--bg)",
                borderBottom: "2px solid var(--border)",
              }}
            >
              <tr style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--tm)" }}>
                <Th
                  active={sortKey === "project_id"}
                  dir={sortDir}
                  onClick={() => handleSortClick("project_id")}
                >
                  ID
                </Th>
                <Th
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => handleSortClick("name")}
                >
                  Name
                </Th>
                <Th
                  active={sortKey === "application_product"}
                  dir={sortDir}
                  onClick={() => handleSortClick("application_product")}
                >
                  App / Product
                </Th>
                <Th
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => handleSortClick("status")}
                >
                  Status
                </Th>
                <Th
                  active={sortKey === "phase"}
                  dir={sortDir}
                  onClick={() => handleSortClick("phase")}
                >
                  Phase
                </Th>
                <Th
                  active={sortKey === "priority"}
                  dir={sortDir}
                  onClick={() => handleSortClick("priority")}
                >
                  Priority
                </Th>
                <Th
                  active={sortKey === "portfolio_position"}
                  dir={sortDir}
                  onClick={() => handleSortClick("portfolio_position")}
                  title="Strategic position based on priority × complexity"
                >
                  Position
                </Th>
                <Th
                  active={sortKey === "project_lead"}
                  dir={sortDir}
                  onClick={() => handleSortClick("project_lead")}
                >
                  Lead
                </Th>
                {/* Resources column: read-only display of
                    additional_resources. Not sortable (it's a list,
                    so a column-level sort would be ambiguous). The
                    `<th>` matches the plain-header style of Health
                    rather than the sortable `<Th>`. */}
                <th scope="col" className="px-3 py-2">
                  Resources
                </th>
                <Th
                  active={sortKey === "target_date"}
                  dir={sortDir}
                  onClick={() => handleSortClick("target_date")}
                >
                  Target
                </Th>
                <th scope="col" className="px-3 py-2">
                  Health
                </th>
              </tr>
            </thead>
            <tbody style={{ background: "var(--card)" }}>
              {visibleProjects.map((p) => {
                return (
                  <tr
                    key={p.project_id}
                    onClick={() => setQuickViewId(p.project_id)}
                    style={{
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border)",
                    }}
                    className="hoverable-row"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-gray-500">
                      {p.project_id}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900">
                      <span className="inline-flex items-center gap-1.5">
                        {p.name}
                        {(() => {
                          const r = dependencyRollup.get(p.project_id);
                          if (!r || r === "clear") return null;
                          return (
                            <span
                              role="img"
                              aria-label={
                                r === "blocked"
                                  ? "Upstream dependency blocked"
                                  : "Upstream dependency at risk"
                              }
                              title={
                                r === "blocked"
                                  ? "An upstream dependency is blocked"
                                  : "An upstream dependency is at risk"
                              }
                              className="text-[11px]"
                            >
                              {r === "blocked" ? "🛑" : "⚠️"}
                            </span>
                          );
                        })()}
                        {(() => {
                          const memberOf = groupsByProject.get(p.project_id);
                          if (!memberOf || memberOf.length === 0) return null;
                          // Tooltip lists every group the project belongs
                          // to so a hover reveals the cluster names
                          // without needing to open the quick view.
                          const tooltip =
                            memberOf.length === 1
                              ? `In group: ${memberOf[0].name}`
                              : `In ${memberOf.length} groups: ${memberOf
                                  .map((g) => g.name)
                                  .join(", ")}`;
                          return (
                            <span
                              role="img"
                              aria-label={tooltip}
                              title={tooltip}
                              className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200"
                            >
                              ◖{memberOf.length > 1 ? memberOf.length : ""}
                            </span>
                          );
                        })()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      {p.application_product}
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEdit ? (
                        <select
                          value={p.status}
                          onChange={(e) =>
                            changeStatus(p, e.target.value as ProjectStatus)
                          }
                          className={`rounded-md border-0 px-2 py-0.5 text-xs font-medium ${statusBadgeClass(p.status)} focus:outline-none focus:ring-2 focus:ring-gray-900`}
                        >
                          {(enumOptions?.status ?? []).length > 0
                            ? enumOptions!.status.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))
                            : PROJECT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusBadgeClass(p.status)}`}
                        >
                          {p.status}
                        </span>
                      )}
                    </td>
                    {/* Phase: inline-editable, same pattern as
                        Status. stopPropagation prevents the row's
                        onClick (which opens the panel) from firing
                        when the user opens the dropdown. */}
                    <td
                      className="whitespace-nowrap px-3 py-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEdit ? (
                        <select
                          value={p.phase}
                          onChange={(e) =>
                            changePhase(p, e.target.value as ProjectPhase)
                          }
                          className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                        >
                          {(enumOptions?.phase ?? []).length > 0
                            ? enumOptions!.phase.map((ph) => (
                                <option key={ph.id} value={ph.id}>
                                  {ph.label}
                                </option>
                              ))
                            : PROJECT_PHASES.map((ph) => (
                                <option key={ph} value={ph}>
                                  {ph}
                                </option>
                              ))}
                          {/* Defensive: preserve archived value if the
                              project still uses it. */}
                          {p.phase &&
                          !(enumOptions?.phase ?? []).some(
                            (ph) => ph.id === p.phase,
                          ) &&
                          !(PROJECT_PHASES as string[]).includes(p.phase) ? (
                            <option value={p.phase}>{p.phase}</option>
                          ) : null}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-700">
                          {p.phase}
                        </span>
                      )}
                    </td>
                    {/* Priority: inline-editable. The select is styled
                        as a colored chip via priorityBadgeClass to
                        match the read-only span it replaces. */}
                    <td
                      className="whitespace-nowrap px-3 py-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEdit ? (
                        <select
                          value={p.priority}
                          onChange={(e) =>
                            changePriority(p, e.target.value as Priority)
                          }
                          className={`rounded-md border-0 px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(p.priority)} focus:outline-none focus:ring-2 focus:ring-gray-900`}
                        >
                          {(enumOptions?.priority ?? []).length > 0
                            ? enumOptions!.priority.map((pr) => (
                                <option key={pr.id} value={pr.id}>
                                  {pr.label}
                                </option>
                              ))
                            : PRIORITIES.map((pr) => (
                                <option key={pr} value={pr}>
                                  {pr}
                                </option>
                              ))}
                          {p.priority &&
                          !(enumOptions?.priority ?? []).some(
                            (pr) => pr.id === p.priority,
                          ) &&
                          !(PRIORITIES as string[]).includes(p.priority) ? (
                            <option value={p.priority}>{p.priority}</option>
                          ) : null}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(p.priority)}`}
                        >
                          {p.priority}
                        </span>
                      )}
                    </td>
                    {/* Strategic position — derived from priority ×
                        complexity. Read-only; admins rename labels in
                        Admin Console → Portfolio quadrants. Tooltip
                        shows which inputs produced this bucket so a
                        user wondering "why's this a Major Bet?" gets
                        the answer at a glance. */}
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {(() => {
                        const pos = computePortfolioPosition(p, quadrantLabels);
                        const tip =
                          pos.key === "unknown"
                            ? "No AI complexity score yet — strategic position can't be computed."
                            : `${p.priority} priority × ${p.ai_complexity_score} complexity`;
                        return (
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${PORTFOLIO_POSITION_BADGE[pos.key]}`}
                            title={tip}
                          >
                            {pos.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-700">
                      {p.project_lead || "—"}
                    </td>
                    {/* Resources cell. additional_resources is a
                        free-form string array (mix of UserIds and
                        names per the data model); we render it
                        comma-joined and truncate via
                        `max-w-[12rem] truncate` so a long list
                        doesn't blow out the column. The full list
                        is in the cell's `title` attribute so a
                        tooltip reveals everything on hover. */}
                    <td
                      className="max-w-[12rem] truncate px-3 py-2.5 text-gray-700"
                      title={
                        p.additional_resources.length > 0
                          ? p.additional_resources.join(", ")
                          : undefined
                      }
                    >
                      {p.additional_resources.length > 0
                        ? p.additional_resources.join(", ")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-700">
                      {p.target_date ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {p.health_score ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[p.health_score]}`}
                          title={HEALTH_TOOLTIP[p.health_score]}
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[p.health_score]}`}
                          />
                          {p.health_score}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibleProjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={canEdit ? 10 : 9}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    {projects.length === 0
                      ? "No projects yet. Click ‘New project’ to create the first one."
                      : "No projects match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          <span>
            {visibleProjects.length} of {projects.length} project
            {projects.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Quick view */}
      {quickViewProject ? (
        <ProjectQuickView
          project={quickViewProject}
          customFields={customFields}
          canEdit={canEdit}
          allProjects={projects}
          statusOptions={enumOptions?.status}
          phaseOptions={enumOptions?.phase}
          priorityOptions={enumOptions?.priority}
          groupsForProject={
            groupsByProject.get(quickViewProject.project_id) ?? []
          }
          onClose={() => setQuickViewId(null)}
          onEdit={() => {
            setModalProject(quickViewProject);
            setQuickViewId(null);
          }}
          onSelectRelatedProject={(id) => setQuickViewId(id)}
          onStatusChange={(status, summary) =>
            changeStatus(quickViewProject, status, summary)
          }
          onPhaseChange={(phase) => changePhase(quickViewProject, phase)}
          onPriorityChange={(priority) =>
            changePriority(quickViewProject, priority)
          }
        />
      ) : null}

      <AiPriorityReviewModal
        open={showAiReview}
        onClose={() => setShowAiReview(false)}
        projects={projects}
        onSelectProject={(id) => {
          setShowAiReview(false);
          setQuickViewId(id);
        }}
      />

      {/* Create / edit modal */}
      {showCreateModal ? (
        <ProjectFormModal
          project={null}
          customFields={customFields}
          leadOptions={leadOptions}
          applicationOptions={applicationOptions}
          statusOptions={enumOptions?.status}
          phaseOptions={enumOptions?.phase}
          priorityOptions={enumOptions?.priority}
          templates={templates}
          allProjects={projects}
          aiEnabled={aiEnabled}
          onClose={() => setShowCreateModal(false)}
          onSaved={(p) => {
            applyCreated(p);
            setShowCreateModal(false);
          }}
        />
      ) : null}

      {modalProject ? (
        <ProjectFormModal
          project={modalProject}
          customFields={customFields}
          leadOptions={leadOptions}
          applicationOptions={applicationOptions}
          statusOptions={enumOptions?.status}
          phaseOptions={enumOptions?.phase}
          priorityOptions={enumOptions?.priority}
          templates={templates}
          allProjects={projects}
          aiEnabled={aiEnabled}
          onClose={() => setModalProject(null)}
          onSaved={(p) => {
            applyUpdated(p);
            setModalProject(null);
          }}
        />
      ) : null}

      {/* canDelete is reserved for the row-level delete control that lives
          in the modal in a future iteration — declaring the variable here
          keeps the role-check colocated with the rest of the page logic. */}
      {canDelete ? null : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export menu
// ---------------------------------------------------------------------------

function ExportMenu({
  onExport,
}: {
  onExport: (format: "csv" | "xlsx") => void;
}) {
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

  function pick(format: "csv" | "xlsx") {
    setOpen(false);
    onExport(format);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        Export
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-gray-500" aria-hidden="true">
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
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("csv")}
            className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100"
          >
            <span className="font-medium">CSV</span>
            <span className="text-xs text-gray-500">.csv (universal)</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("xlsx")}
            className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100"
          >
            <span className="font-medium">Excel</span>
            <span className="text-xs text-gray-500">
              .xlsx (typed columns)
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

function Th({
  active,
  dir,
  onClick,
  title,
  children,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  /** Optional native tooltip on the header button. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <th scope="col" className="px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-gray-200 ${
          active ? "text-gray-900" : ""
        }`}
      >
        {children}
        {active ? (
          <span aria-hidden="true" className="text-[10px]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </th>
  );
}
