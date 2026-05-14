# Project values changes

Adds runtime-configurable values for the four project dimensions admins
asked about: **Status**, **Phase**, **Priority**, and
**Application/Product**. New entries can be added, renamed, archived
(soft-hidden), and deleted from the Admin Console without a code change
or redeploy.

---

## Where to find it

- **Admin → Project values** — new nav item under the Admin section.
- **Path:** `/admin/project-values`
- **Required permission:** `admin.project_values.manage` (default Admin only).

Four tabs (one per enum). Each tab shows:

- **System values (locked)** — the built-in values that ship with the
  app. Locked because the application's filtering, health-scoring,
  sorting, and reporting branch on them. Renaming "In Progress" or
  "Critical" would break those code paths, so we don't allow it.
- **Editable rows** for any extensions an Admin has added: label, ID,
  per-enum metadata, archive toggle, delete button.
- **Add form** at the bottom for a new value. The ID is auto-derived
  from the label and overrideable.

---

## What gets stored vs. what stays in code

| Layer | Where it lives | Editable? |
| --- | --- | --- |
| Built-in values (eight statuses, nine phases, four priorities) | Code constants in `lib/projects/display.ts` | No |
| Built-in semantics (which statuses are "open", priority ranks, phase order) | Code constants in `lib/projects/enum-options.ts` | No |
| Admin-added extensions | `settings.json → enum_extensions` | Yes — from the matrix |

The `enum_extensions` shape is one array per enum key, each entry
carrying:
- `id` — immutable; what's actually stored on Project records.
- `label` — editable; what users see in dropdowns and badges.
- `archived` — soft-delete; hidden from new dropdowns, preserved on
  records that already use it.
- per-enum metadata (e.g. `is_open` / `is_terminal` for status,
  `rank` for priority, `order` for phase).

When an Admin adds a priority "Urgent" with rank `0.5`, it sorts
between Critical (rank 0) and High (rank 1). When they add a phase
"Beta" with order `4.5`, it slots between "Application Development"
(4) and "Customer Validation" (5). Status extensions can flag whether
they count as "open" (visible in the default Projects-page filter) or
"terminal" (close out the project).

## Why the type stayed a union, not bare string

The four enum types (`ProjectStatus`, `ProjectPhase`, `Priority`,
`ProjectType`) are now declared as
`"<literal>" | "<literal>" | ... | (string & {})`. The `(string & {})`
trick is the standard way to keep auto-complete on the literals while
accepting arbitrary strings. Code that branches on a specific built-in
(e.g. `health.ts` checking `status === "Blocked"`, `service.ts`
checking `status === "Completed"`) keeps narrowing correctly, because
those literals are still members of the union.

New code that needs to enumerate the runtime list — dropdowns, filter
bars, sorters — should call `getEnumOptions(...)` or
`mergeEnumOptions(...)` from `lib/projects/enum-options.ts` instead of
iterating the constant arrays.

## Badge fallback

`STATUS_BADGE[admin.added.status]` returns `undefined` because the
record only has entries for built-in keys. New `statusBadgeClass()` and
`priorityBadgeClass()` helpers return a neutral fallback class for
unknown values, so admin-added statuses get a clean badge instead of a
broken-style render. Every consumer that previously did
`STATUS_BADGE[p.status]` has been migrated to the helper:

- Projects table (inline status edit + status badge cell)
- Project quick-view (status dropdown + status/priority badges)
- Dependency chain panel and dependency editor
- Roadmap views: timeline (bar color), capacity (assignment color),
  now/next/later (card color), kanban (priority chip)

The roadmap legend block in timeline-view intentionally still
enumerates only the built-in statuses, since growing it dynamically
with admin extensions would clutter what's meant to be a quick
orientation aid.

## Application/Product

This dimension has no built-in values — the system ships with an empty
list and admins own every entry. The table autocomplete still
back-fills from distinct values discovered across existing project
records (so you don't have to pre-populate before importing data),
but admin-curated values appear at the top of the autocomplete list
in their declared order.

## Permissions

A new permission key, `admin.project_values.manage`, was added to the
catalog and granted to Admin by default. Like every other
`admin.*` permission, it can be granted to other roles from the
**Admin → Roles & permissions** matrix if needed.

## API

- `GET /api/admin/project-values` — returns the merged option lists
  (system + extensions, including archived) and the raw extension
  entries so the editor can present "edit" controls only for
  extensions.
- `PUT /api/admin/project-values` — replaces `settings.enum_extensions`
  wholesale. Validates each entry (non-empty `id` and `label`, unique
  IDs within an enum, no shadowing system IDs, type-checked metadata)
  and rejects the entire payload on any failure.

## Files changed

### New
- `lib/projects/enum-options.ts` — central merge/sort/validate helpers
- `app/admin/project-values/page.tsx` — server page, gated by the new permission
- `app/api/admin/project-values/route.ts` — GET / PUT
- `components/admin/project-values-editor.tsx` — four-tab matrix editor

### Modified
- `lib/db/types.ts` — added `EnumExtension`, `EnumExtensionsMap`, `ExtensibleEnumKey`, `enum_extensions` field on AppSettings; broadened the four enum types to `(string & {})` superset
- `lib/db/settings.ts` — seeds default `enum_extensions`, defensive merge for the field
- `lib/auth/role-permissions.ts` — added `admin.project_values.manage` to the catalog
- `lib/projects/display.ts` — added `statusBadgeClass()` and `priorityBadgeClass()` with a neutral fallback class
- `app/projects/page.tsx` — loads merged options, passes them to the table
- `app/admin/ideas/[id]/page.tsx` — same, for idea conversion
- `components/projects/projects-table.tsx` — accepts `enumOptions` prop, runtime priority-rank sort, merged dropdowns, badge helpers
- `components/projects/form-modal.tsx` — accepts merged options, archived-current-value safety, dropdowns wired
- `components/projects/filter-bar.tsx` — accepts merged options, multi-selects wired
- `components/projects/quick-view.tsx` — accepts `statusOptions`, badge helpers
- `components/projects/dependency-chain-panel.tsx`, `dependency-editor.tsx` — badge helpers
- `components/ideas/conversion-form.tsx`, `review-panel.tsx` — accept and forward merged options
- `components/roadmap/{capacity,now-next-later,timeline,kanban}-view.tsx` — badge helpers
- `components/polaris/Shell.tsx` — added "Project values" nav entry

### Verified
- `npx tsc --noEmit` runs clean.
