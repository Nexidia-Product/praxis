"use client";

/**
 * Idea → task-on-existing-project merge form (additional disposition,
 * alongside "Convert to project").
 *
 * Pre-filled task-create form: name and description come from the idea,
 * priority is mapped from urgency. The admin picks the target project,
 * adjusts anything, and saves.
 *
 * On submit we POST to /api/ideas/[id]/merge which:
 *   - Validates the task payload through the task service.
 *   - Creates the task on the chosen project (firing the usual task
 *     side-effects — assignee notification, health recalc, audit).
 *   - Marks the idea Converted with a back-link to that project.
 *
 * Modeled directly on `conversion-form.tsx`; kept as a separate component
 * because the two dispositions create different record types and post to
 * different endpoints.
 */

import { useState } from "react";

import { PRIORITIES, stagesForTrack } from "@/lib/projects/display";
import { TASK_STATUSES } from "@/lib/tasks/display";
import type { Priority, Project, ProjectIdea, Task, TaskStatus } from "@/lib/db";

interface IdeaMergeFormProps {
  idea: ProjectIdea;
  /** Candidate projects — open (non-Completed/Canceled) only. */
  projects: Project[];
  onCancel: () => void;
  onMerged: (result: { task: Task; idea: ProjectIdea }) => void;
}

interface FormState {
  project_id: string;
  task_name: string;
  detailed_description: string;
  priority: Priority;
  status: TaskStatus;
  target_date: string;
  /**
   * Required, no default — scoped to the selected project's track (see
   * `stagesForTrack`). Starts blank so the admin picks it deliberately,
   * matching the standalone task form's create behavior.
   */
  stage: string;
  /**
   * Required by the task service (a task can't be created without an
   * estimate). Held as a string so a half-typed value doesn't fight the
   * number input; blank until the admin enters it.
   */
  estimate_hours: string;
}

/** Mirrors `urgencyToPriority` in `lib/ideas/service.ts`. */
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

function initialState(idea: ProjectIdea): FormState {
  return {
    project_id: "",
    task_name: idea.idea_name,
    detailed_description: idea.description,
    priority: urgencyToPriority(idea),
    status: "Not Started",
    target_date: idea.requested_target_date ?? "",
    stage: "",
    estimate_hours: "",
  };
}

export function IdeaMergeForm({
  idea,
  projects,
  onCancel,
  onMerged,
}: IdeaMergeFormProps) {
  const [state, setState] = useState<FormState>(() => initialState(idea));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  /**
   * Changing the project can change which stages are valid (stages are
   * track-scoped) — clear a stage that doesn't belong to the newly
   * picked project's track rather than carrying over an invalid value.
   */
  function updateProjectId(id: string) {
    const proj = projects.find((p) => p.project_id === id);
    setState((prev) => ({
      ...prev,
      project_id: id,
      stage:
        proj && stagesForTrack(proj.track).includes(prev.stage)
          ? prev.stage
          : "",
    }));
  }

  const selectedProject = projects.find((p) => p.project_id === state.project_id);
  const stageOptions = selectedProject ? stagesForTrack(selectedProject.track) : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);

    const payload = {
      project_id: state.project_id,
      task_name: state.task_name.trim(),
      detailed_description: state.detailed_description,
      priority: state.priority,
      status: state.status,
      target_date: state.target_date || null,
      stage: state.stage,
      estimate_hours: Number(state.estimate_hours),
    };

    const res = await fetch(`/api/ideas/${idea.idea_id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: Task;
      idea?: ProjectIdea;
      error?: string;
    };
    setSaving(false);

    if (!res.ok || !data.task || !data.idea) {
      setError(data.error ?? "Could not merge this idea.");
      return;
    }

    onMerged({ task: data.task, idea: data.idea });
  }

  return (
    <section className="rounded-lg border-2 border-sky-300 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Merge into project
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Creates a task on an existing project, pre-filled from this idea.
            The idea is marked Converted and linked to that project — this
            does not create a new project.
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
            htmlFor="merge_project"
            className="block text-sm font-medium text-gray-900"
          >
            Project <span className="text-red-600">*</span>
          </label>
          <select
            id="merge_project"
            required
            value={state.project_id}
            onChange={(e) => updateProjectId(e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          >
            <option value="">— Select a project —</option>
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.project_id} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="merge_task_name"
            className="block text-sm font-medium text-gray-900"
          >
            Task name <span className="text-red-600">*</span>
          </label>
          <input
            id="merge_task_name"
            type="text"
            required
            value={state.task_name}
            onChange={(e) => update("task_name", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          />
        </div>

        <div>
          <label
            htmlFor="merge_description"
            className="block text-sm font-medium text-gray-900"
          >
            Task description
          </label>
          <textarea
            id="merge_description"
            rows={5}
            value={state.detailed_description}
            onChange={(e) => update("detailed_description", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <div>
            <label
              htmlFor="merge_stage"
              className="block text-sm font-medium text-gray-900"
            >
              Stage <span className="text-red-600">*</span>
            </label>
            <select
              id="merge_stage"
              required
              value={state.stage}
              onChange={(e) => update("stage", e.target.value)}
              disabled={saving || !selectedProject}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              <option value="" disabled>
                — Select a stage —
              </option>
              {stageOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {!selectedProject ? (
              <p className="mt-1 text-xs text-gray-500">
                Pick a project first.
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="merge_priority"
              className="block text-sm font-medium text-gray-900"
            >
              Priority
            </label>
            <select
              id="merge_priority"
              value={state.priority}
              onChange={(e) => update("priority", e.target.value as Priority)}
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="merge_status"
              className="block text-sm font-medium text-gray-900"
            >
              Status
            </label>
            <select
              id="merge_status"
              value={state.status}
              onChange={(e) => update("status", e.target.value as TaskStatus)}
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="merge_target_date"
              className="block text-sm font-medium text-gray-900"
            >
              Target date
            </label>
            <input
              id="merge_target_date"
              type="date"
              value={state.target_date}
              onChange={(e) => update("target_date", e.target.value)}
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label
              htmlFor="merge_estimate"
              className="block text-sm font-medium text-gray-900"
            >
              Estimated hours <span className="text-red-600">*</span>
            </label>
            <input
              id="merge_estimate"
              type="number"
              required
              min="0"
              max="999"
              step="0.25"
              inputMode="decimal"
              placeholder="e.g. 4"
              value={state.estimate_hours}
              onChange={(e) => update("estimate_hours", e.target.value)}
              disabled={saving}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            />
          </div>
        </div>

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
              !state.project_id ||
              !state.task_name.trim() ||
              !state.stage ||
              state.estimate_hours.trim() === ""
            }
            className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {saving ? "Merging…" : "Create task & mark Converted"}
          </button>
        </div>
      </form>
    </section>
  );
}
