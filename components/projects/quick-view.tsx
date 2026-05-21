"use client";

/**
 * Project quick-view side panel (Section 5.1).
 *
 * Slides in from the right when a row is clicked. Shows the project's
 * full record without navigating away from the table — the user can
 * scan a few projects in a row without losing their filter state.
 *
 * Read-only on purpose: editing happens in the modal (`<ProjectFormModal>`).
 * The panel exposes an "Edit" action that closes the panel and opens the
 * form, plus an inline status dropdown that's the same control as in the
 * table row (so the change feels consistent regardless of where it's made).
 *
 * Step 6 layout: a four-tab strip — Details / Decisions / Links /
 * Dependencies — replaces the single-scroll body. The Details tab keeps
 * the original content (status grid, description, stakeholders, AI badge,
 * custom fields). The other three tabs each mount a dedicated component
 * built in Step 6. A dependency-rollup warning banner appears above the
 * tab strip whenever an upstream is blocked or at risk, so it's visible
 * no matter which tab the user is on.
 *
 * The panel is rendered inside the table's React tree (same component
 * file imports it) so it shares filter state and the same project list.
 * No portal is needed — the layered overlay is positioned `fixed`, and
 * the parent's overflow doesn't interfere.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
import { rollupDependencyHealth } from "@/lib/projects/dependencies";
import type { EnumOption } from "@/lib/projects/enum-options";
import type {
  CustomFieldDefinition,
  Priority,
  Project,
  ProjectGroup,
  ProjectId,
  ProjectPhase,
  ProjectStatus,
  StatusHistoryEntry,
} from "@/lib/db";
import { DecisionLogTab } from "./decision-log-tab";
import { DependencyChainPanel } from "./dependency-chain-panel";
import { DocumentLinksEditor } from "./document-links-editor";
import { HealthSparkline } from "./health-sparkline";

interface ProjectQuickViewProps {
  project: Project;
  customFields: CustomFieldDefinition[];
  canEdit: boolean;
  /**
   * Step 6: full project list. Required for the Dependencies tab and the
   * upstream-status warning banner. Pass the same list the table is
   * rendering so chips show the most up-to-date upstream status.
   */
  allProjects: Project[];
  /**
   * Merged option lists (Section 5.19). Optional; fall back to the
   * built-in arrays so the panel still works in isolation. The
   * Projects page passes these from settings so admin-added enum
   * values appear in the inline-edit dropdowns.
   */
  statusOptions?: EnumOption[];
  phaseOptions?: EnumOption[];
  priorityOptions?: EnumOption[];
  /**
   * Every project group this project belongs to. Pre-computed by the
   * parent (ProjectsTable indexes groups by member ID once). Empty
   * array if the project isn't in any group; the panel still renders
   * but with an empty state.
   */
  groupsForProject?: ProjectGroup[];
  /**
   * Called when a chip in the Related panel is clicked. The Projects
   * page wires this to its own setQuickViewId so clicking a related
   * project swaps the quick view without closing it — keeps the
   * cluster-browsing motion fluid.
   */
  onSelectRelatedProject?: (id: ProjectId) => void;
  onClose: () => void;
  onEdit: () => void;
  /**
   * Status change. The optional `summary` parameter is archived to
   * `status_history` alongside the new status. It's only sent from
   * the deliberate "Status" tab editor; the inline status dropdown
   * on the Details tab and the row-level dropdown both omit it (or
   * pass an empty string), and the service treats empty/whitespace
   * as `null` server-side.
   */
  onStatusChange: (status: ProjectStatus, summary?: string) => void;
  onPhaseChange: (phase: ProjectPhase) => void;
  onPriorityChange: (priority: Priority) => void;
}

/**
 * Tab identifiers. `status` is the new tab introduced alongside
 * `Project.status_history`; it shows the full audit trail of status
 * changes plus the "primary" status edit affordance for users who
 * want a more deliberate place to change status than the inline
 * dropdown on Details.
 */
type Tab =
  | "details"
  | "status"
  | "decisions"
  | "links"
  | "dependencies"
  | "groups";

const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "status", label: "Status" },
  { id: "decisions", label: "Decisions" },
  { id: "links", label: "Links" },
  { id: "dependencies", label: "Dependencies" },
  { id: "groups", label: "Groups" },
];

export function ProjectQuickView({
  project,
  customFields,
  canEdit,
  allProjects,
  statusOptions,
  phaseOptions,
  priorityOptions,
  groupsForProject = [],
  onSelectRelatedProject,
  onClose,
  onEdit,
  onStatusChange,
  onPhaseChange,
  onPriorityChange,
}: ProjectQuickViewProps) {
  const [tab, setTab] = useState<Tab>("details");

  // Resolve dropdown sources. Fall back to built-ins when the parent
  // didn't pass merged options. Same pattern as ProjectFormModal.
  const statusList =
    statusOptions ??
    PROJECT_STATUSES.map((s) => ({ id: s, label: s } as EnumOption));
  const phaseList =
    phaseOptions ??
    PROJECT_PHASES.map((p) => ({ id: p, label: p } as EnumOption));
  const priorityList =
    priorityOptions ??
    PRIORITIES.map((p) => ({ id: p, label: p } as EnumOption));

  // Reset to Details when switching projects so the user doesn't end up on
  // an unexpected tab after opening a different row.
  useEffect(() => {
    setTab("details");
  }, [project.project_id]);

  // Esc closes the panel — the close button is the visible affordance,
  // but Esc is the standard expectation for an overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Dependency-rollup banner state — computed once per project / project
  // list change. `null` means "no dependencies on this project" and we
  // suppress the banner entirely; otherwise the banner color reflects the
  // worst-case upstream status (Section 5.10).
  const rollup = useMemo(() => {
    const byId = new Map(allProjects.map((p) => [p.project_id, p]));
    return rollupDependencyHealth(project, byId);
  }, [project, allProjects]);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Project ${project.project_id} details`}
    >
      <div
        className="absolute inset-0 bg-gray-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <header className="flex items-start justify-between border-b border-gray-200 p-6">
          <div>
            <p className="font-mono text-xs font-medium text-gray-500">
              {project.project_id}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
              {project.name}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {project.application_product} · {project.project_type}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-2 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* Cross-tab warning — visible regardless of the active tab so a
            blocked upstream is never hidden behind a tab switch. */}
        {rollup === "blocked" || rollup === "at-risk" ? (
          <div
            role="alert"
            className={`flex items-center gap-2 border-b px-6 py-2 text-xs ${
              rollup === "blocked"
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            <span aria-hidden>{rollup === "blocked" ? "🛑" : "⚠️"}</span>
            <span className="font-medium">
              {rollup === "blocked"
                ? "An upstream dependency is blocked."
                : "An upstream dependency is at risk."}
            </span>
            <button
              type="button"
              onClick={() => setTab("dependencies")}
              className="ml-auto rounded px-2 py-0.5 text-[11px] font-semibold underline-offset-2 hover:underline"
            >
              View →
            </button>
          </div>
        ) : null}

        {/* Tab strip */}
        <nav
          className="flex gap-1 border-b border-gray-200 px-6"
          role="tablist"
          aria-label="Project details"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`quickview-panel-${t.id}`}
                id={`quickview-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
                  active
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {t.label}
                {t.id === "links" && project.document_links.length > 0 ? (
                  <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] text-gray-700">
                    {project.document_links.length}
                  </span>
                ) : null}
                {t.id === "dependencies" && project.dependencies.length > 0 ? (
                  <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] text-gray-700">
                    {project.dependencies.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === "details" ? (
            <div
              role="tabpanel"
              id="quickview-panel-details"
              aria-labelledby="quickview-tab-details"
              className="space-y-6"
            >
              <section className="grid grid-cols-2 gap-4 text-sm">
                <Field label="Status">
                  {canEdit ? (
                    <select
                      value={project.status}
                      onChange={(e) =>
                        onStatusChange(e.target.value as ProjectStatus)
                      }
                      className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${statusBadgeClass(project.status)} focus:outline-none focus:ring-2 focus:ring-gray-900`}
                    >
                      {statusList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusBadgeClass(project.status)}`}
                    >
                      {project.status}
                    </span>
                  )}
                </Field>
                <Field label="Phase">
                  {canEdit ? (
                    <select
                      value={project.phase}
                      onChange={(e) =>
                        onPhaseChange(e.target.value as ProjectPhase)
                      }
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    >
                      {phaseList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                      {/* Preserve the project's current phase as a
                          selectable option even if it's been archived
                          out of the merged list — same defensive
                          pattern as the application_product select. */}
                      {project.phase &&
                      !phaseList.some((p) => p.id === project.phase) ? (
                        <option value={project.phase}>{project.phase}</option>
                      ) : null}
                    </select>
                  ) : (
                    <span className="text-sm text-gray-900">
                      {project.phase}
                    </span>
                  )}
                </Field>
                <Field label="Priority">
                  {canEdit ? (
                    <select
                      value={project.priority}
                      onChange={(e) =>
                        onPriorityChange(e.target.value as Priority)
                      }
                      className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${priorityBadgeClass(project.priority)} focus:outline-none focus:ring-2 focus:ring-gray-900`}
                    >
                      {priorityList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                      {project.priority &&
                      !priorityList.some((p) => p.id === project.priority) ? (
                        <option value={project.priority}>
                          {project.priority}
                        </option>
                      ) : null}
                    </select>
                  ) : (
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(project.priority)}`}
                    >
                      {project.priority}
                    </span>
                  )}
                </Field>
                <Field label="Health">
                  {project.health_score ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${HEALTH_BADGE[project.health_score]}`}
                      title={HEALTH_TOOLTIP[project.health_score]}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health_score]}`}
                      />
                      {project.health_score}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </Field>
                <Field label="Project Lead">
                  <span className="text-sm text-gray-900">
                    {project.project_lead || "—"}
                  </span>
                </Field>
                <Field label="Start Date">
                  <span className="text-sm text-gray-900">
                    {project.roadmap_timeline_start ?? "—"}
                  </span>
                </Field>
                <Field label="Target Date">
                  <span className="text-sm text-gray-900">
                    {project.target_date ?? "—"}
                  </span>
                </Field>
                <Field label="Date Added">
                  <span className="text-sm text-gray-900">
                    {project.date_added}
                  </span>
                </Field>
                <Field label="Updated">
                  <span className="text-sm text-gray-900">
                    {formatRelative(project.updated_at)}
                  </span>
                </Field>
              </section>

              {project.description ? (
                <Section title="Description">
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {project.description}
                  </p>
                </Section>
              ) : null}

              {project.definition_of_done ? (
                <Section title="Definition of done">
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {project.definition_of_done}
                  </p>
                </Section>
              ) : null}

              {/* Step 8 (Section 5.13): 30-day health-score sparkline.
                  Rendered after Description so the most-scanned content
                  is up top, but before stakeholders so it sits visually
                  next to the Health field in the grid above. */}
              {project.health_score_history.length > 0 ||
              project.health_score ? (
                <Section title="Health score history">
                  <HealthSparkline
                    history={project.health_score_history}
                    currentScore={project.health_score}
                  />
                  <p className="mt-2 text-[11px] text-gray-500">
                    One segment per calendar day, capped at the last 30 days.
                  </p>
                </Section>
              ) : null}

              {project.primary_stakeholders.length > 0 ? (
                <Section title="Primary stakeholders">
                  <ChipList items={project.primary_stakeholders} />
                </Section>
              ) : null}

              {project.additional_resources.length > 0 ? (
                <Section title="Additional resources">
                  <ChipList items={project.additional_resources} />
                </Section>
              ) : null}

              {project.ai_complexity_score || project.ai_time_estimate ? (
                <Section title="AI estimate">
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                        AI Suggestion
                      </span>
                    </div>
                    {project.ai_complexity_score ? (
                      <p className="mt-1">
                        Complexity:{" "}
                        <span className="font-medium">
                          {project.ai_complexity_score}
                        </span>
                      </p>
                    ) : null}
                    {project.ai_time_estimate ? (
                      <p>
                        Time estimate:{" "}
                        <span className="font-medium">
                          {project.ai_time_estimate}
                        </span>
                      </p>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {customFields.length > 0 ||
              orphanedCustomFields(project, customFields).length > 0 ? (
                <Section title="Custom fields">
                  {customFields.length > 0 ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {customFields.map((def) => {
                        const v = project.custom_fields[def.key];
                        return (
                          <div key={def.key}>
                            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
                              {def.label}
                            </dt>
                            <dd className="text-sm text-gray-900">
                              {formatCustomFieldValue(v)}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : null}
                  {/* ADM-10: also surface custom-field values whose
                      definition was removed in Admin → Configuration →
                      Custom fields. The values still live on the project
                      record (the schema change doesn't touch saved data);
                      we just labeled them so it's obvious they're orphaned. */}
                  {orphanedCustomFields(project, customFields).length > 0 ? (
                    <div className="mt-3 border-t border-gray-200 pt-3">
                      <p className="mb-2 text-xs italic text-gray-500">
                        Values from custom fields that have since been
                        removed. Re-add the field in Admin → Configuration
                        → Custom fields to make them editable again.
                      </p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        {orphanedCustomFields(project, customFields).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                                {key}{" "}
                                <span className="font-normal italic">
                                  (removed)
                                </span>
                              </dt>
                              <dd className="text-sm text-gray-700">
                                {formatCustomFieldValue(value)}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </div>
                  ) : null}
                </Section>
              ) : null}
            </div>
          ) : null}

          {tab === "status" ? (
            <div
              role="tabpanel"
              id="quickview-panel-status"
              aria-labelledby="quickview-tab-status"
              className="space-y-4"
            >
              <StatusTab
                project={project}
                canEdit={canEdit}
                statusList={statusList}
                /* Wrap the parent callback to: (a) thread the summary
                   through, and (b) return a Promise so the form's
                   "Saving…" affordance has something to await. The
                   parent callback returns void; we just resolve
                   immediately, letting the parent's optimistic UI
                   handle perceived latency. */
                onStatusChange={async (status, summary) => {
                  onStatusChange(status, summary);
                }}
              />
            </div>
          ) : null}

          {tab === "decisions" ? (
            <div
              role="tabpanel"
              id="quickview-panel-decisions"
              aria-labelledby="quickview-tab-decisions"
            >
              <DecisionLogTab
                projectId={project.project_id}
                canEdit={canEdit}
              />
            </div>
          ) : null}

          {tab === "links" ? (
            <div
              role="tabpanel"
              id="quickview-panel-links"
              aria-labelledby="quickview-tab-links"
            >
              {/* Read-only here — disabling the editor keeps the same chip
                  layout the form modal uses, just without remove buttons or
                  the add row. Editing routes through the form modal. */}
              <DocumentLinksEditor
                value={project.document_links}
                onChange={() => {
                  /* read-only */
                }}
                disabled
                title="Document & repository links"
              />
              {canEdit ? (
                <p className="mt-3 text-[11px] text-gray-500">
                  Edit links from the project form (Edit project, then
                  scroll to "Document & repository links").
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "dependencies" ? (
            <div
              role="tabpanel"
              id="quickview-panel-dependencies"
              aria-labelledby="quickview-tab-dependencies"
            >
              <DependencyChainPanel
                project={project}
                allProjects={allProjects}
              />
              <ExternalDependenciesPanel project={project} />
              {canEdit ? (
                <p className="mt-3 text-[11px] text-gray-500">
                  Edit dependencies from the project form (Edit project,
                  then scroll to "Depends on" or "External dependencies").
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "groups" ? (
            <div
              role="tabpanel"
              id="quickview-panel-groups"
              aria-labelledby="quickview-tab-groups"
            >
              <RelatedGroupsPanel
                project={project}
                groups={groupsForProject}
                allProjects={allProjects}
                onSelectRelatedProject={onSelectRelatedProject}
              />
            </div>
          ) : null}
        </div>

        <footer className="border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/tasks?project=${encodeURIComponent(project.project_id)}`}
              className="text-sm font-medium text-gray-700 underline-offset-2 hover:underline"
            >
              View tasks for this project →
            </Link>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Close
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
                >
                  Edit project
                </button>
              ) : null}
            </div>
          </div>
        </footer>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ChipList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function formatCustomFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Custom-field entries on the project record whose definitions have
 * been removed since the value was set (ADM-10). Returns `[key, value]`
 * pairs sorted by key. Empty values are filtered — a removed field
 * with no value is just noise, but a removed field with real data is
 * exactly what the user expected to still see.
 */
function orphanedCustomFields(
  project: { custom_fields: Record<string, unknown> },
  defs: { key: string }[],
): [string, unknown][] {
  const knownKeys = new Set(defs.map((d) => d.key));
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(project.custom_fields ?? {})) {
    if (knownKeys.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    out.push([key, value]);
  }
  out.sort(([a], [b]) => a.localeCompare(b));
  return out;
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return `${diffDay}d ago`;
  // Past a month, show the date — relative time stops being useful.
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Status tab
// ---------------------------------------------------------------------------

/**
 * "Status" tab body: a deliberate status editor at the top (status
 * select + optional summary note + submit button), then the full
 * audit trail of status changes underneath, newest-first.
 *
 * Design decisions worth flagging:
 *
 *   1. We render history newest-first. The service layer pushes new
 *      entries onto the *end* of the array, so we reverse on read here
 *      rather than reversing on write — keeps the on-disk shape
 *      monotonically growing (cheaper to migrate, easier to reason
 *      about) and the reverse is O(n) on a list that won't get long.
 *
 *   2. The editor is form-style (select + textarea + submit) rather
 *      than fire-on-change like the Details tab's inline status
 *      dropdown. Two reasons: (a) the summary is a free-text field
 *      that needs an explicit submit boundary, and (b) the Status tab
 *      is the deliberate "I'm changing this and recording why" flow.
 *      The Details inline dropdown stays as the "quick fix" path.
 *
 *   3. The summary is optional. Empty or whitespace-only values are
 *      stored as `null` server-side (see the service `updateProject`
 *      path). The textarea clears after a successful save.
 */
function StatusTab({
  project,
  canEdit,
  statusList,
  onStatusChange,
}: {
  project: Project;
  canEdit: boolean;
  statusList: EnumOption[];
  onStatusChange: (status: ProjectStatus, summary: string) => Promise<void>;
}) {
  const [pendingStatus, setPendingStatus] = useState<ProjectStatus>(
    project.status,
  );
  const [pendingSummary, setPendingSummary] = useState("");
  const [saving, setSaving] = useState(false);

  // Reverse without mutating the source array — `[...arr].reverse()`
  // is the safe pattern; the bare `.reverse()` would mutate React
  // props and is a footgun in dev mode under StrictMode.
  const historyNewestFirst = useMemo(
    () => [...project.status_history].reverse(),
    [project.status_history],
  );

  // Keep local state in sync with the server when the project prop
  // updates (e.g. after a successful save propagates back). Without
  // this, switching to the Status tab on a project that just had its
  // status changed elsewhere would show stale state.
  useEffect(() => {
    setPendingStatus(project.status);
  }, [project.status]);

  const trimmedSummary = pendingSummary.trim();
  const isStatusChanged = pendingStatus !== project.status;
  const hasSummary = trimmedSummary.length > 0;
  // Submit is allowed when *either*:
  //  - the status is actually changing (with or without a summary), or
  //  - the user typed a summary, even if the status is unchanged.
  // The second case is a deliberate "annotate the current status"
  // flow ("still on track, just slipped a few days for testing"); the
  // service archives an entry with previous_status === status, and
  // the history row labels it "Note added" rather than "X → Y".
  const canSubmit = canEdit && (isStatusChanged || hasSummary) && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onStatusChange(pendingStatus, trimmedSummary);
      // Reset the summary on success — the entry is now archived; a
      // stale draft hanging around would invite the user to "submit"
      // it again and create a no-op.
      setPendingSummary("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Update status
        </p>
        {canEdit ? (
          <form
            onSubmit={handleSubmit}
            className="mt-2 space-y-2"
            aria-label="Update project status"
          >
            <select
              value={pendingStatus}
              onChange={(e) =>
                setPendingStatus(e.target.value as ProjectStatus)
              }
              disabled={saving}
              className={`rounded-md border-0 px-3 py-1.5 text-sm font-medium ${statusBadgeClass(pendingStatus)} focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-50`}
            >
              {statusList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              {/* Defensive: if the project's current status is
                  archived out of the merged list, keep it selectable
                  so we don't accidentally change the persisted value
                  on next save. */}
              {project.status &&
              !statusList.some((s) => s.id === project.status) ? (
                <option value={project.status}>{project.status}</option>
              ) : null}
            </select>
            <div>
              <label
                htmlFor="status-summary"
                className="block text-xs font-medium text-gray-700"
              >
                Summary{" "}
                <span className="font-normal text-gray-500">
                  (optional — archives with this status change)
                </span>
              </label>
              <textarea
                id="status-summary"
                rows={3}
                value={pendingSummary}
                onChange={(e) => setPendingSummary(e.target.value)}
                disabled={saving}
                placeholder="Why is the status changing? Anything the team should know?"
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : isStatusChanged
                    ? "Update status"
                    : "Add note"}
              </button>
              {!isStatusChanged && !hasSummary ? (
                <span className="text-[11px] text-gray-500">
                  Pick a new status or add a summary note to enable.
                </span>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="mt-2">
            <span
              className={`inline-flex rounded-md px-3 py-1 text-sm font-medium ${statusBadgeClass(project.status)}`}
            >
              {project.status}
            </span>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          History
        </h3>
        {historyNewestFirst.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No status changes recorded yet. The first time the status
            changes, an entry will appear here.
          </p>
        ) : (
          <ol className="mt-2 divide-y divide-gray-100 border-y border-gray-100">
            {historyNewestFirst.map((entry, i) => (
              <StatusHistoryRow key={i} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function StatusHistoryRow({ entry }: { entry: StatusHistoryEntry }) {
  // Format the timestamp in a stable, locale-respectful way. We use
  // the user's browser locale via `toLocaleString` for the display
  // and keep the ISO string in `title` so a hover reveals the precise
  // time including seconds — useful when reconciling with logs.
  const when = new Date(entry.changed_at);
  const display = Number.isNaN(when.getTime())
    ? entry.changed_at
    : when.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Three rendering shapes:
                - "X → Y" badge pair when the status flipped
                - Single status badge when there's no previous_status
                  (the very first history entry, or system-written
                  ones where we didn't capture a prior value)
                - "Note added" pill + current status badge when
                  previous_status === status, i.e. a summary-only
                  annotation. */}
          {entry.previous_status &&
          entry.previous_status !== entry.status ? (
            <>
              <span
                className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(entry.previous_status)}`}
              >
                {entry.previous_status}
              </span>
              <span aria-hidden="true" className="text-gray-400">
                →
              </span>
              <span
                className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(entry.status)}`}
              >
                {entry.status}
              </span>
            </>
          ) : entry.previous_status === entry.status ? (
            <>
              <span className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                Note added
              </span>
              <span
                className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(entry.status)}`}
              >
                {entry.status}
              </span>
            </>
          ) : (
            <span
              className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(entry.status)}`}
            >
              {entry.status}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {entry.changed_by_name ? (
            <>
              by{" "}
              <span className="font-medium text-gray-700">
                {entry.changed_by_name}
              </span>
              {" · "}
            </>
          ) : entry.changed_by ? (
            <>
              by{" "}
              <span className="font-mono text-gray-600">
                {entry.changed_by}
              </span>
              {" · "}
            </>
          ) : (
            <>by system · </>
          )}
          <time dateTime={entry.changed_at} title={entry.changed_at}>
            {display}
          </time>
        </div>
        {/* Summary, if archived. Wrap whitespace so multi-line
            summaries render readably; preserve user breaks via
            whitespace-pre-wrap. */}
        {entry.summary ? (
          <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700">
            {entry.summary}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// External dependencies panel
// ---------------------------------------------------------------------------

/**
 * Read-only display of every project group this project belongs to.
 * Group edits happen on the /groups page (per the same "edit happens
 * on its own surface" rule we use for dependencies and external
 * dependencies). Each group shows name, description (when set), and
 * the OTHER members as clickable chips that swap the quick view to
 * that project — supports the common motion of browsing through a
 * cluster of related work without losing context.
 */
function RelatedGroupsPanel({
  project,
  groups,
  allProjects,
  onSelectRelatedProject,
}: {
  project: Project;
  groups: ProjectGroup[];
  allProjects: Project[];
  onSelectRelatedProject?: (id: ProjectId) => void;
}) {
  const projectsById = useMemo(() => {
    const m = new Map<ProjectId, Project>();
    for (const p of allProjects) m.set(p.project_id, p);
    return m;
  }, [allProjects]);

  if (groups.length === 0) {
    return (
      <section>
        <p className="text-sm text-gray-600">
          This project isn&apos;t in any groups yet. Visit{" "}
          <Link
            href="/groups"
            className="text-gray-900 underline-offset-2 hover:underline"
          >
            Groups
          </Link>{" "}
          to create one or add this project to an existing cluster.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {groups.map((g) => {
        const others = g.member_project_ids.filter(
          (id) => id !== project.project_id,
        );
        return (
          <div
            key={g.group_id}
            className="rounded-md border border-gray-200 bg-white p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href="/groups"
                  className="block text-sm font-semibold text-gray-900 underline-offset-2 hover:underline"
                >
                  {g.name}
                </Link>
                {g.description ? (
                  <p className="mt-1 text-xs text-gray-600">{g.description}</p>
                ) : null}
              </div>
              <span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                {g.member_project_ids.length} member
                {g.member_project_ids.length === 1 ? "" : "s"}
              </span>
            </div>

            {others.length === 0 ? (
              <p className="mt-3 text-xs italic text-gray-500">
                No other projects in this group yet.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {others.map((id) => {
                  const other = projectsById.get(id);
                  const label = other ? `${id} — ${other.name}` : id;
                  return onSelectRelatedProject ? (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectRelatedProject(id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                      title={
                        other
                          ? `${other.status} · ${other.health_score ?? "no health"}`
                          : "Project not loaded in this view"
                      }
                    >
                      <span className="font-mono text-[10px] text-gray-500">
                        {id}
                      </span>
                      <span className="max-w-[180px] truncate">
                        {other ? other.name : "(unknown)"}
                      </span>
                    </button>
                  ) : (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-800"
                    >
                      <span className="font-mono text-[10px] text-gray-500">
                        {id}
                      </span>
                      <span className="max-w-[180px] truncate">{label}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Read-only display of the project's external dependencies. Sits
 * under the internal-dependencies chain on the Dependencies tab.
 * Edits happen in the project form modal (per the workspace's
 * "edit happens in the modal" rule, mirroring `DependencyEditor`
 * vs the internal-deps chain panel).
 */
function ExternalDependenciesPanel({ project }: { project: Project }) {
  const items = project.external_dependencies ?? [];

  return (
    <section className="mt-6 border-t border-gray-200 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        External dependencies
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          None recorded. Add one from the project form when this project is
          waiting on something outside Praxis.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((d) => (
            <li
              key={d.external_dependency_id}
              className="rounded-md border border-gray-200 bg-white px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900 break-words">
                      {d.label}
                    </span>
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-700 underline-offset-2 hover:underline"
                      >
                        link ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-gray-600">
                    {d.owner ? <>Owner: {d.owner}</> : <em>No owner</em>}
                    {d.target_date ? (
                      <> · Expected {d.target_date}</>
                    ) : null}
                  </div>
                  {d.description ? (
                    <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">
                      {d.description}
                    </p>
                  ) : null}
                </div>
                <span
                  className={
                    d.status === "Resolved"
                      ? "pol-tag pol-tag-green"
                      : d.status === "In Progress"
                        ? "pol-tag pol-tag-blue"
                        : "pol-tag pol-tag-yellow"
                  }
                >
                  {d.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
