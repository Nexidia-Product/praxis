"use client";

/**
 * Admin Task Templates editor (Section 5.19).
 *
 * Two-pane layout:
 *   - Left: list of existing templates, grouped under their project type.
 *   - Right: editor for the currently selected template (or a fresh draft).
 *
 * Save semantics:
 *   - New templates → POST /api/templates.
 *   - Existing templates → PUT /api/templates/[id] (full replace).
 *
 * Reordering tasks within a template uses up/down buttons rather than
 * drag-and-drop. Templates rarely have more than ~10 tasks; the keyboard-
 * accessible up/down pattern is good enough and saves a dependency.
 */

import { useState } from "react";

import type {
  Priority,
  ProjectType,
  TaskTemplate,
  TaskTemplateItem,
} from "@/lib/db";
import { PROJECT_TYPES } from "@/lib/projects/display";

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

interface TemplatesAdminProps {
  initialTemplates: TaskTemplate[];
}

interface DraftTemplate {
  /** null = unsaved draft, will POST on save. */
  template_id: string | null;
  template_name: string;
  project_type: ProjectType;
  tasks: TaskTemplateItem[];
}

function templateToDraft(t: TaskTemplate): DraftTemplate {
  return {
    template_id: t.template_id,
    template_name: t.template_name,
    project_type: t.project_type,
    tasks: t.tasks.map((i) => ({ ...i })),
  };
}

function newDraft(): DraftTemplate {
  return {
    template_id: null,
    template_name: "",
    project_type: "New Feature",
    tasks: [{ name: "", description: "", default_priority: "Medium" }],
  };
}

export function TemplatesAdmin({ initialTemplates }: TemplatesAdminProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>(() =>
    sortTemplates(initialTemplates),
  );
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  function startEdit(t: TaskTemplate) {
    setDraft(templateToDraft(t));
    setError(null);
  }

  function startCreate() {
    setDraft(newDraft());
    setError(null);
  }

  function cancelDraft() {
    setDraft(null);
    setError(null);
  }

  function updateDraft<K extends keyof DraftTemplate>(
    key: K,
    value: DraftTemplate[K],
  ) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateTaskItem(
    index: number,
    patch: Partial<TaskTemplateItem>,
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = prev.tasks.map((it, i) =>
        i === index ? { ...it, ...patch } : it,
      );
      return { ...prev, tasks: next };
    });
  }

  function addTaskItem() {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            tasks: [
              ...prev.tasks,
              { name: "", description: "", default_priority: "Medium" },
            ],
          }
        : prev,
    );
  }

  function removeTaskItem(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.tasks.length <= 1) return prev; // always keep at least one row
      return { ...prev, tasks: prev.tasks.filter((_, i) => i !== index) };
    });
  }

  function moveTaskItem(index: number, direction: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.tasks.length) return prev;
      const next = [...prev.tasks];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, tasks: next };
    });
  }

  async function handleSave() {
    if (!draft) return;
    setError(null);

    if (!draft.template_name.trim()) {
      setError("Name is required.");
      return;
    }
    if (draft.tasks.length === 0) {
      setError("Template must have at least one task.");
      return;
    }
    for (const [i, t] of draft.tasks.entries()) {
      if (!t.name.trim()) {
        setError(`Task ${i + 1}: name is required.`);
        return;
      }
    }

    setSaving(true);
    const isNew = draft.template_id === null;
    const url = isNew ? "/api/templates" : `/api/templates/${draft.template_id}`;
    const method = isNew ? "POST" : "PUT";
    const body = {
      template_name: draft.template_name.trim(),
      project_type: draft.project_type,
      tasks: draft.tasks.map((t) => ({
        name: t.name.trim(),
        description: t.description,
        default_priority: t.default_priority,
      })),
    };

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      template?: TaskTemplate;
      error?: string;
    };
    setSaving(false);

    if (!res.ok || !data.template) {
      setError(data.error ?? "Could not save template.");
      return;
    }

    setTemplates((prev) =>
      sortTemplates(
        isNew
          ? [...prev, data.template!]
          : prev.map((t) =>
              t.template_id === data.template!.template_id ? data.template! : t,
            ),
      ),
    );
    setDraft(templateToDraft(data.template));
  }

  async function handleDelete() {
    if (!draft || draft.template_id === null) return;
    if (!window.confirm(`Delete template "${draft.template_name}"?`)) return;
    setGlobalError(null);
    const res = await fetch(`/api/templates/${draft.template_id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setGlobalError(data.error ?? "Could not delete template.");
      return;
    }
    setTemplates((prev) =>
      prev.filter((t) => t.template_id !== draft.template_id),
    );
    setDraft(null);
  }

  // Group templates by project type for the sidebar.
  const grouped = groupByProjectType(templates);

  return (
    <div className="space-y-4">
      {globalError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {globalError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem,1fr]">
        {/* Left pane: list */}
        <aside className="rounded-md border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              Templates
            </h2>
            <button
              type="button"
              onClick={startCreate}
              className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-sm hover:bg-gray-800"
            >
              + New
            </button>
          </div>
          <div className="max-h-[32rem] overflow-y-auto py-1">
            {templates.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-500">
                No templates yet.
              </p>
            ) : (
              PROJECT_TYPES.map((pt) => {
                const items = grouped.get(pt) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={pt} className="mb-2">
                    <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      {pt}
                    </p>
                    {items.map((t) => {
                      const active = draft?.template_id === t.template_id;
                      return (
                        <button
                          key={t.template_id}
                          type="button"
                          onClick={() => startEdit(t)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition ${
                            active
                              ? "bg-gray-900 text-white"
                              : "text-gray-800 hover:bg-gray-100"
                          }`}
                        >
                          <span className="truncate">{t.template_name}</span>
                          <span
                            className={`text-[10px] ${
                              active ? "text-gray-300" : "text-gray-500"
                            }`}
                          >
                            {t.tasks.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right pane: editor */}
        <section className="rounded-md border border-gray-200 bg-white shadow-sm">
          {!draft ? (
            <p className="px-6 py-12 text-center text-sm text-gray-500">
              Select a template on the left, or create a new one.
            </p>
          ) : (
            <div className="space-y-5 p-6">
              {error ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="tpl-name" label="Template name" required>
                  <input
                    id="tpl-name"
                    type="text"
                    value={draft.template_name}
                    onChange={(e) => updateDraft("template_name", e.target.value)}
                    disabled={saving}
                    className={baseInput}
                  />
                </Field>

                <Field id="tpl-type" label="Project type" required>
                  <select
                    id="tpl-type"
                    value={draft.project_type}
                    onChange={(e) =>
                      updateDraft("project_type", e.target.value as ProjectType)
                    }
                    disabled={saving}
                    className={baseInput}
                  >
                    {PROJECT_TYPES.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Tasks ({draft.tasks.length})
                  </h3>
                  <button
                    type="button"
                    onClick={addTaskItem}
                    disabled={saving}
                    className="text-xs font-medium text-gray-700 hover:underline disabled:opacity-50"
                  >
                    + Add task
                  </button>
                </div>
                <div className="space-y-3">
                  {draft.tasks.map((item, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          Task {i + 1}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveTaskItem(i, -1)}
                            disabled={saving || i === 0}
                            className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                            aria-label={`Move task ${i + 1} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTaskItem(i, 1)}
                            disabled={saving || i === draft.tasks.length - 1}
                            className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                            aria-label={`Move task ${i + 1} down`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTaskItem(i)}
                            disabled={saving || draft.tasks.length <= 1}
                            className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                            aria-label={`Remove task ${i + 1}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,8rem]">
                        <input
                          type="text"
                          aria-label={`Task ${i + 1} name`}
                          placeholder="Task name"
                          value={item.name}
                          onChange={(e) =>
                            updateTaskItem(i, { name: e.target.value })
                          }
                          disabled={saving}
                          className={baseInput}
                        />
                        <select
                          aria-label={`Task ${i + 1} default priority`}
                          value={item.default_priority}
                          onChange={(e) =>
                            updateTaskItem(i, {
                              default_priority: e.target.value as Priority,
                            })
                          }
                          disabled={saving}
                          className={baseInput}
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        aria-label={`Task ${i + 1} description`}
                        placeholder="Description (optional)"
                        value={item.description}
                        onChange={(e) =>
                          updateTaskItem(i, { description: e.target.value })
                        }
                        disabled={saving}
                        rows={2}
                        className={`mt-2 ${baseInput}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                {draft.template_id ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                  >
                    Delete template
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelDraft}
                    disabled={saving}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:bg-gray-400"
                  >
                    {saving
                      ? "Saving…"
                      : draft.template_id
                        ? "Save changes"
                        : "Create template"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
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

function sortTemplates(templates: TaskTemplate[]): TaskTemplate[] {
  return [...templates].sort((a, b) => {
    if (a.project_type !== b.project_type) {
      return (
        PROJECT_TYPES.indexOf(a.project_type) -
        PROJECT_TYPES.indexOf(b.project_type)
      );
    }
    return a.template_name < b.template_name ? -1 : 1;
  });
}

function groupByProjectType(
  templates: TaskTemplate[],
): Map<ProjectType, TaskTemplate[]> {
  const map = new Map<ProjectType, TaskTemplate[]>();
  for (const t of templates) {
    const arr = map.get(t.project_type) ?? [];
    arr.push(t);
    map.set(t.project_type, arr);
  }
  return map;
}
