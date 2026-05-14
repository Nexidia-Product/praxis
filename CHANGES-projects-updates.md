# Projects updates

Polishes the create/edit flow, the projects table, and the quick-view
panel. Adds a `status_history` audit trail end-to-end (schema → repo →
service → UI) so the panel's new Status tab can show "who flipped this
to Blocked, when, and from what".

---

## New Project / Edit Project (form modal)

### Application/Product is now a real `<select>`

It used to be an `<input list="…">` paired with a `<datalist>`, which
rendered as Edge's native autocomplete popup — visually inconsistent
with the rest of the form. Now it's a regular `<select>` that
matches Status, Phase, Priority, and Type.

The option list still combines admin-curated values from **Admin →
Project values** with values discovered in the existing dataset, so
the auto-discovery behavior is preserved. A defensive guard keeps the
project's current value selectable even if it's been archived out of
the curated list — reopening the form on an older record won't
silently drop the value.

Added a small helper line under the field pointing users at
`/admin/project-values` so it's clear where new values come from.

### Template picker always visible on create

It used to disappear silently when no templates matched the selected
project type. The picker is now unconditionally rendered on create. If
the matching list is empty, the field shows a clear empty-state with a
link to **Admin → Templates**, so the user understands the option
exists and can act on it. The picker stays hidden on edit (templates
only apply at creation time).

The end-to-end wiring already existed — `template_id` flows through
the create payload, and the service layer instantiates the template
on save. This change just makes the affordance discoverable.

---

## Projects page

### Phase and Priority are inline-editable on the panel

The quick-view panel's Details tab previously rendered Phase and
Priority as static text. Both are now `<select>` controls matching the
chrome of the existing inline Status edit. Each fires an optimistic
PATCH; if the server rejects, state reverts and the error surfaces in
the page-level banner.

The new handlers (`changePhase`, `changePriority`) share a generic
`patchField` helper that mirrors the existing `changeStatus` pattern
so the fetch / revert / surface-error plumbing isn't duplicated.

Both selects keep a defensive "preserve archived value" branch — if an
admin archives a phase or priority value that's still in use on a
project, the dropdown still shows it as a selectable option so it
isn't silently overwritten on next save.

### Checkboxes removed from the projects table

The select-all-and-bulk-edit affordance was dropped per the requirement.
Row-click → open quick-view stays. The full removal includes:

- The `selected` / `bulkBusy` state
- The `toggleAll` / `toggleOne` / `bulkUpdate` / `allVisibleSelected`
  helpers
- The `<BulkActionBar>` + `<BulkLeadInput>` components and their props
  interface
- The "X selected" footer suffix
- The checkbox header column and the per-row checkbox cell
- The "selected row" background highlight

Multi-row edits aren't recoverable through the inline single-row
controls, so the file's top-of-file doc comment now flags that the
bulk affordance is gone — if it's wanted again, a multiselect-via-
shift-click pattern or batch-edit endpoint would be the path.

### Resources column added between Lead and Target

`additional_resources` is now visible at a glance without opening the
panel. The cell renders the values comma-joined, truncated to a
`max-w-[12rem]` with `truncate`, with the full list available as a
hover tooltip via the cell's `title=` attribute. Renders "—" when
empty.

The column is rendered as a plain `<th>` rather than a sortable `<Th>`
because `additional_resources` is a list — sorting by it would be
ambiguous (sort by length? first element? alphabetical join?). Sorting
by Lead is still available adjacent to it.

---

## Individual project panel (quick-view drawer)

Items 1 and 2 (Phase / Priority editable) are covered by the same
inline-edit work above, since the panel and the Details tab are the
same component. Item 3 (Status tab with history) is new:

### Status history schema

A new `StatusHistoryEntry` type lives in `lib/db/types.ts`:

```ts
interface StatusHistoryEntry {
  changed_at: IsoTimestamp;
  status: ProjectStatus;
  previous_status: ProjectStatus | null;
  changed_by: UserId | null;
  changed_by_name: string | null;
}
```

`changed_by_name` is denormalized (the actor's display name at the
time of the change) so the history stays readable if a user is later
renamed or removed. `changed_by` is `null` for system-driven updates
(cron, migrations).

`Project.status_history` is the on-record array, append-only.

### Repository backfill

`lib/db/projects.ts` now applies a `withDefaults` pass on every read
path (`getAll` and `getById`) so older records without
`status_history` don't crash the panel. The defaulting is applied
again before merging in `update`, so the next legitimate write
persists the empty array — no separate migration pass needed.

A one-time JSON backfill was applied to `data/projects.json` and
`data/seed/projects.json` so on-disk records also match the schema.

### Service-layer append

`lib/projects/service.ts` `updateProject` now detects status flips by
comparing the proposed patch against the pre-update record and
appends a fresh `StatusHistoryEntry` to `patch.status_history` when
the value changes. The actor's display name is resolved via
`UserRepository.getById` through a small `resolveUserDisplayName`
helper that handles "system", lookup misses, and exceptions silently.

The userId is already plumbed from the API route → service via
`ctx.userId`, so no API-level wiring change was needed.

### Status tab in the panel

A new "Status" tab sits between Details and Decisions. Its body is a
local `StatusTab` component with two sections:

1. **Current status** — primary editor with the same chrome as the
   inline status select. Same `defensive-preserve` pattern for
   archived values.
2. **History** — newest-first list of `StatusHistoryEntry` rows. Each
   row renders "Previous → New" as colored status badges, the actor's
   display name (with fallbacks to UserId / "system"), and a
   localized timestamp. Hovering the timestamp reveals the precise
   ISO string for log correlation.

The reverse-on-read pattern (`[...arr].reverse()`) keeps the on-disk
shape monotonically growing while displaying newest-first.

A synthetic "no changes recorded yet" empty state covers projects
that were created and never had their status touched.

---

## Files touched

### Schema & data layer
- `lib/db/types.ts` — `StatusHistoryEntry`; `Project.status_history`
- `lib/db/projects.ts` — `withDefaults` backfill on read; persist on
  create / update
- `data/projects.json`, `data/seed/projects.json` — one-time backfill

### Service
- `lib/projects/service.ts` — append on status flip;
  `resolveUserDisplayName`; `UserRepository` + `StatusHistoryEntry`
  imports

### Components
- `components/projects/form-modal.tsx` — Application/Product → select;
  template picker always visible on create with empty-state link;
  `Link` import added
- `components/projects/projects-table.tsx` — `changePhase` /
  `changePriority` handlers and `patchField` generic; ProjectPhase
  import; quick-view wiring (`onPhaseChange` / `onPriorityChange` /
  `phaseOptions` / `priorityOptions`); Resources column header + cell;
  full removal of bulk-action machinery (state, handlers, components,
  interface, footer suffix, checkbox column, row checkbox, selected
  highlight); doc comment updated; unused imports dropped
- `components/projects/quick-view.tsx` — props extended for phase /
  priority change handlers and option lists; Phase + Priority inline
  edits in Details tab; new "Status" tab; `StatusTab` and
  `StatusHistoryRow` local components; unused badge imports dropped
- `components/roadmap/workspace.tsx` — pass `onPhaseChange` /
  `onPriorityChange` to `<ProjectQuickView>` via the existing
  generic `handleUpdateField` patcher

### Scripts (Project literals updated)
- `scripts/seed.ts`, `scripts/smoke-decisions.ts`,
  `scripts/smoke-export.ts`, `scripts/smoke-roadmap.ts`,
  `scripts/smoke-velocity.ts` — `status_history: []` added

### Verified
- `npx tsc --noEmit` runs clean.
