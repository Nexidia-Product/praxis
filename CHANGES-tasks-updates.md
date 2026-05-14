# Tasks updates

Major sweep across the tasks subsystem: schema migration, structured
blocker classification, comment-history audit trail, drawer-style
edit pane, inline priority edits, expanded status-group toggle,
template batch-apply for Admin / Project Lead, and a few smaller
polish items.

---

## New Task

### `Open` renamed to `Not Started`

Status enum updated everywhere — types, display, validation, seed
script, scheduler, notification copy, JSON data files. The status
label change is purely cosmetic; functionality is unchanged.

A one-time data migration was applied to `data/tasks.json` and
`data/seed/tasks.json`: 20 records on each side flipped from `"Open"`
→ `"Not Started"`.

The task form modal's default state for a new task is now
`"Not Started"`. The notification preference copy ("still Open or In
Progress") was updated to match.

The "Open" labels still in use — projects-table and tasks-table
StatusGroup toggles, the ideas review filter — are intentional
*bucket* labels, not status values, and are left alone.

### Responsible field is a real `<select>`

The input + `<datalist>` pattern (which rendered as Edge's native
autocomplete popup) was replaced with a regular `<select>` matching
Status, Priority, and the project-form Application/Product. The
defensive "preserve unknown current value" branch keeps any
existing responsible value selectable even if it's not in the
discovered list.

### Structured blocker classification

The blocker UI used to be a single free-text "Blocker details" input.
It now branches three ways:

- **Another task** — radio choice surfaces a `<select>` of all open
  tasks, formatted "TASK-ID — Name (Project)" so the user can find
  what they need without context-switching. Self-task is filtered
  out; closed tasks are filtered out.
- **Another project** — surfaces a `<select>` of all projects,
  formatted "PROJECT-ID — Name", with the parent project filtered
  out (a task being blocked by its own project is semantically
  nonsense).
- **Other** — keeps the free-text input only.

The free-text "Blocker details" field is kept regardless of the
classification — task / project pickers still benefit from a "waiting
on QA review" annotation.

Schema additions on `Task`: `blocker_type` (`"task" | "project" |
"other" | null`), `blocker_task_id` (`TaskId | null`),
`blocker_project_id` (`ProjectId | null`). Validated by a new
`shapeBlockerClassification` helper in the service; existence checks
verify the referenced task / project exists; self-blocking rejected.

When `blocked` flips off, `toCreatePayload` zeroes the structured
fields so a stale picker selection never reaches the server.

### Apply template — Admin and Project Lead only

A new "+ From template" button on the tasks-page toolbar opens a
small modal: pick a project, pick a template, submit. The template
picker filters by the selected project's `project_type` and shows an
empty state when there's no match. Each template item creates one
fresh task under the project, assigned to the project lead, status
`"Not Started"`.

Wired through a new endpoint:

  POST /api/projects/[id]/apply-template
  Body: { template_id: string }

Permission: `tasks.create` AND role is Admin or Project Lead — the
role check sits on top of the permission so widening
`tasks.create` to a Team Member via the matrix doesn't accidentally
expose this bulk-create affordance.

The toast on success ("3 tasks created from Standard Onboarding")
auto-clears after 5s; errors stick in the page-level banner.

---

## Tasks page

### Priority is inline-editable

The Priority cell now renders as a `<select>` chip when `canEdit` is
true, matching the existing inline Status edit. Optimistic update
with revert on failure (same shape as `changeStatus`). Keeps the
chip's color via `TASK_PRIORITY_BADGE` so the visual is identical to
the read-only span.

### Status-group toggle gained Blocked and Past Due

The toggle row was just `Open / Closed / All`. It's now `Open /
Blocked / Past due / Closed / All`, with each badge counting tasks
via `statusGroupMatches(group, task, today)`:

- **Blocked** — `task.blocked || task.status === "Blocked"`, excluding
  closed tasks. Both signals are OR'd so a desynced legacy record
  still surfaces.
- **Past due** — `target_date < today` AND task is still open.

Counts are honest about overlap — a Past-Due Blocked task counts in
both badges plus Open. Selecting a tab applies the same predicate as
a filter on the visible list.

`statusGroupMatches` replaces the old `statusGroupTest`; the visible
filter now reads the full task plus today's date so `past_due` can
classify correctly. Recomputes when `today` updates (windows-on-focus
listener).

### Color coding on task status

The `TASK_STATUS_BADGE` palette was updated to mirror the
project-page palette:

- `Not Started` — gray (matches projects)
- `In Progress` — emerald
- `Blocked` — red
- `Complete` — saturated emerald
- `Canceled` — strikethrough gray

Same look as the projects page.

### Click anywhere on a row opens edit

Previously only the task-name button opened the edit modal. The whole
row now has `onClick={() => onEdit()}` and the cells with their own
controls (status, priority, actions) use `stopPropagation` so opening
a dropdown or clicking the trash icon doesn't *also* open the edit
pane. The task-name `<button>` is now plain text since the row itself
is the click target.

### Edit pane is a right-side drawer

The form modal was rewritten from a centered `max-w-2xl` modal to a
right-side drawer (`fixed inset-0 z-30 flex justify-end` + `<aside>`-
style `flex h-full w-full max-w-xl flex-col bg-white shadow-xl`).
Same shell shape as the project quick-view drawer.

Header restyled to match (font-mono task ID + bold title, 24px
padding). The body is wrapped in a flex-1 scroll region so the
footer's Save / Cancel sit pinned at the bottom regardless of body
height.

---

## Edit Task panel

Items 1 (blocker classification) and 2 (Responsible select) are the
same as the New Task changes above — same component. The new piece:

### Comments tab with audit-trail history

A tab strip (Details | Comments) sits below the header on edit. The
Details tab is the existing form. The Comments tab (new) renders:

- **Current comment** at the top — read-only display of the live
  `task.comments` value, with a hint pointing the user back to the
  Details tab to edit.
- **History** below — newest-first list of `TaskCommentEntry` rows.
  Each row shows the actor's display name, a localized timestamp
  (precise ISO available via tooltip), the new text, and a
  "Previously: …" line when there was prior text.

Schema additions on `Task`: `comment_history: TaskCommentEntry[]`.
Each entry stores `changed_at`, `text`, `previous_text`,
`changed_by`, and `changed_by_name` — same denormalization pattern as
project status history so the trail stays readable if a user is
later renamed or removed.

Service writes a new entry inside `updateTask` whenever
`patch.comments !== existing.comments`. No-op saves don't pollute
the trail. Repository's `withDefaults` backfills `comment_history:
[]` on every read so older records don't crash the panel.

Tab strip is hidden on create — a new task has no history to show
yet, and flashing an empty state on the new-task flow would be
noise.

The tab order (Details first, Comments second) mirrors the project
panel's pattern exactly: details, then audit-trail tabs.

---

## Files touched

### Schema & data
- `lib/db/types.ts` — `TaskStatus` enum migrated; `Task` gained
  `blocker_type`, `blocker_task_id`, `blocker_project_id`,
  `comment_history`; new `TaskCommentEntry` interface
- `lib/db/tasks.ts` — `withDefaults` backfill on every read path;
  create / update persist new fields
- `data/tasks.json`, `data/seed/tasks.json` — one-time backfill
  applied (20 + 20 records)
- `lib/tasks/display.ts` — status enum migrated; `TASK_STATUS_BADGE`
  palette updated to match project page

### Service
- `lib/tasks/service.ts` — `TASK_STATUSES` constant migrated;
  `TaskCreatePayload` and `TaskUpdatePayload` widened with the three
  blocker fields; `shapeBlockerClassification` helper added with
  existence + self-block guards; `comment_history` append in
  `updateTask`; `UserRepository` import + `resolveUserDisplayName`
  helper; `instantiateTemplate` updated for new fields and renamed
  status default
- `lib/notifications/scheduler.ts` — `ACTIVE_TASK_STATUSES`
  migrated

### API
- `app/api/projects/[id]/apply-template/route.ts` — new endpoint
  gated by `tasks.create`

### Pages
- `app/page.tsx` — task counts use `"Not Started"`
- `app/tasks/page.tsx` — loads templates and threads to
  `<TasksTable>`

### Components
- `components/tasks/form-modal.tsx` — drawer rewrite; Tab strip
  (Details / Comments); Responsible → real `<select>`; structured
  blocker UI (radio + conditional task / project picker); state +
  payload converters extended; `CommentsTab` + `CommentHistoryRow`
  components added; `allTasks` and `TaskCommentEntry` props /
  imports
- `components/tasks/tasks-table.tsx` — `TaskTemplate` import;
  `templates` prop; `applyTemplateBatch` handler with auto-clearing
  toast; `ApplyTemplateModal` component; status-group toggle
  expanded with Blocked / Past due; `statusGroupMatches` predicate
  replacing `statusGroupTest`; `statusCounts` extended; row-click
  edit + `stopPropagation` on interactive cells; inline priority
  edit + `changePriority` handler; `canApplyTemplate` role-gated
  alongside `tasks.create`; pass `allTasks` to `<TaskFormModal>`
- `components/notifications/preferences-form.tsx` — copy updated
  for renamed status

### Scripts
- `scripts/seed.ts` — `TASK_STATUSES` set migrated; new fields added
  to task literal
- `scripts/smoke-db.ts`, `scripts/smoke-export.ts`,
  `scripts/smoke-health.ts`, `scripts/smoke-notifications.ts`,
  `scripts/smoke-tasks.ts`, `scripts/smoke-velocity.ts` — `"Open"` →
  `"Not Started"` everywhere; new fields added to Task literals
  (full-record literals only — `createTask` payload literals don't
  carry `comment_history` since the repo initializes it)

### Verified
- `npx tsc --noEmit` runs clean.
