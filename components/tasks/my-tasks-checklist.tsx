"use client";

/**
 * My Tasks → "Checklist" mode (Section 5.3).
 *
 * A single, manually-orderable list of the user's OPEN tasks, meant to be
 * worked top-to-bottom like a checklist. Drag a row by its grip to move it;
 * tick the checkbox to complete it; click the body to open the full task.
 *
 * Ordering:
 *   - `savedOrder` (task IDs) seeds the list once; the user's drag edits are
 *     held in local `order` state and pushed up via `onReorder` (which the
 *     parent persists per-user).
 *   - Tasks not present in `order` (e.g. created since the last save) are
 *     appended at the BOTTOM in creation order, so a brand-new task always
 *     lands last.
 *   - IDs in `order` that are no longer open are ignored on render; the next
 *     reorder persists a cleaned list.
 *
 * Selection & drag:
 *   - Each row has a selection checkbox. Select one or more rows (Shift-click
 *     for a range) and drag any selected row to move the whole group to a
 *     specific spot; they insert contiguously, preserving their order.
 *   - Dragging an unselected row moves just that row (selection untouched).
 *   - Native HTML5 drag (no library): the dragged row(s) dim to 40%, and the
 *     row under the pointer shows an insertion line above/below depending on
 *     which half the cursor is over.
 */

import { useMemo, useState } from "react";

import { TASK_PRIORITY_BADGE, TASK_STATUS_BADGE } from "@/lib/tasks/display";
import type { Project, Task } from "@/lib/db";

interface MyTasksChecklistProps {
  /** The user's open tasks (parent filters to open statuses). */
  tasks: Task[];
  projects: Project[];
  /** Saved manual order (task IDs); seeds the list. */
  savedOrder: string[];
  canEdit: boolean;
  /** Called with the full displayed order after a drag. Parent persists it. */
  onReorder: (orderedIds: string[]) => void;
  /** Mark a task complete (parent does the API call + state update). */
  onComplete: (task: Task) => void;
  /** Open the full task form. */
  onOpen: (task: Task) => void;
}

/**
 * Order for tasks not yet in the saved manual order: creation time
 * ascending so the newest task sinks to the very bottom. Falls back to
 * task ID (which is roughly creation-ordered) for ties.
 */
function byCreationOrder(a: Task, b: Task): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.task_id < b.task_id ? -1 : 1;
}

/**
 * Move `dragIds` (one or many, in their current display order) to the
 * position indicated by `overId` / `pos`, inserting them contiguously.
 * Dropping in empty space or onto one of the dragged rows appends them.
 */
function computeOrder(
  ids: string[],
  dragIds: string[],
  overId: string | null,
  pos: "before" | "after",
): string[] {
  const dragSet = new Set(dragIds);
  const moving = ids.filter((id) => dragSet.has(id)); // preserve display order
  const without = ids.filter((id) => !dragSet.has(id));
  if (overId === null || dragSet.has(overId)) {
    return [...without, ...moving];
  }
  const idx = without.indexOf(overId);
  if (idx === -1) return [...without, ...moving];
  const insertAt = pos === "after" ? idx + 1 : idx;
  without.splice(insertAt, 0, ...moving);
  return without;
}

export function MyTasksChecklist({
  tasks,
  projects,
  savedOrder,
  canEdit,
  onReorder,
  onComplete,
  onOpen,
}: MyTasksChecklistProps) {
  // Manual order, seeded once from the saved order. Drag edits live here and
  // are pushed up via onReorder; we don't re-seed from props so an in-flight
  // save can't yank the list around.
  const [order, setOrder] = useState<string[]>(savedOrder);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<"before" | "after">("before");
  // Multi-select for group moves.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.project_id, p);
    return m;
  }, [projects]);

  // Display order: known-ordered tasks first, then any new tasks appended
  // at the bottom in creation order.
  const displayTasks = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.task_id, t]));
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const id of order) {
      const t = byId.get(id);
      if (t) {
        out.push(t);
        seen.add(id);
      }
    }
    const extras = tasks
      .filter((t) => !seen.has(t.task_id))
      .sort(byCreationOrder);
    return [...out, ...extras];
  }, [tasks, order]);

  function toggleSelect(taskId: string, shiftKey: boolean) {
    const idsInOrder = displayTasks.map((t) => t.task_id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedId && lastSelectedId !== taskId) {
        const a = idsInOrder.indexOf(lastSelectedId);
        const b = idsInOrder.indexOf(taskId);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(idsInOrder[i]);
          return next;
        }
      }
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
    setLastSelectedId(taskId);
  }

  function clearSelection() {
    setSelected(new Set());
    setLastSelectedId(null);
  }

  function handleDrop() {
    if (draggingIds.length === 0) return;
    const ids = displayTasks.map((t) => t.task_id);
    const next = computeOrder(ids, draggingIds, overId, overPos);
    setOrder(next);
    onReorder(next);
    setDraggingIds([]);
    setOverId(null);
  }

  if (displayTasks.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-500">
        No open tasks. Nothing to check off — nice.
      </p>
    );
  }

  return (
    <div>
      {canEdit && selected.size > 0 ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
          <span>
            {selected.size} selected — drag any selected row to move them
            together.
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="font-medium text-gray-700 underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </div>
      ) : null}

      <ol
        className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
        onDragOver={(e) => {
          // Allow dropping in the empty space below the last row (append).
          if (!canEdit || draggingIds.length === 0) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop();
        }}
      >
        {displayTasks.map((t) => {
          const project = projectsById.get(t.project_id) ?? null;
          const isDragging = draggingIds.includes(t.task_id);
          const isSelected = selected.has(t.task_id);
          const showLineBefore =
            overId === t.task_id && overPos === "before" && !isDragging;
          const showLineAfter =
            overId === t.task_id && overPos === "after" && !isDragging;
          return (
            <li
              key={t.task_id}
              draggable={canEdit}
              onDragStart={(e) => {
                if (!canEdit) return;
                // Drag the whole selection when the grabbed row is part of
                // it; otherwise just this row.
                const ids =
                  isSelected && selected.size > 0
                    ? displayTasks
                        .map((d) => d.task_id)
                        .filter((id) => selected.has(id))
                    : [t.task_id];
                e.dataTransfer.setData("text/plain", ids.join(","));
                e.dataTransfer.effectAllowed = "move";
                setDraggingIds(ids);
              }}
              onDragEnd={() => {
                setDraggingIds([]);
                setOverId(null);
              }}
              onDragOver={(e) => {
                if (!canEdit || draggingIds.length === 0) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggingIds.includes(t.task_id)) {
                  setOverId(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                setOverId(t.task_id);
                setOverPos(after ? "after" : "before");
              }}
              className={`relative flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 ${
                isDragging
                  ? "opacity-40"
                  : isSelected
                    ? "bg-blue-50"
                    : "hover:bg-gray-50"
              }`}
            >
              {/* Insertion indicator */}
              {showLineBefore ? (
                <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gray-900" />
              ) : null}
              {showLineAfter ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gray-900" />
              ) : null}

              {/* Selection checkbox — for multi-select group moves. */}
              {canEdit ? (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    /* handled in onClick to read the shift key */
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(t.task_id, e.shiftKey);
                  }}
                  aria-label={`Select ${t.task_id} to move`}
                  title="Select to move (Shift-click for a range)"
                  className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-1 focus:ring-blue-500"
                />
              ) : null}

              {/* Grip */}
              <span
                aria-hidden="true"
                title={canEdit ? "Drag to reorder" : undefined}
                className={`select-none text-base leading-none text-gray-300 ${
                  canEdit ? "cursor-grab" : ""
                }`}
              >
                ⠿
              </span>

              {/* Complete checkbox */}
              <input
                type="checkbox"
                checked={false}
                disabled={!canEdit}
                onChange={() => onComplete(t)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Mark ${t.task_id} complete`}
                title="Mark complete"
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
              />

              {/* Body — click to open */}
              <button
                type="button"
                onClick={() => onOpen(t)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {t.task_name}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${TASK_PRIORITY_BADGE[t.priority]}`}
                  >
                    {t.priority}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${TASK_STATUS_BADGE[t.status]}`}
                  >
                    {t.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                  <span className="truncate">
                    <span className="font-mono text-gray-400">
                      {t.project_id}
                    </span>
                    {project ? ` · ${project.name}` : ""}
                  </span>
                  {t.target_date ? (
                    <span className="shrink-0">· due {t.target_date}</span>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
