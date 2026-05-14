# Admin project type and Admin Application/Product

Adds a built-in **Admin** value to two of the project dimensions:

- **Project Type:** `Admin` is now a fifth choice alongside *New
  Application*, *New Feature*, *New Prototype*, and *Enhancement*.
- **Application / Product:** `Admin` is now a built-in default — the
  first system value this dropdown has ever shipped with. (Other
  Application/Product values still live in `settings.json` as admin-
  curated extensions.)

Admin-classified work is for **internal team cadence** — governance,
operational tooling, audit and compliance work, vendor admin, recruiting
loops, and other things that affect delivery but aren't themselves a
delivery project. So the new value does **not** behave the same as the
existing types and applications: Admin work is **excluded from the
Roadmap and the Velocity dashboard**.

The full Projects page, Tasks page, My Tasks page, and Idea-conversion
form all show Admin work normally — that's where this work lives day to
day. The exclusion is scoped to the two views where mixing Admin work
with portfolio work would dilute the signal.

---

## Where it shows up

### Where Admin appears

- **New / edit project** — `Admin` in the Project Type dropdown and
  `Admin` in the Application/Product dropdown.
- **New / edit task** — same Application/Product dropdown picks it up
  via the merged enum option list.
- **Idea → convert to project** — same dropdowns; an idea about an
  internal initiative can be promoted to an Admin-typed project.
- **Projects page** filter chips include Admin so admins can scope to
  their own ops backlog.
- **Admin Console → Project values → Application / Product** lists
  Admin as a locked system value; admins can still add their own custom
  Application/Product values on top.

### Where Admin is hidden

- **Roadmap** — all four views (Timeline, Kanban, Bubble, Now/Next/Later).
  - The page filters Admin projects out at the server before the
    workspace loads, so cards, bars, and bubbles never appear.
  - The Type filter dropdown shows only the four portfolio types — no
    "Admin" chip to toggle.
  - The Kanban "Group by Project Type" config option uses the portfolio
    list, so an empty Admin column never renders.
  - PPTX exports inherit the same filter (the export route reads from
    the workspace's already-filtered project list).
- **Velocity & Throughput dashboard.**
  - The API drops Admin-classified projects and their tasks before any
    metric runs.
  - The Project Type filter chips show only the four portfolio types.
  - The "average time by type" breakdown iterates the portfolio list,
    so no zero-sample-size Admin row appears.
  - `filter_options` returned to the dashboard exclude `Admin` from
    both `project_types` and `application_products`, so the dropdowns
    never offer an Admin option even via direct URL.

### What still includes Admin

- Resources page (`/insights/resources`), which now owns the Capacity
  view exclusively — intentionally unchanged. The point of that page
  is showing where people's time goes, and time spent on internal
  admin work is part of that picture. If the team later decides Admin
  should also be hidden there, it's a one-line change at the page's
  project read.

---

## How the exclusion is wired

**One predicate, one chokepoint per view.**

```ts
// lib/projects/display.ts
export function isAdminProject(p: {
  project_type: string;
  application_product: string;
}): boolean {
  return (
    p.project_type === "Admin" || p.application_product === "Admin"
  );
}
```

A project counts as Admin work if **either** field is `Admin`. The
"either" rule is intentional: a team may classify the same piece of
work via type or via product depending on how it slots into their
workflow, and the goal of the exclusion is to drop the work either way
rather than leak through one path.

| View | Where the filter runs |
| --- | --- |
| Roadmap (all four views + PPTX) | `app/roadmap/page.tsx` — server-side filter on the project list before it reaches the workspace |
| Velocity dashboard (all metrics) | `app/api/dashboard/velocity/route.ts` — filters projects + parented tasks before `computeVelocityMetrics` runs |

The metrics layer itself (`lib/velocity/metrics.ts`) does **not**
inspect `isAdminProject`. The exclusion lives at the API boundary, not
the metric layer. If the policy ever changes (e.g. "show Admin work in
Velocity but in its own group"), it's a one-place edit.

---

## New exports

```ts
// lib/projects/display.ts
export const PROJECT_TYPES: ProjectType[] = [
  "New Application",
  "New Feature",
  "New Prototype",
  "Enhancement",
  "Admin",          // ← new
];

export const PORTFOLIO_PROJECT_TYPES: ProjectType[] =
  PROJECT_TYPES.filter((t) => t !== "Admin");

export const SYSTEM_APPLICATION_PRODUCTS: string[] = ["Admin"];

export const ADMIN_PROJECT_TYPE: ProjectType = "Admin";
export const ADMIN_APPLICATION_PRODUCT = "Admin";

export function isAdminProject(p: { ... }): boolean { ... }
```

- `PROJECT_TYPES` — the full list, used by the Project / Task / Idea
  forms and the Projects page filter.
- `PORTFOLIO_PROJECT_TYPES` — `PROJECT_TYPES` minus Admin. Used by the
  Roadmap and Velocity filter dropdowns and by the velocity by-type
  breakdown.
- `SYSTEM_APPLICATION_PRODUCTS` — built-in Application/Product values.
  Currently just `["Admin"]`. Read by `lib/projects/enum-options.ts`
  to seed the system options that merge with admin-added extensions.
- `ADMIN_PROJECT_TYPE` / `ADMIN_APPLICATION_PRODUCT` — named constants
  so the exclusion logic doesn't depend on a magic string.
- `isAdminProject(p)` — the one predicate the page filters and tests
  agree on.

---

## Files changed

| File | What changed |
| --- | --- |
| `lib/db/types.ts` | `"Admin"` added to the `ProjectType` union. |
| `lib/projects/display.ts` | `PROJECT_TYPES` includes `"Admin"`; new exports `PORTFOLIO_PROJECT_TYPES`, `SYSTEM_APPLICATION_PRODUCTS`, `ADMIN_PROJECT_TYPE`, `ADMIN_APPLICATION_PRODUCT`, `isAdminProject()`. |
| `lib/projects/service.ts` | Imports `PROJECT_TYPES` from the canonical list (was a local copy). |
| `lib/tasks/template-service.ts` | Imports `PROJECT_TYPES` from the canonical list (was a local copy). |
| `app/api/templates/route.ts` | Imports `PROJECT_TYPES` from the canonical list (was a local copy). |
| `components/admin/templates-admin.tsx` | Imports `PROJECT_TYPES` from the canonical list (was a local copy). |
| `scripts/seed.ts` | Derives its `PROJECT_TYPES` validation set from the canonical list. |
| `lib/projects/enum-options.ts` | `SYSTEM_APP_OPTIONS` seeds from `SYSTEM_APPLICATION_PRODUCTS` instead of `[]`, so `Admin` appears as a locked `source: "system"` entry in every Application/Product dropdown. |
| `components/admin/project-values-editor.tsx` | Application/Product tab description updated to mention the new built-in. |
| `app/roadmap/page.tsx` | Server filters projects with `isAdminProject(p)` before passing them to `RoadmapWorkspace`. All five roadmap views and PPTX exports inherit the exclusion. |
| `components/roadmap/filter-bar.tsx` | Type dropdown uses `PORTFOLIO_PROJECT_TYPES`. |
| `lib/roadmap/fields.ts` | Kanban "Group by Project Type" column values use `PORTFOLIO_PROJECT_TYPES`. |
| `app/api/dashboard/velocity/route.ts` | Query-string validation uses `PORTFOLIO_PROJECT_TYPES`. Admin projects + their tasks dropped before `computeVelocityMetrics` runs. |
| `lib/velocity/metrics.ts` | `by_type` breakdown iterates `PORTFOLIO_PROJECT_TYPES`; `filter_options.project_types` returns the portfolio list. |
| `components/velocity/filter-bar.tsx` | Project type chips use `PORTFOLIO_PROJECT_TYPES`. |
| `scripts/smoke-admin-exclusion.ts` | New smoke test (42 checks) covering the predicate, the constants relationship, the system option, end-to-end velocity exclusion, **and the project service's create path with Admin values in either or both fields**. |
| `package.json` | `npm run smoke:admin-exclusion` added. |

---

## Follow-up: validation copies in five places

The first cut of this change added `"Admin"` to the canonical
`PROJECT_TYPES` list in `lib/projects/display.ts` and assumed every
consumer read from there. They didn't — five files shipped their own
hardcoded copy of the list:

- `lib/projects/service.ts` — the project create/update validator.
- `lib/tasks/template-service.ts`
- `app/api/templates/route.ts`
- `components/admin/templates-admin.tsx`
- `scripts/seed.ts`

The first one was the user-visible bug: creating a project with type
`Admin` returned **"project_type must be one of: New Application, New
Feature, New Prototype, Enhancement."** because the service-layer
validator never consulted the canonical list.

All five now import `PROJECT_TYPES` from `lib/projects/display.ts`
instead of defining a local copy. Adding a future type is now genuinely
a one-file change. The new smoke test calls `createProject` with
`project_type: "Admin"`, with `application_product: "Admin"`, and with
both — so a regression that re-introduces a local copy fails loudly in
CI.

---

## Tests

- `npm run typecheck` — clean.
- `npm run smoke:admin-exclusion` — 42 checks pass. Locks in:
  - `isAdminProject` matches type, product, both, neither, and is
    case-sensitive.
  - `PROJECT_TYPES` and `PORTFOLIO_PROJECT_TYPES` differ by exactly one
    element (`Admin`).
  - The Application/Product enum option list ships `Admin` as
    `source: "system"`, alongside any admin-added extensions.
  - When the API filter is applied, completed-by-quarter, by-type,
    task throughput, and `filter_options` all exclude Admin work.
  - Without the API filter, the metrics layer **still** doesn't expose
    an Admin row in `by_type` — proving the iteration over
    `PORTFOLIO_PROJECT_TYPES` is a second line of defense.
  - **The project service's `createProject` accepts `project_type:
    "Admin"`, `application_product: "Admin"`, and both at once.**
    Locks in the validation-layer fix described in "Follow-up" below.
- All existing smokes (`db`, `projects`, `tasks`, `roadmap`, `export`,
  `decisions`, `notifications`, `health`, `velocity`, `ideas`,
  `template`) still pass — the additions don't change any existing
  contract.

---

## Notes for upgrade

- **No data migration required.** Existing projects keep their
  current `project_type` and `application_product` values; nothing is
  rewritten. New Admin work is created with the new values.
- **No settings migration required.** The `Admin` Application/Product
  is a built-in system option, not a stored extension. Existing
  `settings.json` files don't need to change.
- **Existing dropdowns** automatically pick up the new value the next
  time they render — no rebuild or settings edit needed.
- If you don't want `Admin` available in the Application/Product
  dropdown, you can't archive it from the Admin Console (system
  options aren't archivable). The intended way to opt out is to never
  set the value on a project; it'll just sit unused.
