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

import { useEffect, useMemo, useRef, useState } from "react";

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/tasks/display";
import type {
  Priority,
  Project,
  Task,
  KeyFindingEntry,
  TaskCommentEntry,
  TaskDependency,
  TaskDependencyType,
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
  /**
   * When true (edit mode only), the otherwise read-only Project field
   * becomes a destination picker with a "Move" button that reparents the
   * task via POST /api/tasks/[id]/move. Driven by the `tasks.move`
   * permission (Admin / Project Lead) — separate from `tasks.edit` so a
   * Team Member who can edit a task still can't move it.
   */
  canMove?: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void;
  /**
   * Called after an in-place update that should NOT close the modal —
   * e.g. adding a key finding. Refreshes the parent's task data while
   * keeping the panel open. Optional; when absent, such updates are
   * reflected only within the open modal.
   */
  onTaskUpdated?: (task: Task) => void;
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
  /**
   * PM-style task dependencies (FS/SS/FF/SF). Held in form state so
   * the Dependencies tab can add/remove entries and the Save call
   * persists them. Empty array when the task has no predecessors.
   */
  dependencies: TaskDependency[];
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
    dependencies: [],
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
    dependencies: t.dependencies ?? [],
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
    dependencies: s.dependencies,
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
  canMove = false,
  onClose,
  onSaved,
  onTaskUpdated,
}: TaskFormModalProps) {
  const isEdit = task !== null;
  const [state, setState] = useState<FormState>(() =>
    task ? fromTask(task) : emptyState(defaultProjectId, defaultResponsible),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Move-to-project state (edit + `canMove` only). `moveTarget` tracks the
  // destination picker; it starts on the task's current project so the
  // "Move" button stays disabled until the user actually picks a different
  // one. Reparenting is its own request, independent of the form's Save.
  const [moveTarget, setMoveTarget] = useState<string>(task?.project_id ?? "");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  // `locked` collapses two reasons we want every input disabled: the
  // server save is in flight (`saving`), or the user has no edit
  // permission (`readOnly`). Pass `locked` everywhere instead of
  // sprinkling `saving || readOnly` across 30+ controls.
  const locked = saving || readOnly;
  // Tabs (Details / Comments) — only meaningful on edit, since
  // comment history doesn't exist before the task is saved. On create
  // we lock to "details" and don't render the tab strip.
  const [tab, setTab] = useState<
    "details" | "comments" | "findings" | "dependencies"
  >("details");

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

  async function handleMove() {
    if (!isEdit || !canMove || moving) return;
    if (!moveTarget || moveTarget === task!.project_id) return;
    setMoveError(null);
    setMoving(true);

    const res = await fetch(`/api/tasks/${task!.task_id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: moveTarget }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: Task;
      error?: string;
    };
    setMoving(false);

    if (!res.ok || !data.task) {
      setMoveError(data.error ?? "Could not move task.");
      return;
    }

    // The task now lives in another project; hand it back so the parent
    // list reconciles (it also closes the modal).
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
                { id: "findings", label: "Key Findings" },
                { id: "dependencies", label: "Dependencies" },
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
                  {t.id === "findings" && task!.key_findings.length > 0 ? (
                    <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                      {task!.key_findings.length}
                    </span>
                  ) : null}
                  {t.id === "dependencies" &&
                  (task!.dependencies?.length ?? 0) > 0 ? (
                    <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                      {task!.dependencies.length}
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
            {isEdit && canMove ? (
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <ProjectCombobox
                      projects={projects}
                      value={moveTarget}
                      onChange={(id) => {
                        setMoveTarget(id);
                        setMoveError(null);
                      }}
                      disabled={moving}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleMove}
                    disabled={
                      moving ||
                      !moveTarget ||
                      moveTarget === task!.project_id
                    }
                    className="pol-btn pol-btn-secondary whitespace-nowrap"
                  >
                    {moving ? "Moving…" : "Move"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  Moving reassigns this task to another project immediately —
                  it's a separate action from Save.
                </p>
                {moveError ? (
                  <div role="alert" className="pol-notice pol-notice-err">
                    <span aria-hidden="true">!</span>
                    <span>{moveError}</span>
                  </div>
                ) : null}
              </div>
            ) : isEdit ? (
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
              <ProjectCombobox
                projects={projects}
                value={state.project_id}
                onChange={(id) => update("project_id", id)}
                disabled={locked}
              />
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

          {tab === "findings" && isEdit ? (
            <div
              role="tabpanel"
              id="task-panel-findings"
              aria-labelledby="task-tab-findings"
              className="space-y-4 px-6 py-5"
            >
              <KeyFindingsTab
                task={task!}
                readOnly={readOnly}
                onAdded={onTaskUpdated}
              />
            </div>
          ) : null}

          {tab === "dependencies" && isEdit ? (
            <div
              role="tabpanel"
              id="task-panel-dependencies"
              aria-labelledby="task-tab-dependencies"
              className="space-y-4 px-6 py-5"
            >
              <DependenciesTab
                currentTaskId={task!.task_id}
                allTasks={allTasks ?? []}
                projects={projects}
                value={state.dependencies}
                disabled={readOnly || saving}
                onChange={(next) => update("dependencies", next)}
              />
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
// Project combobox (create-mode parent picker)
// ---------------------------------------------------------------------------

/**
 * Searchable single-select for the New Task project parent. Replaces a
 * plain `<select>` so the user can type to filter a long project list.
 *
 * Behavior (TASK requirements):
 *   - options sorted alphabetically by project name;
 *   - Completed / Canceled (closed-out) projects are hidden — you don't
 *     attach new work to finished projects;
 *   - typing filters the list to projects whose name or ID contains the
 *     query (case-insensitive).
 *
 * Keyboard: ↑/↓ move the highlight, Enter selects, Esc closes the list.
 * Esc is stopped from bubbling so it dismisses only the dropdown, not the
 * whole task pane (the modal closes on Escape too).
 */
function ProjectCombobox({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selectable = useMemo(
    () =>
      projects
        .filter(
          (p) =>
            p.status !== "Completed" &&
            p.status !== "Canceled" &&
            p.status !== "Closed",
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
            (a.project_id < b.project_id ? -1 : 1),
        ),
    [projects],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selectable;
    return selectable.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_id.toLowerCase().includes(q),
    );
  }, [selectable, query]);

  const selected = projects.find((p) => p.project_id === value) ?? null;

  // Close on outside click and reset the query so the box shows the
  // selected label again rather than a stale search string.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Keep the highlight in range as the filtered set changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  function choose(p: Project) {
    onChange(p.project_id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        choose(filtered[activeIdx]);
      }
    }
  }

  // When open, the input is a live search box (shows the query). When
  // closed, it displays the chosen project so the field reads as a value,
  // not an empty search.
  const displayValue = open
    ? query
    : selected
      ? `${selected.project_id} — ${selected.name}`
      : "";

  return (
    <div className="relative" ref={ref}>
      <input
        id="task-project"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="task-project-listbox"
        aria-autocomplete="list"
        autoComplete="off"
        // Native required guard for the empty case; the submit button is
        // also disabled until a project_id is set.
        required={!value}
        disabled={disabled}
        value={displayValue}
        placeholder="Search projects…"
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={baseInput}
      />
      {open ? (
        <ul
          id="task-project-listbox"
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-gray-500">
              No matching projects.
            </li>
          ) : (
            filtered.map((p, i) => {
              const isSel = p.project_id === value;
              const active = i === activeIdx;
              return (
                <li
                  key={p.project_id}
                  role="option"
                  aria-selected={isSel}
                  // onMouseDown (not onClick) so selection fires before the
                  // input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex cursor-pointer flex-col rounded px-2 py-1 ${
                    active ? "bg-gray-100" : ""
                  }`}
                >
                  <span className="text-sm text-gray-900">{p.name}</span>
                  <span className="font-mono text-[11px] text-gray-500">
                    {p.project_id}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
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

// ---------------------------------------------------------------------------
// Key Findings tab
// ---------------------------------------------------------------------------

/**
 * Append-only rich-content findings for a task, newest-first.
 *
 * The editor is a contentEditable region so a paste from Word / Excel /
 * another tool keeps its formatting — tables included. On "Add finding"
 * the raw HTML is POSTed to /api/tasks/[id]/key-findings, where it is
 * sanitized server-side; the response carries the updated task, whose
 * (already-sanitized) findings we render back via dangerouslySetInnerHTML.
 * Local state is seeded from the task and updated on add so the list
 * refreshes without closing the panel; `onAdded` (when provided) keeps
 * the parent's task data in sync too.
 */
function KeyFindingsTab({
  task,
  readOnly,
  onAdded,
}: {
  task: Task;
  readOnly?: boolean;
  onAdded?: (task: Task) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [findings, setFindings] = useState<KeyFindingEntry[]>(
    task.key_findings,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);

  // Resync if a fresh task propagates in (e.g. a save elsewhere).
  useEffect(() => {
    setFindings(task.key_findings);
  }, [task.key_findings]);

  const newestFirst = useMemo(() => [...findings].reverse(), [findings]);

  function refreshEmpty() {
    const el = editorRef.current;
    const hasText = !!el && (el.textContent?.trim().length ?? 0) > 0;
    const hasTable = !!el && /<table[\s>]/i.test(el.innerHTML);
    setEmpty(!(hasText || hasTable));
  }

  async function add() {
    const el = editorRef.current;
    if (!el || busy) return;
    const html = el.innerHTML;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.task_id}/key-findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        task?: Task;
        error?: string;
      };
      if (!res.ok || !data.task) {
        throw new Error(data.error ?? "Could not save the key finding.");
      }
      setFindings(data.task.key_findings);
      onAdded?.(data.task);
      el.innerHTML = "";
      setEmpty(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the key finding.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!readOnly ? (
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Add a key finding
          </p>
          <div
            ref={editorRef}
            role="textbox"
            aria-multiline="true"
            aria-label="Key finding content"
            contentEditable={!busy}
            suppressContentEditableWarning
            onInput={refreshEmpty}
            data-placeholder="Paste or type a finding. Formatting and tables from the source are kept."
            className="pol-rich pol-rich-editor mt-2 max-h-72 min-h-[6rem] overflow-auto rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={add}
              disabled={busy || empty}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Add finding"}
            </button>
            <span className="text-[11px] text-gray-500">
              Saved with your name and a timestamp.
            </span>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
            >
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          History
        </h3>
        {newestFirst.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No key findings recorded yet.
          </p>
        ) : (
          <ol className="mt-2 space-y-3">
            {newestFirst.map((f) => (
              <KeyFindingRow key={f.id} finding={f} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function KeyFindingRow({ finding }: { finding: KeyFindingEntry }) {
  const when = new Date(finding.created_at);
  const display = Number.isNaN(when.getTime())
    ? finding.created_at
    : when.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return (
    <li className="rounded-md border border-gray-200 bg-white">
      <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500">
        {finding.created_by_name ? (
          <span className="font-medium text-gray-700">
            {finding.created_by_name}
          </span>
        ) : (
          <span>System</span>
        )}
        <span aria-hidden>·</span>
        <time dateTime={finding.created_at} title={finding.created_at}>
          {display}
        </time>
      </div>
      <div
        className="pol-rich overflow-x-auto px-3 py-2"
        dangerouslySetInnerHTML={{ __html: finding.html }}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Dependencies tab — PM-style FS / SS / FF / SF
// ---------------------------------------------------------------------------

const DEPENDENCY_TYPE_LABELS: Record<TaskDependencyType, string> = {
  FS: "Finish-to-Start",
  SS: "Start-to-Start",
  FF: "Finish-to-Finish",
  SF: "Start-to-Finish",
};

interface DependenciesTabProps {
  currentTaskId: string;
  allTasks: Task[];
  projects: Project[];
  value: TaskDependency[];
  disabled: boolean;
  onChange: (next: TaskDependency[]) => void;
}

function DependenciesTab({
  currentTaskId,
  allTasks,
  projects,
  value,
  disabled,
  onChange,
}: DependenciesTabProps) {
  const [picker, setPicker] = useState<string>("");
  const [type, setType] = useState<TaskDependencyType>("FS");

  // Pre-index tasks for the row display + picker. Excludes the
  // current task (can't depend on self) and any task already listed
  // (no duplicates). Sorted by project then task ID so the picker
  // groups visually.
  const projectsById = new Map(projects.map((p) => [p.project_id, p]));
  const tasksById = new Map(allTasks.map((t) => [t.task_id, t]));
  const alreadyPicked = new Set(value.map((d) => d.predecessor_task_id));
  const candidates = allTasks
    .filter((t) => t.task_id !== currentTaskId && !alreadyPicked.has(t.task_id))
    .sort((a, b) => {
      if (a.project_id !== b.project_id)
        return a.project_id < b.project_id ? -1 : 1;
      return a.task_id < b.task_id ? -1 : 1;
    });

  function addDependency() {
    if (!picker) return;
    onChange([
      ...value,
      { predecessor_task_id: picker, type },
    ]);
    setPicker("");
    setType("FS");
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function changeType(idx: number, next: TaskDependencyType) {
    onChange(value.map((d, i) => (i === idx ? { ...d, type: next } : d)));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600">
        Add predecessor tasks and the relationship type. These are
        planning links — separate from the &ldquo;blocked&rdquo; field on
        Details, which marks a task as currently stuck. Cycles
        (A&nbsp;→&nbsp;B&nbsp;→&nbsp;A) and self-references are
        rejected on save.
      </p>

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
          No dependencies yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((d, i) => {
            const t = tasksById.get(d.predecessor_task_id);
            const project = t ? projectsById.get(t.project_id) : null;
            return (
              <li
                key={`${d.predecessor_task_id}-${i}`}
                className="rounded-md border border-gray-200 bg-white px-3 py-2"
              >
                {/* Row layout: predecessor info on top (full width,
                    truncates), controls on a second line beneath
                    (right-aligned). The previous horizontal layout
                    pushed the type select off-screen on the narrow
                    edit pane (max-w-xl ≈ 576px) the moment a task
                    or project name got long. */}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900">
                    {t ? (
                      <>
                        <span className="font-mono text-xs text-gray-500">
                          {d.predecessor_task_id}
                        </span>{" "}
                        {t.task_name}
                      </>
                    ) : (
                      <span className="text-red-700">
                        {d.predecessor_task_id} (not found)
                      </span>
                    )}
                  </div>
                  {project ? (
                    <div className="truncate text-xs text-gray-500">
                      {project.project_id} — {project.name}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center justify-end gap-2">
                  <select
                    value={d.type}
                    onChange={(e) =>
                      changeType(i, e.target.value as TaskDependencyType)
                    }
                    disabled={disabled}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
                    aria-label="Dependency type"
                  >
                    {(
                      Object.keys(DEPENDENCY_TYPE_LABELS) as TaskDependencyType[]
                    ).map((k) => (
                      <option key={k} value={k}>
                        {k} — {DEPENDENCY_TYPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    disabled={disabled}
                    aria-label={`Remove dependency on ${d.predecessor_task_id}`}
                    className="text-xs font-medium text-gray-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {disabled ? null : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-700">
            Add dependency
          </div>
          <div className="mt-2 flex items-center gap-2">
            <TaskPicker
              candidates={candidates}
              projectsById={projectsById}
              value={picker}
              onChange={setPicker}
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TaskDependencyType)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              aria-label="Type"
            >
              {(Object.keys(DEPENDENCY_TYPE_LABELS) as TaskDependencyType[]).map(
                (k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ),
              )}
            </select>
            <button
              type="button"
              onClick={addDependency}
              disabled={!picker}
              className="pol-btn pol-btn-secondary"
            >
              Add
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            FS &mdash; Finish-to-Start (most common). SS, FF, SF available
            from the type dropdown next to each row after adding.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Searchable single-select for the predecessor-task picker. Replaces a
 * plain <select> so a long task list can be typed to filter (by task ID,
 * task name, or project). Keyboard: ↑/↓ move the highlight, Enter
 * selects, Esc closes the list (stopped from bubbling so it dismisses
 * only the dropdown, not the whole task pane).
 */
function TaskPicker({
  candidates,
  projectsById,
  value,
  onChange,
}: {
  candidates: Task[];
  projectsById: Map<string, Project>;
  value: string;
  onChange: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((t) => {
      const project = projectsById.get(t.project_id);
      const hay = `${t.task_id} ${t.task_name} ${
        project ? `${project.project_id} ${project.name}` : ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, projectsById, query]);

  const selected = candidates.find((t) => t.task_id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  function choose(t: Task) {
    onChange(t.task_id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[activeIdx]) choose(filtered[activeIdx]);
      else setOpen(true);
    }
  }

  function labelFor(t: Task): string {
    const project = projectsById.get(t.project_id);
    return `${t.task_id} — ${t.task_name}${
      project ? ` (${project.project_id})` : ""
    }`;
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-left text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        aria-label="Predecessor task"
      >
        <span className={`truncate ${selected ? "" : "text-gray-400"}`}>
          {selected ? labelFor(selected) : "Select a predecessor task…"}
        </span>
        <span aria-hidden className="text-gray-400">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search tasks…"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No matches.</li>
            ) : (
              filtered.map((t, i) => {
                const project = projectsById.get(t.project_id);
                return (
                  <li key={t.task_id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => choose(t)}
                      className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-sm ${
                        i === activeIdx ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-mono text-[11px] text-gray-500">
                          {t.task_id}
                        </span>{" "}
                        {t.task_name}
                      </span>
                      {project ? (
                        <span className="text-[11px] text-gray-400">
                          {project.project_id} — {project.name}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
