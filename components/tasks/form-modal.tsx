"use client";

/**
 * Task create / edit modal (Section 5.2).
 *
 * Same component used for both flows; switches on whether `task` is passed.
 *
 * Project parent:
 *   - On create, the parent project is selectable (or pre-locked when the
 *     modal is opened from a project quick-view via `defaultProjectId`).
 *   - On edit, the project is shown read-only — Section 4.2 makes
 *     `project_id` immutable, and the API enforces this. To "move" a task
 *     to another project, delete it and create a new one.
 *
 * Linked-field behavior:
 *   - Setting status to "Blocked" auto-sets the `blocked` boolean to true.
 *   - Toggling the boolean clears or fills the blocker text consistently.
 *   - Typing into the blocker text auto-flips `blocked` to true (so the
 *     two pieces of state can't fall out of sync from a single user action).
 */

import { useEffect, useState } from "react";

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/tasks/display";
import type {
  Priority,
  Project,
  Task,
  TaskCommentEntry,
  TaskStatus,
} from "@/lib/db";

interface TaskFormModalProps {
  /** Set on edit; null on create. */
  task: Task | null;
  /** All projects available to attach a task to (create-mode picker). */
  projects: Project[];
  /** All tasks (used by the "blocker = task" picker). */
  allTasks?: Task[];
  /** If set, the create-mode project picker is locked to this project. */
  defaultProjectId?: string;
  /** Pre-fill the responsible field on create (used by My Tasks). */
  defaultResponsible?: string;
  /** Distinct responsible values for the responsible-select dropdown. */
  responsibleOptions: string[];
  /**
   * Render every field disabled and hide the Save button — used when
   * the user lacks `tasks.edit` (TASK-13). The modal still opens so
   * Viewers can read full task detail; they just can't change anything.
   */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

interface FormState {
  project_id: string;
  task_name: string;
  detailed_description: string;
  status: TaskStatus;
  priority: Priority;
  responsible: string;
  additional_assignees: string;
  target_date: string;
  /**
   * Time estimate as a string so a half-typed value ("1.") doesn't
   * crash the form. Coerced to number on submit; empty serializes as
   * null.
   */
  estimate_hours: string;
  blocked: boolean;
  blocker_issue_task: string;
  /**
   * Structured blocker fields — null when the task isn't blocked,
   * otherwise classifies what's blocking it. The picker for the
   * `_id` field is shown conditionally based on this value.
   */
  blocker_type: "task" | "project" | "other" | null;
  blocker_task_id: string;
  blocker_project_id: string;
  comments: string;
}

function emptyState(
  defaultProjectId: string | undefined,
  defaultResponsible: string | undefined,
): FormState {
  return {
    project_id: defaultProjectId ?? "",
    task_name: "",
    detailed_description: "",
    status: "Not Started",
    priority: "Medium",
    responsible: defaultResponsible ?? "",
    additional_assignees: "",
    target_date: "",
    estimate_hours: "",
    blocked: false,
    blocker_issue_task: "",
    blocker_type: null,
    blocker_task_id: "",
    blocker_project_id: "",
    comments: "",
  };
}

function fromTask(t: Task): FormState {
  return {
    project_id: t.project_id,
    task_name: t.task_name,
    detailed_description: t.detailed_description,
    status: t.status,
    priority: t.priority,
    responsible: t.responsible,
    additional_assignees: t.additional_assignees.join(", "),
    target_date: t.target_date ?? "",
    estimate_hours: t.estimate_hours === null ? "" : String(t.estimate_hours),
    blocked: t.blocked,
    blocker_issue_task: t.blocker_issue_task,
    blocker_type: t.blocker_type,
    blocker_task_id: t.blocker_task_id ?? "",
    blocker_project_id: t.blocker_project_id ?? "",
    comments: t.comments,
  };
}

const splitList = (v: string) =>
  v
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function toCreatePayload(s: FormState) {
  // Resolve the blocker triple. When `blocked` is false, normalize
  // the type and IDs to null/empty so a stale picker selection from
  // toggling the checkbox off doesn't sneak through.
  const blocker_type = s.blocked ? s.blocker_type : null;
  const blocker_task_id =
    s.blocked && blocker_type === "task" ? s.blocker_task_id : null;
  const blocker_project_id =
    s.blocked && blocker_type === "project" ? s.blocker_project_id : null;
  return {
    project_id: s.project_id,
    task_name: s.task_name.trim(),
    detailed_description: s.detailed_description,
    status: s.status,
    priority: s.priority,
    responsible: s.responsible.trim(),
    additional_assignees: splitList(s.additional_assignees),
    target_date: s.target_date || null,
    // Empty string serializes as null ("not set"); the server validates
    // anything else as a non-negative number ≤ 999.
    estimate_hours: s.estimate_hours.trim() === "" ? null : s.estimate_hours,
    blocked: s.blocked,
    blocker_issue_task: s.blocker_issue_task,
    blocker_type,
    blocker_task_id,
    blocker_project_id,
    comments: s.comments,
  };
}

/**
 * On edit we omit `project_id` because the API rejects reparenting and
 * the form's project picker is read-only anyway. Sending it would
 * round-trip cleanly today, but stripping it makes the contract explicit.
 */
function toUpdatePayload(s: FormState) {
  const p = toCreatePayload(s);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { project_id, ...rest } = p;
  return rest;
}

export function TaskFormModal({
  task,
  projects,
  allTasks,
  defaultProjectId,
  defaultResponsible,
  responsibleOptions,
  readOnly = false,
  onClose,
  onSaved,
}: TaskFormModalProps) {
  const isEdit = task !== null;
  const [state, setState] = useState<FormState>(() =>
    task ? fromTask(task) : emptyState(defaultProjectId, defaultResponsible),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `locked` collapses two reasons we want every input disabled: the
  // server save is in flight (`saving`), or the user has no edit
  // permission (`readOnly`). Pass `locked` everywhere instead of
  // sprinkling `saving || readOnly` across 30+ controls.
  const locked = saving || readOnly;
  // Tabs (Details / Comments) — only meaningful on edit, since
  // comment history doesn't exist before the task is saved. On create
  // we lock to "details" and don't render the tab strip.
  const [tab, setTab] = useState<"details" | "comments">("details");

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

  function handleStatusChange(next: TaskStatus) {
    setState((prev) => ({
      ...prev,
      status: next,
      // Status -> Blocked also flips the boolean. Status leaving Blocked
      // does NOT auto-clear the boolean — a task can still be blocked by
      // a dependency while moving to "On Hold" temporarily.
      blocked: next === "Blocked" ? true : prev.blocked,
    }));
  }

  function handleBlockedToggle(next: boolean) {
    setState((prev) => ({
      ...prev,
      blocked: next,
      // Clearing the boolean clears the blocker text; setting it without
      // text leaves the existing text alone.
      blocker_issue_task: next ? prev.blocker_issue_task : "",
    }));
  }

  function handleBlockerTextChange(text: string) {
    setState((prev) => ({
      ...prev,
      blocker_issue_task: text,
      // Typing into the blocker text auto-marks the task blocked. Empty
      // text doesn't auto-clear, so the user can fix a typo without
      // losing the boolean.
      blocked: text.length > 0 ? true : prev.blocked,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (readOnly) return; // Defense in depth — UI hides the submit button.
    setError(null);
    setSaving(true);

    const url = isEdit ? `/api/tasks/${task!.task_id}` : "/api/tasks";
    const method = isEdit ? "PATCH" : "POST";
    const payload = isEdit ? toUpdatePayload(state) : toCreatePayload(state);

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: Task;
      error?: string;
    };
    setSaving(false);

    if (!res.ok || !data.task) {
      setError(data.error ?? "Could not save task.");
      return;
    }

    onSaved(data.task);
  }

  // The "project locked on create" branch — when the modal was opened
  // from a project's quick view and `defaultProjectId` was supplied.
  const projectIsLocked = !isEdit && Boolean(defaultProjectId);
  // For edit-mode display we want the project's name, not its ID.
  const projectForDisplay = projects.find((p) => p.project_id === state.project_id);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-form-title"
    >
      <div
        className="absolute inset-0 bg-gray-900/30"
        onClick={() => !saving && onClose()}
        aria-hidden="true"
      />
      <form
        onSubmit={handleSubmit}
        className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            padding: "16px 24px",
          }}
        >
          <div>
            {isEdit ? (
              <p
                className="font-mono text-xs font-medium"
                style={{ color: "var(--tm)" }}
              >
                {task!.task_id}
              </p>
            ) : null}
            <h2
              id="task-form-title"
              className="mt-1 text-xl font-semibold tracking-tight"
              style={{ color: "var(--t1)" }}
            >
              {isEdit ? "Edit task" : "New task"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
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

        {/* Tab strip — only on edit. Hidden on create since the
            "Comments" tab body needs a saved task to read history
            from, and we don't want to flash an empty state on a
            new-task flow. */}
        {isEdit ? (
          <nav
            role="tablist"
            aria-label="Task sections"
            className="flex border-b border-gray-200 bg-white px-6"
          >
            {(
              [
                { id: "details", label: "Details" },
                { id: "comments", label: "Comments" },
              ] as const
            ).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  id={`task-tab-${t.id}`}
                  aria-controls={`task-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={
                    active
                      ? "-mb-px border-b-2 border-gray-900 px-4 py-3 text-sm font-semibold text-gray-900"
                      : "-mb-px border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-900"
                  }
                >
                  {t.label}
                  {t.id === "comments" && task!.comment_history.length > 0 ? (
                    <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                      {task!.comment_history.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          {tab === "details" ? (
            <div
              role="tabpanel"
              id="task-panel-details"
              aria-labelledby="task-tab-details"
              className="space-y-5 px-6 py-5"
            >
          {readOnly ? (
            <div role="status" className="pol-notice pol-notice-info">
              <span aria-hidden="true">ⓘ</span>
              <span>Read-only — your role doesn&apos;t allow editing tasks.</span>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="pol-notice pol-notice-err">
              <span aria-hidden="true">!</span>
              <span>{error}</span>
            </div>
          ) : null}

          <Field id="task-project" label="Project" required>
            {isEdit ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700">
                <span className="font-mono text-xs text-gray-500">
                  {state.project_id}
                </span>
                {projectForDisplay ? (
                  <span className="ml-2">{projectForDisplay.name}</span>
                ) : null}
                <p className="mt-1 text-[11px] text-gray-500">
                  A task's project cannot be changed after creation.
                </p>
              </div>
            ) : projectIsLocked ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700">
                <span className="font-mono text-xs text-gray-500">
                  {state.project_id}
                </span>
                {projectForDisplay ? (
                  <span className="ml-2">{projectForDisplay.name}</span>
                ) : null}
              </div>
            ) : (
              <select
                id="task-project"
                required
                value={state.project_id}
                onChange={(e) => update("project_id", e.target.value)}
                disabled={locked}
                className={baseInput}
              >
                <option value="" disabled>
                  Select a project…
                </option>
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.project_id} — {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="task-name" label="Task name" required>
            <input
              id="task-name"
              type="text"
              required
              value={state.task_name}
              onChange={(e) => update("task_name", e.target.value)}
              disabled={locked}
              className={baseInput}
            />
          </Field>

          <Field id="task-desc" label="Detailed description">
            <textarea
              id="task-desc"
              value={state.detailed_description}
              onChange={(e) => update("detailed_description", e.target.value)}
              rows={3}
              disabled={locked}
              className={baseInput}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="task-status" label="Status" required>
              <select
                id="task-status"
                value={state.status}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                disabled={locked}
                className={baseInput}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="task-priority" label="Priority" required>
              <select
                id="task-priority"
                value={state.priority}
                onChange={(e) => update("priority", e.target.value as Priority)}
                disabled={locked}
                className={baseInput}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="task-responsible" label="Responsible">
              <select
                id="task-responsible"
                value={state.responsible}
                onChange={(e) => update("responsible", e.target.value)}
                disabled={locked}
                className={baseInput}
              >
                <option value="">— Select —</option>
                {responsibleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {/* Defensive: preserve a value that's not in the
                    discovered list (e.g. a task whose responsible
                    was set before that user appeared in the
                    aggregated options). Same pattern as the
                    application_product select on the project form. */}
                {state.responsible &&
                !responsibleOptions.includes(state.responsible) ? (
                  <option value={state.responsible}>{state.responsible}</option>
                ) : null}
              </select>
            </Field>

            <Field id="task-target" label="Target date">
              <input
                id="task-target"
                type="date"
                value={state.target_date}
                onChange={(e) => update("target_date", e.target.value)}
                disabled={locked}
                className={baseInput}
              />
            </Field>

            <Field id="task-estimate" label="Estimate (hours)">
              <input
                id="task-estimate"
                type="number"
                value={state.estimate_hours}
                onChange={(e) => update("estimate_hours", e.target.value)}
                disabled={locked}
                className={baseInput}
                min="0"
                max="999"
                step="0.25"
                inputMode="decimal"
                placeholder="e.g. 1.5"
              />
            </Field>
          </div>

          <Field id="task-assignees" label="Additional assignees">
            <input
              id="task-assignees"
              type="text"
              value={state.additional_assignees}
              onChange={(e) => update("additional_assignees", e.target.value)}
              disabled={locked}
              className={baseInput}
              placeholder="Comma-separated names"
            />
          </Field>

          <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <input
                type="checkbox"
                checked={state.blocked}
                onChange={(e) => handleBlockedToggle(e.target.checked)}
                disabled={locked}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
              />
              This task is blocked
            </label>
            {state.blocked ? (
              <div className="mt-3 space-y-3">
                {/* Blocker classification — radio group covers the
                    three options. We store null in state when no
                    radio is picked yet so the form can validate
                    "blocked but unclassified" and surface a hint
                    rather than silently submitting. */}
                <fieldset>
                  <legend className="block text-xs font-medium uppercase tracking-wider text-gray-700">
                    Blocked by
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-900">
                    {(
                      [
                        { id: "task", label: "Another task" },
                        { id: "project", label: "Another project" },
                        { id: "other", label: "Other" },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.id}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="radio"
                          name="task-blocker-type"
                          value={opt.id}
                          checked={state.blocker_type === opt.id}
                          onChange={() => update("blocker_type", opt.id)}
                          disabled={locked}
                          className="h-3.5 w-3.5 border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* Conditional picker. We render task / project
                    pickers as `<select>` not autocomplete, since
                    structured ID selection is the whole point —
                    free-text would defeat the purpose. Each option
                    shows ID + name so the user can find what they
                    need without opening a separate window. */}
                {state.blocker_type === "task" ? (
                  <Field id="task-blocker-task" label="Blocking task">
                    <select
                      id="task-blocker-task"
                      value={state.blocker_task_id}
                      onChange={(e) =>
                        update("blocker_task_id", e.target.value)
                      }
                      disabled={locked}
                      className={baseInput}
                    >
                      <option value="">— Select a task —</option>
                      {(allTasks ?? [])
                        // Don't list self — a task can't block itself.
                        // Don't list closed tasks — they aren't a
                        // realistic blocker. Both filters are
                        // defensive; the service rejects either case.
                        .filter(
                          (t) =>
                            t.task_id !== task?.task_id &&
                            t.status !== "Complete" &&
                            t.status !== "Canceled",
                        )
                        .sort((a, b) =>
                          a.task_id < b.task_id ? -1 : 1,
                        )
                        .map((t) => {
                          const proj = projects.find(
                            (p) => p.project_id === t.project_id,
                          );
                          return (
                            <option key={t.task_id} value={t.task_id}>
                              {t.task_id} — {t.task_name}
                              {proj
                                ? ` (${proj.name})`
                                : ` (${t.project_id})`}
                            </option>
                          );
                        })}
                    </select>
                  </Field>
                ) : null}
                {state.blocker_type === "project" ? (
                  <Field id="task-blocker-project" label="Blocking project">
                    <select
                      id="task-blocker-project"
                      value={state.blocker_project_id}
                      onChange={(e) =>
                        update("blocker_project_id", e.target.value)
                      }
                      disabled={locked}
                      className={baseInput}
                    >
                      <option value="">— Select a project —</option>
                      {projects
                        // Hide the parent project from the list — a
                        // task being blocked by its own project is
                        // semantically nonsense.
                        .filter((p) => p.project_id !== state.project_id)
                        .sort((a, b) =>
                          a.project_id < b.project_id ? -1 : 1,
                        )
                        .map((p) => (
                          <option key={p.project_id} value={p.project_id}>
                            {p.project_id} — {p.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : null}

                {/* Free-text "details" field. Always shown when
                    blocked so the user can add context regardless of
                    classification (a task picker still benefits from
                    "waiting on QA review" detail). */}
                <Field id="task-blocker" label="Blocker details">
                  <input
                    id="task-blocker"
                    type="text"
                    value={state.blocker_issue_task}
                    onChange={(e) =>
                      handleBlockerTextChange(e.target.value)
                    }
                    disabled={locked}
                    className={baseInput}
                    placeholder={
                      state.blocker_type === "other"
                        ? "What's blocking this task?"
                        : "Optional — additional context"
                    }
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <Field id="task-comments" label="Comments">
            <textarea
              id="task-comments"
              value={state.comments}
              onChange={(e) => update("comments", e.target.value)}
              rows={2}
              disabled={locked}
              className={baseInput}
            />
          </Field>
            </div>
          ) : null}

          {tab === "comments" && isEdit ? (
            <div
              role="tabpanel"
              id="task-panel-comments"
              aria-labelledby="task-tab-comments"
              className="space-y-4 px-6 py-5"
            >
              <CommentsTab task={task!} />
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
            {readOnly ? "Close" : "Cancel"}
          </button>
          {readOnly ? null : (
            <button
              type="submit"
              disabled={saving || !state.task_name || !state.project_id}
              className="pol-btn pol-btn-primary"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create task"}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}

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

// ---------------------------------------------------------------------------
// Comments tab
// ---------------------------------------------------------------------------

/**
 * Renders the task's comment_history newest-first. Read-only — new
 * comments are still added via the textarea on the Details tab; this
 * tab is the audit-trail view of past edits, mirroring the project
 * panel's Status tab pattern.
 *
 * The current `comments` value is shown as the "current" entry at
 * the top so users can see the latest text without scrolling through
 * history. Synthetic, not stored.
 */
function CommentsTab({ task }: { task: Task }) {
  const historyNewestFirst = [...task.comment_history].reverse();

  return (
    <>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Current comment
        </p>
        <div className="mt-2 whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {task.comments || (
            <span className="text-gray-400">— no comment —</span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Edit the comment field on the Details tab. Saving appends an
          entry to the history below.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          History
        </h3>
        {historyNewestFirst.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No comment edits recorded yet. Saving a change to the
            Comments field will create the first entry.
          </p>
        ) : (
          <ol className="mt-2 divide-y divide-gray-100 border-y border-gray-100">
            {historyNewestFirst.map((entry, i) => (
              <CommentHistoryRow key={i} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function CommentHistoryRow({ entry }: { entry: TaskCommentEntry }) {
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
    <li className="py-2.5 text-sm">
      <div className="text-xs text-gray-500">
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
            <span className="font-mono text-gray-600">{entry.changed_by}</span>
            {" · "}
          </>
        ) : (
          <>by system · </>
        )}
        <time dateTime={entry.changed_at} title={entry.changed_at}>
          {display}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700">
        {entry.text || (
          <span className="text-gray-400">— cleared —</span>
        )}
      </p>
      {/* Show "previously" only when it's meaningful — first entry
          has previous_text === null and a redundant "previously: —"
          row would just be noise. */}
      {entry.previous_text !== null && entry.previous_text !== "" ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">
          <span className="uppercase tracking-wider">Previously:</span>{" "}
          <span className="text-gray-600">{entry.previous_text}</span>
        </p>
      ) : null}
    </li>
  );
}
