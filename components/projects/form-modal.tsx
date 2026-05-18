"use client";

/**
 * Project create / edit modal.
 *
 * The same form is reused for both flows; the difference is just whether
 * `project` is passed in. Submit always sends a complete payload (POST
 * /api/projects on create, PATCH /api/projects/[id] on edit) so the
 * service layer in `lib/projects/service.ts` is the single validator.
 *
 * Custom fields rendered after the standard fields come from the org's
 * `settings.custom_field_definitions` (Section 5.19). Their values are
 * stored under `project.custom_fields` keyed by `def.key`.
 *
 * AI suggestion (Section 5.16): on edit we surface whatever AI fields
 * are already on the record as a small banner, advisory only. The
 * actual API call is wired in Step 6/10 — the badge layout is here
 * today so swapping the data source on later requires no UI changes.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from "@/lib/projects/display";
import type { EnumOption } from "@/lib/projects/enum-options";
import type {
  ComplexityScore,
  CustomFieldDefinition,
  DocumentLink,
  ExternalDependency,
  Priority,
  Project,
  ProjectDependency,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
  TaskTemplate,
} from "@/lib/db";
import { DependencyEditor } from "./dependency-editor";
import { DocumentLinksEditor } from "./document-links-editor";
import { ExternalDependenciesEditor } from "./external-dependencies-editor";

interface ProjectFormModalProps {
  /** When set, the modal is in edit mode against this project. */
  project: Project | null;
  customFields: CustomFieldDefinition[];
  /** Distinct project_lead values from the dataset, for autocomplete. */
  leadOptions: string[];
  /** Distinct application_product values from the dataset, for autocomplete. */
  applicationOptions: string[];
  /**
   * Merged option lists from `lib/projects/enum-options` (built-ins +
   * admin extensions, archived excluded). Optional for backwards
   * compatibility — when omitted, the form falls back to the static
   * arrays imported from `lib/projects/display.ts`, which only contain
   * the built-ins. The Projects page passes these from settings; tests
   * and one-off callers can leave them out.
   */
  statusOptions?: EnumOption[];
  phaseOptions?: EnumOption[];
  priorityOptions?: EnumOption[];
  /** Available task templates — used to offer auto-apply on create. */
  templates?: TaskTemplate[];
  /**
   * Step 6 (Section 5.10): full project list, used to populate the
   * "Depends on" picker and resolve upstream names + statuses for chips.
   */
  allProjects: Project[];
  onClose: () => void;
  /** Called with the API-returned record after a successful save. */
  onSaved: (project: Project) => void;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/**
 * Sentinel value the Project Lead select uses to swap in a free-text
 * input. Picked so it can never collide with a real lead name (zero-width
 * separators around a marker word). See the project_lead field in the
 * render block.
 */
const LEAD_OTHER_SENTINEL = "\u200B__OTHER__\u200B";

type CustomFieldValueMap = Record<string, string | number | boolean | null>;

interface FormState {
  name: string;
  description: string;
  application_product: string;
  project_type: ProjectType;
  priority: Priority;
  status: ProjectStatus;
  phase: ProjectPhase;
  primary_stakeholders: string;
  project_lead: string;
  additional_resources: string;
  /**
   * Per-resource allocation percent. Held as strings during edit so
   * a half-typed value doesn't crash the form; coerced to numbers
   * on save. Keys are the same names / user_ids that appear in
   * `additional_resources` and `project_lead`. Missing keys mean
   * "use the org-wide default".
   */
  resource_allocations: Record<string, string>;
  /**
   * Planned start date (ISO YYYY-MM-DD or empty). Optional. Backed by
   * `roadmap_timeline_start` in the data model. Used by the Now/Next/
   * Later view, Timeline, Resources, and Velocity surfaces. The system
   * auto-sets this field server-side when the project transitions out
   * of "Not Started" — see `lib/projects/service.ts`. Users can also
   * set it explicitly here.
   */
  start_date: string;
  target_date: string;
  /** Empty string = no template auto-apply. Only meaningful on create. */
  template_id: string;
  custom_fields: CustomFieldValueMap;
  /** Step 6 (Section 5.10). */
  dependencies: ProjectDependency[];
  /** Step 6 (Section 5.14). */
  document_links: DocumentLink[];
  /** External (non-Praxis) blockers — Jira on other teams, vendor work, etc. */
  external_dependencies: ExternalDependency[];
  /**
   * AI-generated complexity tier and time estimate. Held in form state
   * so the "Generate estimate" button can populate them inline and the
   * Save call persists them along with the description. Null means
   * "no estimate" — both for new projects and when the user explicitly
   * clears the field.
   */
  ai_complexity_score: ComplexityScore | null;
  ai_time_estimate: string | null;
}

function emptyState(customFields: CustomFieldDefinition[]): FormState {
  return {
    name: "",
    description: "",
    application_product: "",
    project_type: "New Feature",
    priority: "Medium",
    status: "Not Started",
    phase: "Qualification",
    primary_stakeholders: "",
    project_lead: "",
    additional_resources: "",
    resource_allocations: {},
    start_date: "",
    target_date: "",
    template_id: "",
    custom_fields: defaultCustomFieldValues(customFields),
    dependencies: [],
    document_links: [],
    external_dependencies: [],
    ai_complexity_score: null,
    ai_time_estimate: null,
  };
}

function defaultCustomFieldValues(
  defs: CustomFieldDefinition[],
): CustomFieldValueMap {
  const out: CustomFieldValueMap = {};
  for (const def of defs) {
    if (def.type === "boolean") out[def.key] = false;
    else out[def.key] = "";
  }
  return out;
}

/**
 * Convert the persisted `Record<string, number>` into the
 * `Record<string, string>` the form holds during edit. Strings
 * keep half-typed values from clobbering each keystroke.
 */
function stringifyAllocations(
  raw: Record<string, number> | undefined,
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * Convert the form's string map back to numbers for the payload.
 * Empty / unparseable values are dropped — the server treats absent
 * keys as "fall back to default", which is exactly the behavior we
 * want when an admin clears a field.
 */
function numberifyAllocations(
  raw: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const trimmed = (v ?? "").trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) continue;
    out[k] = n;
  }
  return out;
}

function fromProject(p: Project, defs: CustomFieldDefinition[]): FormState {
  return {
    name: p.name,
    description: p.description,
    application_product: p.application_product,
    project_type: p.project_type,
    priority: p.priority,
    status: p.status,
    phase: p.phase,
    primary_stakeholders: p.primary_stakeholders.join(", "),
    project_lead: p.project_lead,
    additional_resources: p.additional_resources.join(", "),
    resource_allocations: stringifyAllocations(p.resource_allocations),
    start_date: p.roadmap_timeline_start ?? "",
    target_date: p.target_date ?? "",
    // Templates are a create-only concept; on edit this stays empty and
    // is omitted from the patch payload.
    template_id: "",
    custom_fields: {
      ...defaultCustomFieldValues(defs),
      ...p.custom_fields,
    },
    dependencies: p.dependencies,
    document_links: p.document_links,
    external_dependencies: p.external_dependencies ?? [],
    ai_complexity_score: p.ai_complexity_score ?? null,
    ai_time_estimate: p.ai_time_estimate ?? null,
  };
}

function toPayload(s: FormState, includeTemplate: boolean) {
  const splitList = (v: string) =>
    v
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  const base = {
    name: s.name.trim(),
    description: s.description,
    application_product: s.application_product.trim(),
    project_type: s.project_type,
    priority: s.priority,
    status: s.status,
    phase: s.phase,
    primary_stakeholders: splitList(s.primary_stakeholders),
    // Drop the LEAD_OTHER_SENTINEL if it leaks through (the user opened
    // "Other…" but hit save before typing a name); it should never reach
    // the server.
    project_lead:
      s.project_lead === LEAD_OTHER_SENTINEL ? "" : s.project_lead.trim(),
    additional_resources: splitList(s.additional_resources),
    resource_allocations: numberifyAllocations(s.resource_allocations),
    roadmap_timeline_start: s.start_date || null,
    target_date: s.target_date || null,
    custom_fields: s.custom_fields,
    // Always send these — the server diffs against the current record by
    // URL on document_links to preserve provenance, and rebuilds depends_on
    // from dependencies. Sending them on every save keeps client and
    // server views in sync.
    dependencies: s.dependencies,
    document_links: s.document_links,
    external_dependencies: s.external_dependencies,
    // AI fields: only send when the user has set a value. The service
    // accepts null to clear; omitting them on save leaves whatever's
    // persisted alone, which is what we want for forms that don't
    // touch the AI suggestion.
    ai_complexity_score: s.ai_complexity_score,
    ai_time_estimate: s.ai_time_estimate,
  };
  // Only attach template_id on create, and only when the user picked one.
  // On edit it would be ignored by the service layer anyway, but stripping
  // it here keeps the request body honest.
  if (includeTemplate && s.template_id) {
    return { ...base, template_id: s.template_id };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/**
 * Make sure a dropdown's current value is present in the option list.
 *
 * If the project has, say, an archived status — or the dropdown options
 * just haven't been populated by the parent yet — the underlying
 * `<select>` would otherwise drop the value silently and present the
 * first option as if it were chosen. We append the current value as a
 * synthetic option so the user keeps it on screen and can change it
 * deliberately.
 *
 * Cheap to call per render; the option list is small.
 */
function ensureCurrent(
  options: EnumOption[],
  currentValue: string,
): EnumOption[] {
  if (!currentValue) return options;
  if (options.some((o) => o.id === currentValue)) return options;
  return [
    ...options,
    {
      id: currentValue,
      label: `${currentValue} (archived)`,
      source: "extension" as const,
      archived: true,
    },
  ];
}

export function ProjectFormModal({
  project,
  customFields,
  leadOptions,
  applicationOptions,
  statusOptions,
  phaseOptions,
  priorityOptions,
  templates,
  allProjects,
  onClose,
  onSaved,
}: ProjectFormModalProps) {
  const isEdit = project !== null;
  const [state, setState] = useState<FormState>(() =>
    project ? fromProject(project, customFields) : emptyState(customFields),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * AI estimate state. Tracks the in-flight request and the most
   * recent rationale (which we don't persist — it's transient
   * advisory copy shown under the AI Suggestion banner). The
   * complexity tier and time estimate themselves live in
   * FormState so Save persists them.
   */
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRationale, setAiRationale] = useState<string | null>(null);

  // Resolve dropdown sources. When the parent passes merged option
  // lists (the normal case from `app/projects/page.tsx`) we use them so
  // admin extensions show up. When omitted we fall back to the static
  // built-ins so test harnesses and one-off callers work without
  // wiring through settings.
  //
  // The current value is always added back in if it's not already in
  // the list — this handles archived values gracefully (a project on
  // an archived status still shows that status as the selected option,
  // which the user can change but won't lose by accident).
  const statusList = ensureCurrent(
    statusOptions ??
      PROJECT_STATUSES.map((s) => ({ id: s, label: s }) as EnumOption),
    state.status,
  );
  const phaseList = ensureCurrent(
    phaseOptions ??
      PROJECT_PHASES.map((p) => ({ id: p, label: p }) as EnumOption),
    state.phase,
  );
  const priorityList = ensureCurrent(
    priorityOptions ??
      PRIORITIES.map((p) => ({ id: p, label: p }) as EnumOption),
    state.priority,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  async function generateAiEstimate() {
    if (aiBusy) return;
    setAiError(null);
    setAiRationale(null);
    if (state.description.trim().length < 20) {
      setAiError("Add a longer description (20+ characters) before estimating.");
      return;
    }
    setAiBusy(true);
    try {
      const resp = await fetch("/api/ai/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: state.description,
          projectType: state.project_type,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        complexity?: ComplexityScore;
        time_estimate?: string;
        rationale?: string;
        error?: string;
      };
      if (!resp.ok || !data.complexity) {
        throw new Error(data.error ?? `Estimate failed (HTTP ${resp.status})`);
      }
      setState((prev) => ({
        ...prev,
        ai_complexity_score: data.complexity ?? null,
        ai_time_estimate: data.time_estimate ?? null,
      }));
      setAiRationale(data.rationale ?? null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Estimate failed.");
    } finally {
      setAiBusy(false);
    }
  }

  function updateCustom(key: string, value: string | number | boolean | null) {
    setState((prev) => ({
      ...prev,
      custom_fields: { ...prev.custom_fields, [key]: value },
    }));
  }

  // Templates available for the currently-selected project type. If the
  // user changes the type after selecting a template, the previously-chosen
  // template might no longer match — clear the selection in that case so
  // we never submit a template_id from a different type.
  const matchingTemplates = (templates ?? []).filter(
    (t) => t.project_type === state.project_type,
  );
  useEffect(() => {
    if (
      state.template_id &&
      !matchingTemplates.some((t) => t.template_id === state.template_id)
    ) {
      setState((prev) => ({ ...prev, template_id: "" }));
    }
  }, [state.project_type, matchingTemplates, state.template_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);

    const payload = toPayload(state, !isEdit);
    const url = isEdit ? `/api/projects/${project!.project_id}` : "/api/projects";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    setSaving(false);

    if (!res.ok || !data.project) {
      setError(data.error ?? "Could not save project.");
      return;
    }

    onSaved(data.project);
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-form-title"
      style={{ background: "rgba(46, 46, 46, 0.4)" }}
    >
      <div
        className="absolute inset-0"
        onClick={() => !saving && onClose()}
        aria-hidden="true"
      />
      <form
        onSubmit={handleSubmit}
        className="relative my-auto w-full max-w-2xl"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--pol-radius)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            padding: "12px 16px",
          }}
        >
          <div>
            {isEdit ? (
              <p className="mono" style={{ color: "var(--tm)" }}>
                {project!.project_id}
              </p>
            ) : null}
            <h2
              id="project-form-title"
              style={{
                marginTop: 2,
                fontSize: "var(--fs-base)",
                fontWeight: 700,
                color: "var(--t1)",
              }}
            >
              {isEdit ? "Edit project" : "New project"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="pol-modal-close"
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

        <div className="space-y-5 px-6 py-5">
          {error ? (
            <div role="alert" className="pol-notice pol-notice-err">
              <span aria-hidden="true">!</span>
              <span>{error}</span>
            </div>
          ) : null}

          {state.ai_complexity_score || state.ai_time_estimate ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                AI Suggestion
              </p>
              <p className="mt-1">
                {state.ai_complexity_score
                  ? `Complexity: ${state.ai_complexity_score}`
                  : null}
                {state.ai_complexity_score && state.ai_time_estimate ? " · " : null}
                {state.ai_time_estimate
                  ? `Time estimate: ${state.ai_time_estimate}`
                  : null}
              </p>
              {aiRationale ? (
                <p className="mt-2 text-xs text-sky-800">{aiRationale}</p>
              ) : null}
            </div>
          ) : null}

          <Field id="proj-name" label="Name" required>
            <input
              id="proj-name"
              type="text"
              required
              value={state.name}
              onChange={(e) => update("name", e.target.value)}
              disabled={saving}
              className={baseInput}
            />
          </Field>

          <Field id="proj-desc" label="Description">
            <textarea
              id="proj-desc"
              value={state.description}
              onChange={(e) => update("description", e.target.value)}
              rows={4}
              disabled={saving}
              className={baseInput}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">
                Used by the AI Advisor to estimate complexity and time.
              </p>
              <button
                type="button"
                onClick={generateAiEstimate}
                disabled={aiBusy || saving}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBusy
                  ? "Generating…"
                  : state.ai_complexity_score
                    ? "Regenerate AI estimate"
                    : "Generate AI estimate"}
              </button>
            </div>
            {aiError ? (
              <p className="mt-1 text-xs text-red-600">{aiError}</p>
            ) : null}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="proj-app" label="Application/Product" required>
              <select
                id="proj-app"
                required
                value={state.application_product}
                onChange={(e) => update("application_product", e.target.value)}
                disabled={saving}
                className={baseInput}
              >
                {/* Required field, so render an empty placeholder option
                    rather than defaulting silently. The form validates
                    on submit (`!state.application_product` blocks save). */}
                <option value="">— Select —</option>
                {applicationOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                {/* If the project being edited has an application_product
                    that no longer appears in the option list (admin
                    archived the value, or imported data uses a string
                    not yet curated), preserve it as a selectable option
                    so the user doesn't accidentally lose the value
                    when reopening the form. */}
                {state.application_product &&
                !applicationOptions.includes(state.application_product) ? (
                  <option value={state.application_product}>
                    {state.application_product}
                  </option>
                ) : null}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Curated by an admin in <span className="font-mono">Project values</span>.
                Values seen in existing projects also appear here.
              </p>
            </Field>

            <Field id="proj-type" label="Type" required>
              <select
                id="proj-type"
                value={state.project_type}
                onChange={(e) =>
                  update("project_type", e.target.value as ProjectType)
                }
                disabled={saving}
                className={baseInput}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="proj-priority" label="Priority" required>
              <select
                id="proj-priority"
                value={state.priority}
                onChange={(e) => update("priority", e.target.value as Priority)}
                disabled={saving}
                className={baseInput}
              >
                {priorityList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="proj-status" label="Status" required>
              <select
                id="proj-status"
                value={state.status}
                onChange={(e) =>
                  update("status", e.target.value as ProjectStatus)
                }
                disabled={saving}
                className={baseInput}
              >
                {statusList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="proj-phase" label="Phase" required>
              <select
                id="proj-phase"
                value={state.phase}
                onChange={(e) =>
                  update("phase", e.target.value as ProjectPhase)
                }
                disabled={saving}
                className={baseInput}
              >
                {phaseList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="proj-start" label="Start date">
              <input
                id="proj-start"
                type="date"
                value={state.start_date}
                onChange={(e) => update("start_date", e.target.value)}
                disabled={saving}
                className={baseInput}
                // Block dates after the target date to give early
                // feedback. Server still re-validates regardless.
                max={state.target_date || undefined}
              />
            </Field>

            <Field id="proj-target" label="Target date">
              <input
                id="proj-target"
                type="date"
                value={state.target_date}
                onChange={(e) => update("target_date", e.target.value)}
                disabled={saving}
                className={baseInput}
                // Block dates before the start date for the same
                // reason as the start input above.
                min={state.start_date || undefined}
              />
            </Field>
          </div>

          <Field id="proj-lead" label="Project lead">
            {/* Styled select matching the Application/Product field above.
                The native datalist autocomplete this replaced rendered as
                Edge's built-in dropdown, which clashed with the rest of
                the application's UI (PROJ-11). We expose every distinct
                lead seen in the dataset, plus an "Other…" escape hatch
                so a brand-new name can still be entered without an admin
                round-trip. */}
            {state.project_lead === LEAD_OTHER_SENTINEL ||
            (state.project_lead && !leadOptions.includes(state.project_lead)) ? (
              <input
                id="proj-lead"
                type="text"
                value={
                  state.project_lead === LEAD_OTHER_SENTINEL
                    ? ""
                    : state.project_lead
                }
                onChange={(e) => update("project_lead", e.target.value)}
                onBlur={(e) => {
                  // If the user blurs out without typing anything after
                  // selecting "Other…", revert to the empty placeholder
                  // so the select is shown again on the next open.
                  if (
                    state.project_lead === LEAD_OTHER_SENTINEL &&
                    !e.target.value.trim()
                  ) {
                    update("project_lead", "");
                  }
                }}
                disabled={saving}
                className={baseInput}
                placeholder="Type a new lead name"
                autoFocus={state.project_lead === LEAD_OTHER_SENTINEL}
              />
            ) : (
              <select
                id="proj-lead"
                value={state.project_lead}
                onChange={(e) => update("project_lead", e.target.value)}
                disabled={saving}
                className={baseInput}
              >
                <option value="">— Select —</option>
                {leadOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                <option value={LEAD_OTHER_SENTINEL}>Other (type a name)…</option>
              </select>
            )}
          </Field>

          <Field id="proj-stakeholders" label="Primary stakeholders">
            <input
              id="proj-stakeholders"
              type="text"
              value={state.primary_stakeholders}
              onChange={(e) => update("primary_stakeholders", e.target.value)}
              disabled={saving}
              className={baseInput}
              placeholder="Comma-separated names"
            />
          </Field>

          <Field id="proj-resources" label="Additional resources">
            <input
              id="proj-resources"
              type="text"
              value={state.additional_resources}
              onChange={(e) => update("additional_resources", e.target.value)}
              disabled={saving}
              className={baseInput}
              placeholder="Comma-separated names"
            />
          </Field>

          <AllocationsEditor
            project_lead={state.project_lead}
            additional_resources={state.additional_resources}
            allocations={state.resource_allocations}
            disabled={saving}
            onChange={(next) => update("resource_allocations", next)}
          />

          {!isEdit ? (
            <Field id="proj-template" label="Apply task template">
              {matchingTemplates.length > 0 ? (
                <>
                  <select
                    id="proj-template"
                    value={state.template_id}
                    onChange={(e) => update("template_id", e.target.value)}
                    disabled={saving}
                    className={baseInput}
                  >
                    <option value="">— None —</option>
                    {matchingTemplates.map((t) => (
                      <option key={t.template_id} value={t.template_id}>
                        {t.template_name} ({t.tasks.length} task
                        {t.tasks.length === 1 ? "" : "s"})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Templates create a starter set of tasks for this project.
                    Tasks are assigned to the project lead and can be edited
                    afterward.
                  </p>
                </>
              ) : (
                /* Empty-state: explain why the picker is empty rather
                    than silently hiding it, so the user understands
                    they could create a matching template if desired.
                    Linking out keeps it actionable. */
                <div
                  className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600"
                  id="proj-template"
                >
                  No task templates exist for project type{" "}
                  <span className="font-medium text-gray-900">
                    {state.project_type}
                  </span>
                  .{" "}
                  <Link
                    href="/admin/templates"
                    className="font-medium text-gray-900 underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noopener"
                  >
                    Manage templates
                  </Link>
                  .
                </div>
              )}
            </Field>
          ) : null}

          <DependencyEditor
            selfId={project?.project_id ?? null}
            value={state.dependencies}
            onChange={(deps) => update("dependencies", deps)}
            allProjects={allProjects}
            disabled={saving}
          />

          <DocumentLinksEditor
            value={state.document_links}
            onChange={(links) => update("document_links", links)}
            disabled={saving}
          />

          <ExternalDependenciesEditor
            value={state.external_dependencies}
            onChange={(deps) => update("external_dependencies", deps)}
            disabled={saving}
          />

          {customFields.length > 0 ? (
            <div className="space-y-4 rounded-md border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Custom fields
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {customFields.map((def) => (
                  <CustomFieldInput
                    key={def.key}
                    def={def}
                    value={state.custom_fields[def.key]}
                    disabled={saving}
                    onChange={(v) => updateCustom(def.key, v)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            padding: "12px 16px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="pol-btn pol-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !state.name || !state.application_product}
            className="pol-btn pol-btn-primary"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create project"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const baseInput =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100";

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium uppercase tracking-wider text-gray-700"
      >
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Per-resource allocation editor.
 *
 * Derives the resource list from the project_lead + additional_resources
 * fields the user has already filled in, so it stays in sync as those
 * values change. One row per resource with a numeric input for percent
 * of time committed to this project.
 *
 * Empty input means "use the org-wide default" — we don't force a
 * value. The placeholder shows the default so admins know what's
 * implicit.
 *
 * The editor is collapsed when there are no resources at all (so a
 * brand-new project doesn't show an empty section). It's still
 * present in the DOM so screen readers can find it once the user
 * starts adding people.
 */
function AllocationsEditor({
  project_lead,
  additional_resources,
  allocations,
  disabled,
  onChange,
}: {
  project_lead: string;
  additional_resources: string;
  allocations: Record<string, string>;
  disabled: boolean;
  onChange: (next: Record<string, string>) => void;
}) {
  // Derive the resource list from the form's other fields. Dedup
  // by trimmed string so "alice" and " alice " collapse, and so the
  // lead doesn't double-up if also listed under additional resources.
  const resources: string[] = [];
  const seen = new Set<string>();
  function add(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (seen.has(t)) return;
    seen.add(t);
    resources.push(t);
  }
  add(project_lead);
  for (const part of additional_resources.split(/[,\n]/)) {
    add(part);
  }

  if (resources.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Add a project lead or additional resources above to set per-person
        allocations. Each field defaults to the org-wide allocation
        percent (Admin → Resource management → Resource thresholds).
      </div>
    );
  }

  function setOne(name: string, value: string) {
    const next = { ...allocations };
    if (value.trim() === "") {
      delete next[name];
    } else {
      next[name] = value;
    }
    onChange(next);
  }

  return (
    <div>
      <div className="block text-xs font-medium uppercase tracking-wider text-gray-700">
        Allocations
        <span className="ml-2 font-normal normal-case text-gray-400">
          % of time committed to this project (leave blank for default)
        </span>
      </div>
      <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {resources.map((r) => (
          <div
            key={r}
            className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1"
          >
            <span
              className="flex-1 truncate text-sm text-gray-700"
              title={r}
            >
              {r}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={5}
              value={allocations[r] ?? ""}
              onChange={(e) => setOne(r, e.target.value)}
              disabled={disabled}
              placeholder="default"
              className="w-16 rounded border border-gray-200 px-1 py-0.5 text-right text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
              aria-label={`Allocation percent for ${r}`}
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface CustomFieldInputProps {
  def: CustomFieldDefinition;
  value: string | number | boolean | null | undefined;
  disabled: boolean;
  onChange: (next: string | number | boolean | null) => void;
}

function CustomFieldInput({
  def,
  value,
  disabled,
  onChange,
}: CustomFieldInputProps) {
  const id = `cf-${def.key}`;

  if (def.type === "boolean") {
    return (
      <Field id={id} label={def.label} required={def.required}>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
          />
          <span className="text-gray-700">Yes</span>
        </label>
      </Field>
    );
  }
  if (def.type === "select") {
    return (
      <Field id={id} label={def.label} required={def.required}>
        <select
          id={id}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          required={def.required}
          className={baseInput}
        >
          <option value="">—</option>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (def.type === "number") {
    return (
      <Field id={id} label={def.label} required={def.required}>
        <input
          id={id}
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          disabled={disabled}
          required={def.required}
          className={baseInput}
        />
      </Field>
    );
  }
  if (def.type === "date") {
    return (
      <Field id={id} label={def.label} required={def.required}>
        <input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          required={def.required}
          className={baseInput}
        />
      </Field>
    );
  }
  // text (default)
  return (
    <Field id={id} label={def.label} required={def.required}>
      <input
        id={id}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={def.required}
        className={baseInput}
      />
    </Field>
  );
}
