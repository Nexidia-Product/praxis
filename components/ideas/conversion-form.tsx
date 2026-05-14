"use client";

/**
 * Idea → Project conversion form (Section 5.18).
 *
 * Pre-filled project create form: title, description, urgency-mapped
 * priority, and stakeholder list come from the idea. The admin fills in
 * application/product, project lead, and any custom fields, optionally
 * picks a template, and saves.
 *
 * On submit we POST to /api/ideas/[id]/convert which:
 *   - Validates the project payload through the project service.
 *   - Creates the project (firing health-recalc and notifications).
 *   - Marks the idea Converted with a back-link.
 *
 * This is a separate component from `components/projects/form-modal.tsx`
 * deliberately — that modal hardcodes its endpoint to /api/projects, and
 * the conversion-specific UI affordances (read-only "From idea" banner,
 * different submit URL, success-routes-to-new-project) are easier to
 * express in a fresh component than to bolt onto an existing one.
 */

import { useEffect, useMemo, useState } from "react";

import {
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from "@/lib/projects/display";
import type { EnumOption } from "@/lib/projects/enum-options";
import type {
  CustomFieldDefinition,
  Priority,
  Project,
  ProjectIdea,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
  TaskTemplate,
} from "@/lib/db";

/**
 * Sentinel value the Application/Product and Project Lead selects use to
 * swap in a free-text input. The conversion form lets admins enter a
 * brand-new value without an admin-console round-trip — same pattern as
 * the project form modal (see components/projects/form-modal.tsx).
 */
const FREEFORM_SENTINEL = "\u200B__OTHER__\u200B";

interface IdeaConversionFormProps {
  idea: ProjectIdea;
  customFields: CustomFieldDefinition[];
  templates: TaskTemplate[];
  leadOptions: string[];
  applicationOptions: string[];
  /**
   * Merged option lists for the four extensible enums. Optional;
   * fallback to built-ins when not provided. Wired through from the
   * idea-detail page (`app/admin/ideas/[id]/page.tsx`) so admin-added
   * values appear when an idea is converted into a project.
   */
  statusOptions?: EnumOption[];
  phaseOptions?: EnumOption[];
  priorityOptions?: EnumOption[];
  onCancel: () => void;
  onConverted: (result: { project: Project; idea: ProjectIdea }) => void;
}

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
  target_date: string;
  template_id: string;
  custom_fields: Record<string, string | number | boolean | null>;
}

/**
 * Map idea urgency to project priority. Mirrors `urgencyToPriority` in
 * `lib/ideas/service.ts` so the form's initial priority matches what the
 * server would default to if the admin didn't change it.
 */
function urgencyToPriority(idea: ProjectIdea): Priority {
  switch (idea.urgency) {
    case "Critical":
      return "Critical";
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
      return "Low";
  }
}

function defaultCustomFieldValues(
  defs: CustomFieldDefinition[],
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const def of defs) {
    if (def.type === "boolean") out[def.key] = false;
    else out[def.key] = "";
  }
  return out;
}

function initialState(
  idea: ProjectIdea,
  customFields: CustomFieldDefinition[],
): FormState {
  return {
    name: idea.idea_name,
    description: idea.description,
    application_product: "",
    project_type: "New Feature",
    priority: urgencyToPriority(idea),
    status: "Not Started",
    phase: "Qualification",
    primary_stakeholders: idea.key_stakeholders, // free-form, split server-side
    project_lead: "",
    additional_resources: "",
    target_date: idea.requested_target_date ?? "",
    template_id: "",
    custom_fields: defaultCustomFieldValues(customFields),
  };
}

export function IdeaConversionForm({
  idea,
  customFields,
  templates,
  leadOptions,
  applicationOptions,
  statusOptions,
  phaseOptions,
  priorityOptions,
  onCancel,
  onConverted,
}: IdeaConversionFormProps) {
  const [state, setState] = useState<FormState>(() =>
    initialState(idea, customFields),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve dropdown sources. Mirrors the pattern in `ProjectFormModal`:
  // use parent-supplied merged lists when present, else fall back to
  // built-ins. Admin-added values appear without the conversion form
  // needing to know about settings.
  const statusList = statusOptions ?? PROJECT_STATUSES.map((s) => ({
    id: s,
    label: s,
  } as EnumOption));
  const phaseList = phaseOptions ?? PROJECT_PHASES.map((p) => ({
    id: p,
    label: p,
  } as EnumOption));
  const priorityList = priorityOptions ?? PRIORITIES.map((p) => ({
    id: p,
    label: p,
  } as EnumOption));

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function updateCustom(key: string, value: string | number | boolean | null) {
    setState((s) => ({
      ...s,
      custom_fields: { ...s.custom_fields, [key]: value },
    }));
  }

  // Match the form-modal behavior: clear any selected template if the
  // project type changes to one that doesn't have it.
  const matchingTemplates = useMemo(
    () => templates.filter((t) => t.project_type === state.project_type),
    [templates, state.project_type],
  );
  useEffect(() => {
    if (
      state.template_id &&
      !matchingTemplates.some((t) => t.template_id === state.template_id)
    ) {
      setState((s) => ({ ...s, template_id: "" }));
    }
  }, [matchingTemplates, state.template_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);

    const splitList = (v: string) =>
      v
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean);

    const payload = {
      name: state.name.trim(),
      description: state.description,
      // Drop FREEFORM_SENTINEL if it leaks through (user opened the
      // "Other…" select option but submitted before typing anything).
      application_product:
        state.application_product === FREEFORM_SENTINEL
          ? ""
          : state.application_product.trim(),
      project_type: state.project_type,
      priority: state.priority,
      status: state.status,
      phase: state.phase,
      primary_stakeholders: splitList(state.primary_stakeholders),
      project_lead:
        state.project_lead === FREEFORM_SENTINEL
          ? ""
          : state.project_lead.trim(),
      additional_resources: splitList(state.additional_resources),
      target_date: state.target_date || null,
      custom_fields: state.custom_fields,
      // Conversions don't pre-populate dependencies or document links.
      // Both can be added on the project record after conversion if the
      // admin wants them.
      dependencies: [],
      document_links: [],
      ...(state.template_id ? { template_id: state.template_id } : {}),
    };

    const res = await fetch(`/api/ideas/${idea.idea_id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      idea?: ProjectIdea;
      error?: string;
    };
    setSaving(false);

    if (!res.ok || !data.project || !data.idea) {
      setError(data.error ?? "Could not convert this idea.");
      return;
    }

    onConverted({ project: data.project, idea: data.idea });
  }

  return (
    <section className="rounded-lg border-2 border-emerald-300 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Convert to project
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Fields are pre-filled from the idea. Adjust as needed before
            saving — the admin who saves becomes the project creator.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="conv_name"
            className="block text-sm font-medium text-gray-900"
          >
            Project name <span className="text-red-600">*</span>
          </label>
          <input
            id="conv_name"
            type="text"
            required
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          />
        </div>

        <div>
          <label
            htmlFor="conv_description"
            className="block text-sm font-medium text-gray-900"
          >
            Description
          </label>
          <textarea
            id="conv_description"
            rows={5}
            value={state.description}
            onChange={(e) => update("description", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="conv_application"
              className="block text-sm font-medium text-gray-900"
            >
              Application / Product <span className="text-red-600">*</span>
            </label>
            {/* Styled select replacing the native datalist autocomplete
                (IDEA-07) so this matches the rest of the application's UI
                instead of using the browser's built-in dropdown. The
                "Other…" option swaps in a text input for new values that
                admins haven't curated yet. */}
            {state.application_product === FREEFORM_SENTINEL ||
            (state.application_product &&
              !applicationOptions.includes(state.application_product)) ? (
              <input
                id="conv_application"
                type="text"
                required
                value={
                  state.application_product === FREEFORM_SENTINEL
                    ? ""
                    : state.application_product
                }
                onChange={(e) => update("application_product", e.target.value)}
                onBlur={(e) => {
                  if (
                    state.application_product === FREEFORM_SENTINEL &&
                    !e.target.value.trim()
                  ) {
                    update("application_product", "");
                  }
                }}
                disabled={saving}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
                placeholder="Type a new application / product"
                autoFocus={state.application_product === FREEFORM_SENTINEL}
              />
            ) : (
              <select
                id="conv_application"
                required
                value={state.application_product}
                onChange={(e) => update("application_product", e.target.value)}
                disabled={saving}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
              >
                <option value="">— Select —</option>
                {applicationOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                <option value={FREEFORM_SENTINEL}>
                  Other (type a new value)…
                </option>
              </select>
            )}
          </div>

          <div>
            <label
              htmlFor="conv_lead"
              className="block text-sm font-medium text-gray-900"
            >
              Project lead
            </label>
            {state.project_lead === FREEFORM_SENTINEL ||
            (state.project_lead && !leadOptions.includes(state.project_lead)) ? (
              <input
                id="conv_lead"
                type="text"
                value={
                  state.project_lead === FREEFORM_SENTINEL
                    ? ""
                    : state.project_lead
                }
                onChange={(e) => update("project_lead", e.target.value)}
                onBlur={(e) => {
                  if (
                    state.project_lead === FREEFORM_SENTINEL &&
                    !e.target.value.trim()
                  ) {
                    update("project_lead", "");
                  }
                }}
                disabled={saving}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
                placeholder="Type a new lead name"
                autoFocus={state.project_lead === FREEFORM_SENTINEL}
              />
            ) : (
              <select
                id="conv_lead"
                value={state.project_lead}
                onChange={(e) => update("project_lead", e.target.value)}
                disabled={saving}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
              >
                <option value="">— Select —</option>
                {leadOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                <option value={FREEFORM_SENTINEL}>Other (type a name)…</option>
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label
              htmlFor="conv_type"
              className="block text-sm font-medium text-gray-900"
            >
              Type
            </label>
            <select
              id="conv_type"
              value={state.project_type}
              onChange={(e) =>
                update("project_type", e.target.value as ProjectType)
              }
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="conv_priority"
              className="block text-sm font-medium text-gray-900"
            >
              Priority
            </label>
            <select
              id="conv_priority"
              value={state.priority}
              onChange={(e) =>
                update("priority", e.target.value as Priority)
              }
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              {priorityList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="conv_status"
              className="block text-sm font-medium text-gray-900"
            >
              Status
            </label>
            <select
              id="conv_status"
              value={state.status}
              onChange={(e) =>
                update("status", e.target.value as ProjectStatus)
              }
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              {statusList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="conv_phase"
              className="block text-sm font-medium text-gray-900"
            >
              Phase
            </label>
            <select
              id="conv_phase"
              value={state.phase}
              onChange={(e) =>
                update("phase", e.target.value as ProjectPhase)
              }
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              {phaseList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="conv_target_date"
              className="block text-sm font-medium text-gray-900"
            >
              Target date
            </label>
            <input
              id="conv_target_date"
              type="date"
              value={state.target_date}
              onChange={(e) => update("target_date", e.target.value)}
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            />
            {idea.requested_target_date ? (
              <p className="mt-1 text-xs text-gray-500">
                Requested by submitter: {idea.requested_target_date}
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="conv_template"
              className="block text-sm font-medium text-gray-900"
            >
              Apply template
            </label>
            <select
              id="conv_template"
              value={state.template_id}
              onChange={(e) => update("template_id", e.target.value)}
              disabled={saving || matchingTemplates.length === 0}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              <option value="">— No template —</option>
              {matchingTemplates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.template_name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {matchingTemplates.length === 0
                ? "No templates configured for this project type."
                : "Auto-creates the template's tasks on the new project."}
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="conv_stakeholders"
            className="block text-sm font-medium text-gray-900"
          >
            Primary stakeholders
          </label>
          <input
            id="conv_stakeholders"
            type="text"
            value={state.primary_stakeholders}
            onChange={(e) => update("primary_stakeholders", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            placeholder="Comma-separated"
          />
        </div>

        <div>
          <label
            htmlFor="conv_resources"
            className="block text-sm font-medium text-gray-900"
          >
            Additional resources
          </label>
          <input
            id="conv_resources"
            type="text"
            value={state.additional_resources}
            onChange={(e) => update("additional_resources", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            placeholder="Comma-separated"
          />
        </div>

        {customFields.length > 0 ? (
          <fieldset className="space-y-3 rounded-md border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wider text-gray-500">
              Custom fields
            </legend>
            {customFields.map((def) => (
              <CustomFieldRow
                key={def.key}
                def={def}
                value={state.custom_fields[def.key]}
                onChange={(v) => updateCustom(def.key, v)}
                disabled={saving}
              />
            ))}
          </fieldset>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              !state.name.trim() ||
              !state.application_product.trim()
            }
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {saving ? "Converting…" : "Create project & mark Converted"}
          </button>
        </div>
      </form>
    </section>
  );
}

interface CustomFieldRowProps {
  def: CustomFieldDefinition;
  value: string | number | boolean | null;
  onChange: (next: string | number | boolean | null) => void;
  disabled?: boolean;
}

function CustomFieldRow({ def, value, onChange, disabled }: CustomFieldRowProps) {
  const id = `conv_cf_${def.key}`;
  const label = (
    <label htmlFor={id} className="block text-sm font-medium text-gray-900">
      {def.label}
      {def.required ? <span className="text-red-600"> *</span> : null}
    </label>
  );

  if (def.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-gray-300"
        />
        <label htmlFor={id} className="text-sm text-gray-900">
          {def.label}
        </label>
      </div>
    );
  }

  if (def.type === "select") {
    return (
      <div>
        {label}
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={def.required}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
        >
          <option value="">— Select —</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const inputType = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
  return (
    <div>
      {label}
      <input
        id={id}
        type={inputType}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) =>
          onChange(
            def.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value,
          )
        }
        disabled={disabled}
        required={def.required}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
      />
    </div>
  );
}
