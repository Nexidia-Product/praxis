# Access-control alignment

Aligns the entire app on the Roles & permissions matrix as the single
source of truth for authorization. Every admin and edit affordance —
in the home page, the left nav, the workspace pages, the API routes —
now consults the live permission keys rather than hard-coded role
checks. A change made in **Admin → Roles & permissions** takes effect
immediately, app-wide, without a code change.

---

## Home page rewrite

The home page now renders strictly per the user's permissions:

- **KPI tiles** appear only when the underlying permission is held.
  Empty slots become dashed-border placeholders so the four-column
  grid stays balanced across users with different access (rather than
  shifting tiles around between user views).
- **Quick access** links are filtered per permission key — Projects,
  Tasks, My tasks, Roadmap, Velocity, Ideas. A user with no
  `projects.view` doesn't see the Projects link.
- **Portfolio signals** card hides itself entirely when the viewer
  can't read either projects or tasks (no broken zeros).
- **Administration card** lists every admin tile gated by its specific
  permission. A Project Lead who's been granted only "manage
  templates" via the matrix sees only that one link. A user with no
  admin permissions doesn't see the card at all.
- The card now includes the two new admin pages introduced in earlier
  sweeps: **Roles & permissions** and **Project values**.

The `IdeaRepository.getAll()`, `ProjectRepository.getAll()`, and
`TaskRepository.getAll()` reads are also gated — users without the
relevant `view` permission don't trigger a pointless full-file read.

## API routes migrated to `requirePermission`

21 sites moved from `requireRole(...)` to `requirePermission(...)`:

| API | Old | New |
| --- | --- | --- |
| `/api/admin/custom-fields` (PUT) | `requireRole("Admin")` | `admin.custom_fields.manage` |
| `/api/admin/health-thresholds` (PUT) | `requireRole("Admin")` | `admin.health_thresholds.manage` |
| `/api/admin/health-thresholds/recalculate` (POST) | `requireRole("Admin")` | `admin.health_thresholds.manage` |
| `/api/templates` (POST) | `requireRole("Admin")` | `admin.templates.manage` |
| `/api/templates/[id]` (PATCH/DELETE) | `requireRole("Admin")` | `admin.templates.manage` |
| `/api/ideas` (GET/POST) | `requireRole("Admin", "Project Lead")` | `ideas.review` |
| `/api/ideas/[id]` (PATCH/DELETE) | `requireRole("Admin", "Project Lead")` | `ideas.review` |
| `/api/ideas/[id]/overlap` (POST) | `requireRole("Admin", "Project Lead")` | `ideas.review` |
| `/api/ideas/[id]/convert` (POST) | `requireRole("Admin", "Project Lead")` | `ideas.convert` |
| `/api/projects` (POST) | `requireRole("Admin", "Project Lead")` | `projects.create` |
| `/api/projects/[id]` (PATCH) | `requireRole("Admin", "Project Lead")` | `projects.edit` |
| `/api/projects/[id]` (DELETE) | `requireRole("Admin")` | `projects.delete` |
| `/api/projects/[id]/decisions` (POST) | `requireRole("Admin", "Project Lead")` | `projects.edit` |
| `/api/tasks` (POST) | `requireRole("Admin", "Project Lead", "Team Member")` | `tasks.create` |
| `/api/tasks/[id]` (PATCH) | `requireRole(... three roles)` | `tasks.edit` |
| `/api/tasks/[id]` (DELETE) | `requireRole("Admin", "Project Lead")` | `tasks.delete` |
| `/api/export/pptx` (POST) | `requireSession()` | `roadmap.export` |
| `/api/dashboard/velocity` (GET) | `requireSession()` | `velocity.view` |

## Server pages migrated

Every authenticated page now gates with `requirePermission(...)`
matching what the page reads:

- `/projects` — `projects.view`
- `/tasks`, `/my-tasks` — `tasks.view`
- `/roadmap` — `roadmap.view`
- `/dashboard/velocity` — `velocity.view`
- `/admin/users` — `admin.users.manage`
- `/admin/role-permissions` — `admin.roles.manage`
- `/admin/custom-fields` — `admin.custom_fields.manage`
- `/admin/project-values` — `admin.project_values.manage`
- `/admin/templates` — `admin.templates.manage`
- `/admin/health-thresholds` — `admin.health_thresholds.manage`
- `/admin/ideas`, `/admin/ideas/[id]` — `ideas.review`

## Shell nav now reflects live permissions

Every page that renders the Polaris shell now resolves the user's
permission map server-side via `getCurrentUserPermissions()` and
passes it on the `user.permissions` prop. The shell's nav filter
consults the live map so an Admin who's just been granted
`admin.users.manage` to a Project Lead via the matrix sees that
person's left nav populate the next time they navigate, without a
code change.

## Client components: granular permission props

The big interactive client components now accept a `permissions: Record<string, boolean>`
prop and use it to gate their interactive affordances, with role-only
fallbacks preserved for tests and isolated callers:

- **`<ProjectsTable>`** — `canCreate` (was `canEdit`), `canEdit`,
  `canDelete` are now distinct, driven by `projects.create` / `.edit`
  / `.delete`. The "+ New project" button is bound to `canCreate`
  specifically.
- **`<TasksTable>`** — same split: `canCreate`, `canEdit`, `canDelete`
  driven by the `tasks.*` permissions.
- **`<RoadmapWorkspace>`** — `canEdit` (drag-to-mutate) driven by
  `projects.edit`. New `canExport` driven by `roadmap.export` gates
  the PPTX export button.

This is what fixes the obvious bug where a Project Lead granted
`projects.delete` from the matrix wouldn't actually see the delete
button — the client used to ignore the matrix and decide visibility
from the role alone.

## One documented exception

The "Admin can view another user's individual velocity" check in
`/api/dashboard/velocity` deliberately stays as a hard role check,
not a permission. Cross-user velocity visibility is privacy-sensitive
and shouldn't be delegable to non-Admin roles via the matrix without
explicit thought; if that policy ever changes, introduce a
`velocity.view_others` permission and migrate. The code path carries
a comment explaining the choice so it doesn't read as a missed
migration.

## Files touched

### Pages
- `app/page.tsx` — full rewrite, permission-driven
- `app/projects/page.tsx`, `app/tasks/page.tsx`, `app/my-tasks/page.tsx`,
  `app/roadmap/page.tsx`, `app/dashboard/velocity/page.tsx`,
  `app/profile/notifications/page.tsx` — `requirePermission(...)` +
  `getCurrentUserPermissions()` + `permissions` threaded into Shell
- `app/admin/users/page.tsx`, `app/admin/role-permissions/page.tsx`,
  `app/admin/custom-fields/page.tsx`, `app/admin/project-values/page.tsx`,
  `app/admin/templates/page.tsx`, `app/admin/health-thresholds/page.tsx`,
  `app/admin/ideas/page.tsx`, `app/admin/ideas/[id]/page.tsx` — same

### API routes
- `app/api/admin/custom-fields/route.ts`,
  `app/api/admin/health-thresholds/route.ts`,
  `app/api/admin/health-thresholds/recalculate/route.ts`,
  `app/api/templates/route.ts`, `app/api/templates/[id]/route.ts`,
  `app/api/ideas/route.ts`, `app/api/ideas/[id]/route.ts`,
  `app/api/ideas/[id]/overlap/route.ts`,
  `app/api/ideas/[id]/convert/route.ts`,
  `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`,
  `app/api/projects/[id]/decisions/route.ts`,
  `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`,
  `app/api/export/pptx/route.ts`,
  `app/api/dashboard/velocity/route.ts`

### Components
- `components/projects/projects-table.tsx` — `permissions` prop,
  `canCreate` / `canEdit` / `canDelete` split
- `components/tasks/tasks-table.tsx` — same
- `components/roadmap/workspace.tsx` — `permissions` prop, `canEdit` +
  `canExport`

### Verified
- `npx tsc --noEmit` runs clean.
