"use client";

/**
 * Admin Task Templates editor (Section 5.19).
 *
 * Two-pane layout:
 *   - Left: list of existing templates, grouped under their track.
 *   - Right: editor for the currently selected template (or a fresh draft).
 *
 * Save semantics:
 *   - New templates → POST /api/templates.
 *   - Existing templates → PUT /api/templates/[id] (full replace).
 *
 * Reordering tasks within a template uses up/down buttons rather than
 * drag-and-drop. Templates rarely have more than ~10 tasks; the keyboard-
 * accessible up/down pattern is good enough and saves a dependency.
 *
 * Per-task Stage options are the union of `stagesForTrack(t)` across
 * whichever tracks are currently checked on the draft — the template
 * doesn't commit to one track, so this is the widest sensible choice set
 * at authoring time (the service layer re-validates the same way on save).
 */

import { useState } from "react";

import type {
  DrivenProjectDateField,
  Priority,
  TaskDependencyType,
  TaskTemplate,
  TaskTemplateItem,
  TemplateDependency,
} from "@/lib/db";
import { stagesForTrack } from "@/lib/projects/display";
import type { EnumOption } from "@/lib/projects/enum-options";
import { buildTemplateMarkdown } from "@/lib/tasks/template-markdown";

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

const DEPENDENCY_TYPES: { value: TaskDependencyType; label: string }[] = [
  { value: "FS", label: "FS — finish-to-start" },
  { value: "SS", label: "SS — start-to-start" },
  { value: "FF", label: "FF — finish-to-finish" },
  { value: "SF", label: "SF — start-to-finish" },
];

/** Generate a stable per-template task slug. */
function newLocalId(): string {
  // Browsers we target support crypto.randomUUID(); fall back to a
  // simple random suffix if the API is unavailable (e.g. very old
  // contexts) so the editor still works.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tpl-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

interface TemplatesAdminProps {
  initialTemplates: TaskTemplate[];
  /** Merged track options (system + admin-added, archived excluded). */
  trackOptions: EnumOption[];
  /** Active users' names, for the per-task "Default responsible" dropdown. */
  userOptions: string[];
}

/**
 * Draft shape for a task row in the editor. `estimate_hours` is nullable
 * here even though the saved `TaskTemplateItem` requires it — the editor
 * needs to represent "not filled in yet" while the admin is still typing;
 * `handleSave` validates it's non-null before the request goes out.
 */
type DraftTaskItem = Omit<TaskTemplateItem, "estimate_hours"> & {
  estimate_hours: number | null;
};

interface DraftTemplate {
  /** null = unsaved draft, will POST on save. */
  template_id: string | null;
  template_name: string;
  tracks: string[];
  tasks: DraftTaskItem[];
}

function templateToDraft(t: TaskTemplate): DraftTemplate {
  return {
    template_id: t.template_id,
    template_name: t.template_name,
    tracks: [...t.tracks],
    // Backfill local_id, estimate_hours, dependencies, stage,
    // default_responsible for rows that predate those fields, so the
    // editor never sees `undefined`.
    tasks: t.tasks.map((i) => ({
      local_id: i.local_id?.trim() ? i.local_id : newLocalId(),
      name: i.name,
      description: i.description,
      default_priority: i.default_priority,
      stage: i.stage ?? "",
      default_responsible: i.default_responsible ?? null,
      estimate_hours: i.estimate_hours ?? null,
      complexity_estimate_hours: i.complexity_estimate_hours ?? null,
      friday_anchor: i.friday_anchor ?? false,
      fixed_lag_business_days_after: i.fixed_lag_business_days_after ?? null,
      drives_project_date: i.drives_project_date ?? null,
      dependencies: (i.dependencies ?? []).map((d) => ({ ...d })),
    })),
  };
}

function newDraft(trackOptions: EnumOption[]): DraftTemplate {
  return {
    template_id: null,
    template_name: "",
    tracks: trackOptions[0] ? [trackOptions[0].id] : [],
    tasks: [
      {
        local_id: newLocalId(),
        name: "",
        description: "",
        default_priority: "Medium",
        stage: "",
        default_responsible: null,
        estimate_hours: null,
        complexity_estimate_hours: null,
        friday_anchor: false,
        fixed_lag_business_days_after: null,
        drives_project_date: null,
        dependencies: [],
      },
    ],
  };
}

export function TemplatesAdmin({
  initialTemplates,
  trackOptions,
  userOptions,
}: TemplatesAdminProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>(() =>
    sortTemplates(initialTemplates, trackOptions),
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
    setDraft(newDraft(trackOptions));
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

  /**
   * Toggling a track can shrink the valid-stage union — clear any task's
   * stage that's no longer covered by the remaining checked tracks,
   * rather than letting it silently fail validation on save.
   */
  function updateTracks(trackId: string, checked: boolean) {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextTracks = checked
        ? [...prev.tracks, trackId]
        : prev.tracks.filter((t) => t !== trackId);
      const validStages = new Set(nextTracks.flatMap((t) => stagesForTrack(t)));
      return {
        ...prev,
        tracks: nextTracks,
        tasks: prev.tasks.map((t) =>
          t.stage && !validStages.has(t.stage) ? { ...t, stage: "" } : t,
        ),
      };
    });
  }

  function updateTaskItem(
    index: number,
    patch: Partial<DraftTaskItem>,
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
              {
                local_id: newLocalId(),
                name: "",
                description: "",
                default_priority: "Medium",
                stage: "",
                default_responsible: null,
                estimate_hours: null,
                complexity_estimate_hours: null,
                friday_anchor: false,
                fixed_lag_business_days_after: null,
                drives_project_date: null,
                dependencies: [],
              },
            ],
          }
        : prev,
    );
  }

  function removeTaskItem(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.tasks.length <= 1) return prev; // always keep at least one row
      const removed = prev.tasks[index];
      const nextTasks = prev.tasks.filter((_, i) => i !== index);
      // Drop any dangling references to the removed task's local_id
      // so save can't fail with "unknown predecessor."
      const cleaned = nextTasks.map((t) => ({
        ...t,
        dependencies: t.dependencies.filter(
          (d) => d.predecessor_local_id !== removed.local_id,
        ),
        fixed_lag_business_days_after:
          t.fixed_lag_business_days_after?.predecessor_local_id === removed.local_id
            ? null
            : t.fixed_lag_business_days_after,
      }));
      return { ...prev, tasks: cleaned };
    });
  }

  function addDependency(taskIndex: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      // Default to the first other task in the template as the
      // predecessor — there must be one, since the "+ Add dependency"
      // button only renders when prev.tasks.length > 1.
      const other = prev.tasks.find((_, i) => i !== taskIndex);
      if (!other) return prev;
      const nextTasks = prev.tasks.map((t, i) =>
        i === taskIndex
          ? {
              ...t,
              dependencies: [
                ...t.dependencies,
                { predecessor_local_id: other.local_id, type: "FS" as const },
              ],
            }
          : t,
      );
      return { ...prev, tasks: nextTasks };
    });
  }

  function updateDependency(
    taskIndex: number,
    depIndex: number,
    patch: Partial<TemplateDependency>,
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextTasks = prev.tasks.map((t, i) => {
        if (i !== taskIndex) return t;
        const nextDeps = t.dependencies.map((d, j) =>
          j === depIndex ? { ...d, ...patch } : d,
        );
        return { ...t, dependencies: nextDeps };
      });
      return { ...prev, tasks: nextTasks };
    });
  }

  function removeDependency(taskIndex: number, depIndex: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextTasks = prev.tasks.map((t, i) =>
        i === taskIndex
          ? { ...t, dependencies: t.dependencies.filter((_, j) => j !== depIndex) }
          : t,
      );
      return { ...prev, tasks: nextTasks };
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
    if (draft.tracks.length === 0) {
      setError("Pick at least one track.");
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
      if (!t.stage) {
        setError(`Task ${i + 1}: stage is required.`);
        return;
      }
      if (t.estimate_hours == null) {
        setError(`Task ${i + 1}: estimate (hours) is required.`);
        return;
      }
    }

    setSaving(true);
    const isNew = draft.template_id === null;
    const url = isNew ? "/api/templates" : `/api/templates/${draft.template_id}`;
    const method = isNew ? "POST" : "PUT";
    const body = {
      template_name: draft.template_name.trim(),
      tracks: draft.tracks,
      tasks: draft.tasks.map((t) => ({
        local_id: t.local_id,
        name: t.name.trim(),
        description: t.description,
        stage: t.stage,
        default_responsible: t.default_responsible,
        default_priority: t.default_priority,
        estimate_hours: t.estimate_hours,
        complexity_estimate_hours: t.complexity_estimate_hours,
        friday_anchor: t.friday_anchor,
        fixed_lag_business_days_after: t.fixed_lag_business_days_after,
        drives_project_date: t.drives_project_date,
        dependencies: t.dependencies,
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
        trackOptions,
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

  // Group templates by track for the sidebar.
  const grouped = groupByTrack(templates);

  // Union of stages across the draft's currently-checked tracks — the
  // per-task Stage select's option list.
  const stageChoices = draft
    ? Array.from(new Set(draft.tracks.flatMap((t) => stagesForTrack(t))))
    : [];

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
              trackOptions.map((track) => {
                const items = grouped.get(track.id) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={track.id} className="mb-2">
                    <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      {track.label}
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

                <Field
                  id="tpl-tracks"
                  label="Tracks"
                  required
                >
                  {/* Multi-select checkbox group. A template can apply
                      to N tracks — closeout / handover templates
                      typically span every track while highly track-specific
                      ones stay narrow. Validation in the service layer
                      requires at least one to be picked. */}
                  <div
                    id="tpl-tracks"
                    role="group"
                    aria-label="Tracks"
                    className="flex flex-wrap gap-2 rounded-md border border-gray-300 bg-white p-2"
                  >
                    {trackOptions.map((track) => {
                      const checked = draft.tracks.includes(track.id);
                      return (
                        <label
                          key={track.id}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                            checked
                              ? "border-[var(--brand)] bg-blue-50 text-blue-900"
                              : "border-gray-300 bg-white text-gray-800"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => updateTracks(track.id, e.target.checked)}
                            disabled={saving}
                            className="h-3 w-3"
                          />
                          {track.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Pick every track this template should appear for. Most
                    "closeout" or "handover" templates apply across all
                    tracks. Each task's Stage options below are the
                    combined stage list across the tracks picked here.
                  </p>
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
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,8rem,6rem]">
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
                        <input
                          type="number"
                          required
                          inputMode="decimal"
                          step="0.25"
                          min={0}
                          max={999}
                          aria-label={`Task ${i + 1} estimate in hours (required)`}
                          placeholder="Hours *"
                          // Render null/0 as an empty string so the
                          // placeholder is visible. The controlled value
                          // only becomes a number when the admin types
                          // something.
                          value={item.estimate_hours ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateTaskItem(i, {
                              estimate_hours: v === "" ? null : Number(v),
                            });
                          }}
                          disabled={saving}
                          className={baseInput}
                        />
                      </div>
                      <ComplexityOverrides
                        taskIndex={i}
                        value={item.complexity_estimate_hours ?? null}
                        onChange={(next) =>
                          updateTaskItem(i, { complexity_estimate_hours: next })
                        }
                        disabled={saving}
                      />
                      <ScheduleAnchorControls
                        taskIndex={i}
                        tasks={draft.tasks}
                        selfLocalId={item.local_id}
                        fridayAnchor={item.friday_anchor ?? false}
                        onFridayAnchorChange={(next) =>
                          updateTaskItem(i, { friday_anchor: next })
                        }
                        fixedLag={item.fixed_lag_business_days_after ?? null}
                        onFixedLagChange={(next) =>
                          updateTaskItem(i, { fixed_lag_business_days_after: next })
                        }
                        drivesProjectDate={item.drives_project_date ?? null}
                        onDrivesProjectDateChange={(next) =>
                          updateTaskItem(i, { drives_project_date: next })
                        }
                        disabled={saving}
                      />
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <select
                            aria-label={`Task ${i + 1} stage`}
                            value={item.stage}
                            onChange={(e) =>
                              updateTaskItem(i, { stage: e.target.value })
                            }
                            disabled={saving || stageChoices.length === 0}
                            className={baseInput}
                          >
                            <option value="" disabled>
                              — Select a stage —
                            </option>
                            {stageChoices.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                            {/* Defensive: preserve a stage that's no longer
                                covered by the checked tracks rather than
                                silently dropping it from the select. */}
                            {item.stage && !stageChoices.includes(item.stage) ? (
                              <option value={item.stage}>{item.stage}</option>
                            ) : null}
                          </select>
                          {stageChoices.length === 0 ? (
                            <p className="mt-1 text-[11px] text-gray-500">
                              Pick a track above first.
                            </p>
                          ) : null}
                        </div>
                        <select
                          aria-label={`Task ${i + 1} default responsible`}
                          value={item.default_responsible ?? ""}
                          onChange={(e) =>
                            updateTaskItem(i, {
                              default_responsible: e.target.value || null,
                            })
                          }
                          disabled={saving}
                          className={baseInput}
                        >
                          <option value="">— None (defaults to project lead) —</option>
                          {userOptions.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                          {/* Defensive: preserve a name that's no longer
                              in the active-user roster (e.g. the user
                              was deactivated after this template was
                              saved) rather than silently dropping it. */}
                          {item.default_responsible &&
                          !userOptions.includes(item.default_responsible) ? (
                            <option value={item.default_responsible}>
                              {item.default_responsible}
                            </option>
                          ) : null}
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

                      {/* Dependencies subsection. Only renders the
                          "+ Add dependency" button when there's at
                          least one other task to point at; until then
                          there's nothing meaningful to pick. */}
                      <div className="mt-3 border-t border-gray-200 pt-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                            Dependencies
                          </span>
                          {draft.tasks.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => addDependency(i)}
                              disabled={saving}
                              className="text-[11px] font-medium text-gray-700 hover:underline disabled:opacity-50"
                            >
                              + Add dependency
                            </button>
                          ) : null}
                        </div>
                        {item.dependencies.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            No predecessors.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {item.dependencies.map((dep, j) => {
                              const others = draft.tasks.filter(
                                (_, k) => k !== i,
                              );
                              // If the picked predecessor was removed
                              // elsewhere we let the row stay with its
                              // current value; the save-time validator
                              // would catch a truly-broken reference,
                              // but `removeTaskItem` already prunes
                              // dangling deps so this is belt-and-braces.
                              return (
                                <div
                                  key={j}
                                  className="grid grid-cols-[1fr,10rem,auto] gap-2"
                                >
                                  <select
                                    aria-label={`Task ${i + 1} dependency ${j + 1} predecessor`}
                                    value={dep.predecessor_local_id}
                                    onChange={(e) =>
                                      updateDependency(i, j, {
                                        predecessor_local_id: e.target.value,
                                      })
                                    }
                                    disabled={saving}
                                    className={baseInput}
                                  >
                                    {others.map((o) => (
                                      <option
                                        key={o.local_id}
                                        value={o.local_id}
                                      >
                                        {o.name.trim() || `Task ${
                                          draft.tasks.indexOf(o) + 1
                                        }`}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    aria-label={`Task ${i + 1} dependency ${j + 1} type`}
                                    value={dep.type}
                                    onChange={(e) =>
                                      updateDependency(i, j, {
                                        type: e.target.value as TaskDependencyType,
                                      })
                                    }
                                    disabled={saving}
                                    className={baseInput}
                                  >
                                    {DEPENDENCY_TYPES.map((dt) => (
                                      <option key={dt.value} value={dt.value}>
                                        {dt.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => removeDependency(i, j)}
                                    disabled={saving}
                                    aria-label={`Remove dependency ${j + 1} from task ${i + 1}`}
                                    className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => downloadTemplateMarkdown(draft, trackOptions)}
                    className="text-sm font-medium text-gray-700 hover:underline"
                  >
                    ↓ Download Markdown
                  </button>
                  {draft.template_id ? (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={saving}
                      className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                    >
                      Delete template
                    </button>
                  ) : null}
                </div>
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

type ComplexityOverrideValue = Partial<Record<"Low" | "High", number>> | null;

/**
 * Optional per-task disclosure for a duration that genuinely varies by
 * project complexity (e.g. EDA: Low 4d / Medium 9d / High 19d). The task's
 * main Estimate field above is always the Medium value; this reveals two
 * extra number inputs that override it for Low/High-complexity projects
 * (`lib/tasks/service.ts`'s `instantiateTemplate` picks the matching one).
 * Collapsed by default; clearing both inputs removes the override object
 * entirely rather than leaving `{}` on the record.
 */
function ComplexityOverrides({
  taskIndex,
  value,
  onChange,
  disabled,
}: {
  taskIndex: number;
  value: ComplexityOverrideValue;
  onChange: (next: ComplexityOverrideValue) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(value != null);

  function set(tier: "Low" | "High", n: number | null) {
    const next = { ...(value ?? {}) };
    if (n == null) delete next[tier];
    else next[tier] = n;
    onChange(Object.keys(next).length > 0 ? next : null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="mt-1 text-[11px] font-medium text-gray-600 hover:underline disabled:opacity-50"
      >
        + Vary by complexity
      </button>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-600">
      <span>Overrides — Low:</span>
      <input
        type="number"
        min={0}
        max={999}
        step="0.25"
        aria-label={`Task ${taskIndex + 1} Low-complexity estimate override`}
        value={value?.Low ?? ""}
        onChange={(e) =>
          set("Low", e.target.value === "" ? null : Number(e.target.value))
        }
        disabled={disabled}
        className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
      />
      <span>High:</span>
      <input
        type="number"
        min={0}
        max={999}
        step="0.25"
        aria-label={`Task ${taskIndex + 1} High-complexity estimate override`}
        value={value?.High ?? ""}
        onChange={(e) =>
          set("High", e.target.value === "" ? null : Number(e.target.value))
        }
        disabled={disabled}
        className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
      />
      <button
        type="button"
        onClick={() => {
          onChange(null);
          setOpen(false);
        }}
        disabled={disabled}
        className="text-gray-500 hover:underline disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}

type FixedLagValue = { predecessor_local_id: string; business_days: number } | null;

/**
 * Display labels for `DrivenProjectDateField` — kept as its own map
 * (rather than inlined in the `<select>`) so a future addition to the
 * type is a one-line change here, matching how the type itself is
 * documented in lib/db/types.ts.
 */
const DRIVEN_PROJECT_DATE_LABELS: Record<DrivenProjectDateField, string> = {
  target_date: "Target Application Deployment Date",
  target_executable_deployment_date: "Target Executable Deployment Date",
};

/**
 * Release-calendar scheduling anchors (`lib/tasks/schedule.ts`) for tasks
 * that represent a real deployment milestone — e.g. "must land on a
 * Friday," optionally "and exactly N business days after another task,"
 * overriding the normal estimate/dependency-chain date computation for
 * that one task, and optionally "this task's due date IS the project's
 * Target Application/Executable Deployment Date" (`drives_project_date`
 * — kept in sync automatically by `lib/tasks/service.ts`'s
 * `syncProjectDateFromTask` whenever the task's date is set or changes).
 * Track-specific: each track's template tags whichever task represents
 * that milestone, so a future track's equivalent task is just the same
 * tag via this editor — no code change needed. Rare — most tasks need
 * none of this — so the fixed-lag half is a collapsed disclosure, same
 * pattern as `ComplexityOverrides`.
 */
function ScheduleAnchorControls({
  taskIndex,
  tasks,
  selfLocalId,
  fridayAnchor,
  onFridayAnchorChange,
  fixedLag,
  onFixedLagChange,
  drivesProjectDate,
  onDrivesProjectDateChange,
  disabled,
}: {
  taskIndex: number;
  tasks: DraftTaskItem[];
  selfLocalId: string;
  fridayAnchor: boolean;
  onFridayAnchorChange: (next: boolean) => void;
  fixedLag: FixedLagValue;
  onFixedLagChange: (next: FixedLagValue) => void;
  drivesProjectDate: DrivenProjectDateField | null;
  onDrivesProjectDateChange: (next: DrivenProjectDateField | null) => void;
  disabled: boolean;
}) {
  const [lagOpen, setLagOpen] = useState(fixedLag != null);
  const others = tasks.filter((t) => t.local_id !== selfLocalId);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
      <label className="inline-flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={fridayAnchor}
          onChange={(e) => onFridayAnchorChange(e.target.checked)}
          disabled={disabled}
          className="h-3 w-3"
        />
        Must land on a Friday (release-calendar anchor)
      </label>

      <label className="inline-flex items-center gap-1.5">
        Drives project date:
        <select
          aria-label={`Task ${taskIndex + 1} drives project date`}
          value={drivesProjectDate ?? ""}
          onChange={(e) =>
            onDrivesProjectDateChange(
              e.target.value === "" ? null : (e.target.value as DrivenProjectDateField),
            )
          }
          disabled={disabled}
          className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
        >
          <option value="">— None —</option>
          {(Object.keys(DRIVEN_PROJECT_DATE_LABELS) as DrivenProjectDateField[]).map((f) => (
            <option key={f} value={f}>
              {DRIVEN_PROJECT_DATE_LABELS[f]}
            </option>
          ))}
        </select>
      </label>

      {!lagOpen ? (
        <button
          type="button"
          onClick={() => setLagOpen(true)}
          disabled={disabled}
          className="font-medium text-gray-600 hover:underline disabled:opacity-50"
        >
          + Exact gap from another task
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          Exactly
          <input
            type="number"
            min={1}
            max={999}
            aria-label={`Task ${taskIndex + 1} fixed-lag business days`}
            value={fixedLag?.business_days ?? ""}
            onChange={(e) => {
              const days = e.target.value === "" ? null : Number(e.target.value);
              onFixedLagChange(
                days != null && fixedLag?.predecessor_local_id
                  ? { predecessor_local_id: fixedLag.predecessor_local_id, business_days: days }
                  : days != null && others[0]
                    ? { predecessor_local_id: others[0].local_id, business_days: days }
                    : null,
              );
            }}
            disabled={disabled || others.length === 0}
            className="w-14 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
          />
          business days after
          <select
            aria-label={`Task ${taskIndex + 1} fixed-lag reference task`}
            value={fixedLag?.predecessor_local_id ?? ""}
            onChange={(e) =>
              onFixedLagChange(
                fixedLag?.business_days
                  ? { predecessor_local_id: e.target.value, business_days: fixedLag.business_days }
                  : null,
              )
            }
            disabled={disabled || others.length === 0}
            className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
          >
            <option value="" disabled>
              — Select a task —
            </option>
            {others.map((t) => (
              <option key={t.local_id} value={t.local_id}>
                {t.name.trim() || "(untitled task)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              onFixedLagChange(null);
              setLagOpen(false);
            }}
            disabled={disabled}
            className="text-gray-500 hover:underline disabled:opacity-50"
          >
            Remove
          </button>
        </span>
      )}
    </div>
  );
}

/** Lowercase, hyphenated filename stem — safe across OSes. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "template";
}

function downloadTemplateMarkdown(
  draft: DraftTemplate,
  trackOptions: EnumOption[],
): void {
  const md = buildTemplateMarkdown(draft, trackOptions);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(draft.template_name)}-template.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sortTemplates(
  templates: TaskTemplate[],
  trackOptions: EnumOption[],
): TaskTemplate[] {
  const order = trackOptions.map((o) => o.id);
  return [...templates].sort((a, b) => {
    // Sort by the first listed track (matches the order an admin
    // chose in the editor) then by template name. Templates that
    // span multiple tracks just sort by the leftmost.
    const aTrack = a.tracks[0] ?? "";
    const bTrack = b.tracks[0] ?? "";
    if (aTrack !== bTrack) {
      const ai = order.indexOf(aTrack);
      const bi = order.indexOf(bTrack);
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) -
        (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    }
    return a.template_name < b.template_name ? -1 : 1;
  });
}

function groupByTrack(templates: TaskTemplate[]): Map<string, TaskTemplate[]> {
  // A multi-track template appears under each of its tracks. The
  // group view is for "show me everything relevant to track X" so
  // duplication across groups is the right shape; sortTemplates
  // upstream handles the canonical order inside each bucket.
  const map = new Map<string, TaskTemplate[]>();
  for (const t of templates) {
    for (const track of t.tracks) {
      const arr = map.get(track) ?? [];
      arr.push(t);
      map.set(track, arr);
    }
  }
  return map;
}
