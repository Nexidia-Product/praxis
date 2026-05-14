# Admin section consolidation

The Admin nav had nine items, each its own page. That was getting
unwieldy and the items had no IA logic — Resource thresholds and
Health thresholds sat side by side despite belonging to different
problem domains; Users sat next to Custom fields despite having
nothing to do with each other.

This sweep collapses Admin to **four nav items**, each a tabbed page
that follows the same pattern Roadmap uses (and the Insights →
Resources page already follows): a single nav link, a tab strip
underneath, the active tab in the URL.

## The new groupings

| Nav link | Tabs | Permission per tab |
| --- | --- | --- |
| **Resource management** | Users / Roles & permissions / Resource thresholds | `admin.users.manage` / `admin.roles.manage` / `admin.resource_thresholds.manage` |
| **Configuration** | Custom fields / Project values / Portfolio quadrants / Health thresholds | `admin.custom_fields.manage` / `admin.project_values.manage` / `admin.portfolio_quadrants.manage` / `admin.health_thresholds.manage` |
| **Templates** | (no tabs — same single-page editor as before) | `admin.templates.manage` |
| **Notifications** | (no tabs — same single-page panel as before) | `admin.notifications.run_sweep` |

**Why these groupings.** Resource management is everything about the
*people* using the app — who has accounts, what each role is allowed
to do, how their workload is bucketed. Configuration is everything
about the *shape of the data model* — what fields exist, what values
those fields can take, what the bubble chart's quadrant labels read,
and the thresholds that drive health scoring. Templates and
Notifications are big enough to stand alone and don't have natural
siblings.

## Permission gating

A user with permission for **only one** of the underlying tabs still
sees the consolidated nav link — the destination page hides the tabs
they can't access and lands them on the first allowed one. A user with
**none** of the underlying permissions doesn't see the nav link at all.

Concretely, three cases the code handles:

1. **A Project Lead with `admin.users.manage` granted by the matrix.**
   Sees the "Resource management" link. Lands on `/admin/resources` →
   Users tab is the only one visible. Roles and Thresholds tabs
   aren't even rendered.

2. **A user with no admin permissions.** Sees no Admin nav section
   at all (nav filtering catches this; the page itself would 403 if
   they typed the URL directly).

3. **A user who deep-links to `/admin/resources?tab=roles` without
   `admin.roles.manage`.** Lands on the page (because they have at
   least one of the three permissions), gets coerced to the first
   tab they're allowed (Users, in the typical case). No 403 — they
   reached the page legitimately, just landed on a tab that doesn't
   apply to them.

A new helper `requireAnyPagePermission(permissions[])` enforces (1)
and (3) at the page level; the workspace components handle the
in-page tab filtering.

## Backwards compatibility

All seven legacy admin URLs (`/admin/users`, `/admin/role-permissions`,
`/admin/resource-thresholds`, `/admin/custom-fields`,
`/admin/project-values`, `/admin/portfolio-quadrants`,
`/admin/health-thresholds`) **still work**. Each is now a one-line
server component that calls `redirect()` to the matching tab on the
new page. Bookmarks survive; chat-shared links survive.

The destination page does its own permission gating, so a user
without the underlying permission ends up at the same /403 outcome
they would have hit on the legacy page.

## What didn't change

- **Underlying admin components** (`UsersAdminPanel`,
  `RolePermissionsEditor`, `ResourceThresholdsAdmin`,
  `CustomFieldsAdmin`, `ProjectValuesEditor`, `PortfolioQuadrantsAdmin`,
  `HealthThresholdsAdmin`). Each is reused as-is under the new
  tabbed pages. This sweep is pure routing/IA, not behavior.
- **Permission keys.** The seven `admin.*.manage` permissions still
  exist with the same defaults. The matrix at `/admin/resources?tab=roles`
  shows them in the same Administration category as before.
- **API routes.** `/api/admin/users`, `/api/admin/role-permissions`,
  etc. are untouched — they're orthogonal to page IA.
- **`/admin/templates` and `/admin/notifications`.** Their URLs and
  pages stay exactly as they were. They're intentionally not
  consolidated with anything else.
- **`/admin/ideas`.** That's the Ideas Review queue and lives under
  Insights, not Admin — left alone.

## Files changed

### New files

| File | Purpose |
| --- | --- |
| `lib/auth/permissions.ts` (added `requireAnyPagePermission`) | Page-level "any of these permissions or 403" helper |
| `components/admin/resource-management-workspace.tsx` | Three-tab client workspace |
| `components/admin/configuration-workspace.tsx` | Four-tab client workspace |
| `app/admin/resources/page.tsx` | New consolidated Resource management page |
| `app/admin/configuration/page.tsx` | New consolidated Configuration page |

### Updated

| File | What changed |
| --- | --- |
| `components/polaris/Shell.tsx` | `NavKey` union pruned (7 leaf keys → 2 group keys); `NavItem` extended with `permissionsAny?` for "any of these permissions"; admin nav section reduced from 9 items to 4. |
| `app/page.tsx` | Home admin tile rebuilt around the four group links; `can` object updated to mirror the four groups (closes a pre-existing gap where Resource thresholds / Portfolio quadrants / Notifications had no tile). |
| `components/roadmap/bubble-view.tsx` | "Edit quadrant labels" link points at `/admin/configuration?tab=portfolio-quadrants`. |
| `components/projects/form-modal.tsx` | Allocation help text reads "Admin → Resource management → Resource thresholds." |
| `components/projects/quick-view.tsx` | Custom-field orphan warning reads "Admin → Configuration → Custom fields." |
| `components/users-admin-panel.tsx` | Doc comment updated to reflect new home (Resource management → Users). |
| `app/insights/resources/page.tsx` | Subtitle updated to "Admin → Resource management → Resource thresholds." |
| `app/403/page.tsx` | Help text reads "Admin → Resource management → Roles & permissions." |

### Replaced with redirect stubs

Each of these previously held a full page component; now contains a
~10-line `redirect()` call to the corresponding tab on the new page.

| Legacy URL | Redirects to |
| --- | --- |
| `/admin/users` | `/admin/resources?tab=users` |
| `/admin/role-permissions` | `/admin/resources?tab=roles` |
| `/admin/resource-thresholds` | `/admin/resources?tab=thresholds` |
| `/admin/custom-fields` | `/admin/configuration?tab=custom-fields` |
| `/admin/project-values` | `/admin/configuration?tab=project-values` |
| `/admin/portfolio-quadrants` | `/admin/configuration?tab=portfolio-quadrants` |
| `/admin/health-thresholds` | `/admin/configuration?tab=health-thresholds` |

## Tests

- `npm run typecheck` — clean.
- All 12 smoke scripts still pass; counts unchanged from the previous
  sweep (`smoke:roadmap` 89, `smoke:velocity` 88, `smoke:export` 69,
  `smoke:admin-exclusion` 42, etc.). This sweep adds no new smoke
  test of its own — the routing/IA changes are exercised by the
  permission helpers (which have type-level guarantees) and by the
  underlying admin components (which have the same behavior they had
  before; they're just rendered under tabs now).

## Notes for upgrade

- **No data migration required.** No schema, settings, or seed
  changes.
- **No permission changes.** All seven `admin.*.manage` keys still
  behave the same way; no role defaults moved.
- **External bookmarks.** All legacy URLs redirect server-side. A
  user bookmarking `/admin/users` lands on
  `/admin/resources?tab=users` on the next click — same content,
  same data, one extra hop on the server.
- **Permission matrix labels.** The Roles & permissions page still
  groups the seven keys under "Administration." This sweep didn't
  re-categorize them — that's a UI label question, separate from
  whether the underlying URLs cluster.
