"use client";

/**
 * Roadmap workspace (Sections 5.4–5.7).
 *
 * Owns the shared state for the four roadmap views: filter set, active
 * view tab, "include closed projects" toggle, the working project list
 * (with optimistic local edits), saved Kanban configurations, and the
 * id of the project currently shown in the quick-view side panel.
 *
 * Why one component instead of one per view:
 *   - The four views share a single filter bar and project list, so
 *     a user toggling between Timeline → Kanban → Bubble keeps the
 *     same scope without re-applying. Pulling that state into a parent
 *     keeps each view simple and stateless wrt shared concerns.
 *   - Drag-to-update edits in any view should reflect in the others on
 *     the next switch. We funnel all writes through `applyUpdated()` so
 *     the working list is the single source of truth.
 *
 * Edits go through `/api/projects/{id}` PATCH; saved Kanban configs go
 * through `/api/roadmap/kanban-configs`. Both are existing repository-
 * backed endpoints — no new persistence is invented here.
 *
 * Capacity / Resources lived here originally (Section 5.8) but has
 * moved to `/insights/resources` — the swim-lane Gantt is now a tab on
 * that page and combines with task load, performance metrics, and
 * per-resource detail.
 */

import { useMemo, useState } from "react";

import { ProjectQuickView } from "@/components/projects/quick-view";
import { ExportModal } from "@/components/roadmap/export-modal";
import { RoadmapFilterBar } from "@/components/roadmap/filter-bar";
import { RoadmapTabs } from "@/components/roadmap/tabs";
import { ProjectFormModal } from "@/components/projects/form-modal";
import { TimelineView } from "@/components/roadmap/timeline-view";
import { KanbanView } from "@/components/roadmap/kanban-view";
import { PortfolioView } from "@/components/roadmap/portfolio-view";
import { NowNextLaterView } from "@/components/roadmap/now-next-later-view";
import {
  applyRoadmapFilters,
  EMPTY_ROADMAP_FILTERS,
  type RoadmapFilters,
} from "@/lib/roadmap/filters";
import type { RoadmapView } from "@/lib/roadmap/views";
import type { EnumOption } from "@/lib/projects/enum-options";
import type {
  CustomFieldDefinition,
  PortfolioQuadrantLabels,
  Project,
  ProjectStatus,
  SavedKanbanConfig,
  TaskTemplate,
  UserRole,
} from "@/lib/db";

interface RoadmapWorkspaceProps {
  initialProjects: Project[];
  initialKanbanConfigs: SavedKanbanConfig[];
  customFields: CustomFieldDefinition[];
  currentUserRole: UserRole;
  /**
   * Optional permission map. When provided, drag-to-edit and other
   * mutating affordances are gated by `projects.edit` instead of the
   * role; the role-only fallback below preserves existing behavior for
   * tests and callers that haven't been wired through.
   */
  permissions?: Record<string, boolean>;
  /**
   * Strategic-position labels from settings (Quick Win / Major Bet /
   * Fill-In / Deprioritize, or whatever an admin renamed them to).
   * Threaded down to the Kanban card badge and the bubble chart's
   * default-axis quadrant labels.
   */
  quadrantLabels: PortfolioQuadrantLabels;
  /**
   * Merged enum option lists (built-ins + admin extensions, archived
   * excluded). Passed through to the project form modal opened from
   * the roadmap quick view so admin-added status / phase / priority
   * values appear in its dropdowns. Optional — when omitted the form
   * falls back to the built-in arrays.
   */
  enumOptions?: {
    status: EnumOption[];
    phase: EnumOption[];
    priority: EnumOption[];
    application_product: EnumOption[];
  };
  /**
   * Task templates. Used by the project form modal on Create (the
   * modal is reachable from here only in Edit mode today, but
   * threading the prop keeps create-from-roadmap easy to wire
   * later). Optional.
   */
  templates?: TaskTemplate[];
  /**
   * Whether the AI Advisor is reachable in this environment. Threaded
   * into the form modal so the Generate AI estimate button hides in
   * production. Optional; defaults to false.
   */
  aiEnabled?: boolean;
  /**
   * Names of every active user. Unioned with the project-derived
   * lead list to populate the form modal's Project lead dropdown
   * (so a brand-new project can be assigned to anyone, not just
   * users who already lead a project). Optional; when omitted the
   * dropdown falls back to project-derived names only.
   */
  activeUserNames?: string[];
}

export function RoadmapWorkspace({
  initialProjects,
  initialKanbanConfigs,
  customFields,
  currentUserRole,
  permissions,
  quadrantLabels,
  enumOptions,
  templates,
  aiEnabled = false,
  activeUserNames = [],
}: RoadmapWorkspaceProps) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  // Project being edited. When non-null, ProjectFormModal is mounted
  // pre-loaded with this record. Distinct from `quickViewId` — the
  // quick view is a read-mostly side panel; Edit pops a full modal
  // that the user dismisses explicitly.
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [savedConfigs, setSavedConfigs] =
    useState<SavedKanbanConfig[]>(initialKanbanConfigs);
  const [filters, setFilters] =
    useState<RoadmapFilters>(EMPTY_ROADMAP_FILTERS);
  const [view, setView] = useState<RoadmapView>("timeline");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // The PPTX export modal is mounted lazily so the heavy export-renderer
  // module (and its html2canvas import) doesn't load until the user asks
  // for it. Tracked as an open/closed boolean rather than a full state
  // object since the modal owns its own form state internally.
  const [exportOpen, setExportOpen] = useState(false);

  // Edit gating: drag-to-mutate on the roadmap is governed by
  // `projects.edit`. Falls back to "Admin or Project Lead" when no
  // permission map is provided, mirroring the prior behavior.
  const canEdit = permissions
    ? permissions["projects.edit"] === true
    : currentUserRole === "Admin" || currentUserRole === "Project Lead";
  // PPTX export is its own permission so an organization can grant
  // "view roadmap, can't export" or vice versa via the matrix. Falls
  // back to "any signed-in user" when no permission map is provided —
  // the prior behavior, since the button used to be unconditionally
  // visible.
  const canExport = permissions
    ? permissions["roadmap.export"] === true
    : true;

  // Lead and application/product option lists for the filter bar.
  // Derived from the projects we actually have, deduplicated and sorted.
  // Recomputed only when the project list changes.
  const { leadOptions, applicationOptions } = useMemo(() => {
    const leads = new Set<string>();
    const apps = new Set<string>();
    for (const p of projects) {
      if (p.project_lead) leads.add(p.project_lead);
      if (p.application_product) apps.add(p.application_product);
    }
    return {
      leadOptions: Array.from(leads).sort(),
      applicationOptions: Array.from(apps).sort(),
    };
  }, [projects]);

  // formLeadOptions is the FORM modal's dropdown source (reachable
  // via the Edit project button on the quick view). Unions every
  // active user's name with the project-derived list, case-
  // insensitive dedup. The filter bar keeps `leadOptions` —
  // filtering by a lead who has no projects yields nothing useful.
  const formLeadOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    };
    for (const n of activeUserNames) add(n);
    for (const l of leadOptions) add(l);
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [activeUserNames, leadOptions]);

  // Filtered list shared by every view. Some views (timeline, bubble)
  // accept the `includeClosed` toggle; the others always hide closed
  // projects (their layouts assume in-flight work).
  const visibleProjects = useMemo(() => {
    const showClosed =
      includeClosed && (view === "timeline" || view === "bubble");
    return applyRoadmapFilters(projects, filters, {
      includeClosed: showClosed,
    });
  }, [projects, filters, includeClosed, view]);

  // ---- Mutations. ----------------------------------------------------

  /**
   * Replace a project in the working list. We never re-fetch from the
   * server on a successful edit — the PATCH endpoint returns the canonical
   * updated record, which we use to keep client and server identical.
   */
  function applyUpdated(updated: Project): void {
    setProjects((prev) =>
      prev.map((p) => (p.project_id === updated.project_id ? updated : p)),
    );
  }

  async function handleUpdateField(
    projectId: string,
    field: string,
    value: string | null,
  ): Promise<void> {
    setGlobalError(null);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    if (!res.ok || !data.project) {
      setGlobalError(data.error ?? `Could not update ${field}.`);
      throw new Error(data.error ?? `Could not update ${field}`);
    }
    applyUpdated(data.project);
  }

  async function handleUpdateTargetDate(
    projectId: string,
    isoDate: string,
  ): Promise<void> {
    await handleUpdateField(projectId, "target_date", isoDate);
  }

  async function handleStatusChange(
    projectId: string,
    status: ProjectStatus,
    summary?: string,
  ): Promise<void> {
    setGlobalError(null);
    // Build the patch body. We don't reuse `handleUpdateField` here
    // because that helper sends a single { [field]: value } shape;
    // the status update needs to optionally include `status_summary`
    // alongside `status` in one PATCH so the service archives both
    // atomically.
    const body: Record<string, unknown> = { status };
    if (summary !== undefined && summary.length > 0) {
      body.status_summary = summary;
    }
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    if (!res.ok || !data.project) {
      setGlobalError(data.error ?? "Could not update status.");
      throw new Error(data.error ?? "Could not update status");
    }
    applyUpdated(data.project);
  }

  async function handleSaveConfig(
    config: Omit<SavedKanbanConfig, "config_id" | "created_at" | "created_by">,
  ): Promise<SavedKanbanConfig> {
    setGlobalError(null);
    const res = await fetch("/api/roadmap/kanban-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = (await res.json().catch(() => ({}))) as {
      config?: SavedKanbanConfig;
      error?: string;
    };
    if (!res.ok || !data.config) {
      const msg = data.error ?? "Could not save Kanban config.";
      setGlobalError(msg);
      throw new Error(msg);
    }
    setSavedConfigs((prev) => [...prev, data.config!]);
    return data.config;
  }

  async function handleDeleteConfig(configId: string): Promise<void> {
    setGlobalError(null);
    const res = await fetch(
      `/api/roadmap/kanban-configs?id=${encodeURIComponent(configId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const msg = data.error ?? "Could not delete Kanban config.";
      setGlobalError(msg);
      throw new Error(msg);
    }
    setSavedConfigs((prev) => prev.filter((c) => c.config_id !== configId));
  }

  // ---- Render. -------------------------------------------------------

  const quickViewProject =
    quickViewId !== null
      ? projects.find((p) => p.project_id === quickViewId) ?? null
      : null;

  // Timeline and Bubble are the only views where viewing closed projects
  // adds value (historical record). For Kanban and Now/Next/Later, the
  // toggle is hidden to keep the bar uncluttered.
  const showIncludeClosed = view === "timeline" || view === "bubble";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RoadmapTabs active={view} onChange={setView} />
        {canExport ? (
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
            title="Export the current roadmap as a PowerPoint deck"
          >
            <span aria-hidden>↓</span>
            Export PPTX
          </button>
        ) : null}
      </div>

      <RoadmapFilterBar
        filters={filters}
        onChange={setFilters}
        leadOptions={leadOptions}
        applicationOptions={applicationOptions}
        includeClosed={showIncludeClosed ? includeClosed : undefined}
        onIncludeClosedChange={
          showIncludeClosed ? setIncludeClosed : undefined
        }
      />

      {globalError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {globalError}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white">
        {view === "timeline" ? (
          <TimelineView
            projects={visibleProjects}
            onUpdateTargetDate={handleUpdateTargetDate}
            onOpenQuickView={setQuickViewId}
            canEdit={canEdit}
          />
        ) : null}
        {view === "kanban" ? (
          <KanbanView
            projects={visibleProjects}
            savedConfigs={savedConfigs}
            onUpdateField={(id, field, value) =>
              handleUpdateField(id, field, value)
            }
            onSaveConfig={handleSaveConfig}
            onDeleteConfig={handleDeleteConfig}
            onOpenQuickView={setQuickViewId}
            canEdit={canEdit}
            quadrantLabels={quadrantLabels}
          />
        ) : null}
        {view === "bubble" ? (
          <PortfolioView
            projects={visibleProjects}
            onUpdateField={(id, field, value) =>
              handleUpdateField(id, field, value)
            }
            onOpenQuickView={setQuickViewId}
            canEdit={canEdit}
            quadrantLabels={quadrantLabels}
          />
        ) : null}
        {view === "now-next-later" ? (
          <NowNextLaterView
            projects={visibleProjects}
            onUpdateField={(id, field, value) =>
              handleUpdateField(id, field, value)
            }
            onOpenQuickView={setQuickViewId}
            canEdit={canEdit}
          />
        ) : null}
      </div>

      {quickViewProject ? (
        <ProjectQuickView
          project={quickViewProject}
          customFields={customFields}
          canEdit={canEdit}
          // Use the full project list (not the filtered view) so dependency
          // chips can resolve upstream names even when the upstream is
          // hidden by the active filter.
          allProjects={projects}
          onClose={() => setQuickViewId(null)}
          // Edit pops the standard project form modal (same component
          // the Projects page uses). We close the quick view first so
          // the modal isn't competing for focus with the side panel;
          // the modal is the deliberate place to make multi-field
          // changes, the quick view stays read-mostly.
          onEdit={() => {
            setEditingProject(quickViewProject);
            setQuickViewId(null);
          }}
          onStatusChange={(status, summary) =>
            handleStatusChange(
              quickViewProject.project_id,
              status,
              summary,
            ).catch(() => {
              /* error already surfaced via globalError */
            })
          }
          // Phase / priority inline edits use the same generic field
          // patcher; reuse `handleUpdateField` rather than introducing
          // dedicated wrappers since the only thing that varies is the
          // field name.
          onPhaseChange={(phase) =>
            handleUpdateField(
              quickViewProject.project_id,
              "phase",
              phase,
            ).catch(() => {
              /* surfaced via globalError */
            })
          }
          onPriorityChange={(priority) =>
            handleUpdateField(
              quickViewProject.project_id,
              "priority",
              priority,
            ).catch(() => {
              /* surfaced via globalError */
            })
          }
        />
      ) : null}

      {exportOpen ? (
        <ExportModal
          onClose={() => setExportOpen(false)}
          filters={filters}
          // Captures use the same filtered set the on-screen view is
          // showing so the deck reflects what the user is currently
          // looking at, not the full project store.
          projects={visibleProjects}
          savedConfigs={savedConfigs}
          quadrantLabels={quadrantLabels}
          defaultTitle={`Roadmap review — ${new Date().toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}`}
        />
      ) : null}

      {/* Edit project modal. Opened from the quick view's Edit button.
          Same component the Projects page uses — on save it returns
          the updated record which we splice back into local state so
          the roadmap surfaces reflect the change without a page
          reload. */}
      {editingProject ? (
        <ProjectFormModal
          project={editingProject}
          customFields={customFields}
          leadOptions={formLeadOptions}
          applicationOptions={applicationOptions}
          statusOptions={enumOptions?.status}
          phaseOptions={enumOptions?.phase}
          priorityOptions={enumOptions?.priority}
          templates={templates}
          allProjects={projects}
          aiEnabled={aiEnabled}
          onClose={() => setEditingProject(null)}
          onSaved={(updated) => {
            setProjects((prev) =>
              prev.map((p) =>
                p.project_id === updated.project_id ? updated : p,
              ),
            );
            setEditingProject(null);
          }}
        />
      ) : null}
    </div>
  );
}
