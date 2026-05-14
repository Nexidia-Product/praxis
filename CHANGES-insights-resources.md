# Insights → Resources

A new page in the Insights section that replaces the existing
Roadmap → Capacity view with a richer lens on team capacity,
performance, and gaps. Surfaces tasks alongside projects,
introduces a workload-bucket model and a performance score, and
opens a per-resource drill-down.

This sweep delivers Steps 1, 2, and 3 of the four-step plan:
foundation, Overview tab, and the per-resource detail stub plus
admin thresholds editor and soft deprecation. Step 4 (porting the
swim-lane Capacity view into the new tab + adding the Performance
charts tab) lands next.

---

## What you can do today

- Navigate to **Insights → Resources** to see the team roster
  ranked by workload bucket
- Toggle **My team** vs **Everyone** (Everyone disabled for users
  without `resources.view_all`)
- Sort the roster on every column — workload, performance, project
  count, task count, past-due, blocked, last activity
- Click a row to drill into the per-resource detail page with
  hero KPIs and the full project + open-task list
- See "blocking other people" surfaced as a callout on the row
  and a dedicated section on the detail page
- Tune all of the workload weights, bucket boundaries, and
  performance thresholds from **Admin → Resource thresholds**
- Spot resources still referenced as free-text names that need to
  be linked to user accounts (the warning surface flags them on
  both the roster page and the detail page)

The existing **Roadmap → Capacity** sub-tab now shows a
"Capacity has moved" banner pointing here. It still works for
this release.

---

## Architectural pieces

### Resource analytics module — `lib/resources/roster.ts`

Pure analytics. No I/O. The page-level loader does I/O once and
hands data in; the module returns per-resource records.

The roster builder walks projects + tasks once each, accumulates
per-resource state (active projects, open tasks, last activity),
de-duplicates by user_id when resolved or by lower-cased name when
free-text-only, and runs the scoring pass at the end.

`buildUserResolver` — index users by user_id, name (case-
insensitive), and email so a project's `project_lead = "Jane Doe"`
collapses with a task's `responsible = user-jane`. Free-text
names that don't match any user surface as `free_text_only` rows.

`identifyBottleneckTasks` — uses the structured blocker fields
introduced in the tasks sweep. A task `t` makes its responsible
person a bottleneck if some other open task `o` is structurally
blocked on `t.task_id` and `o.responsible !== t.responsible`. Self-
blocks are filtered out — those resolve by working your own queue.

`computeWorkload` — weighted sum:

  score = projects × allocation × complexity_weight
        + open_tasks × priority_weight
        + past_due × priority_weight × past_due_factor
        + bottleneck_count × bottleneck_weight

Sliced by configurable bucket thresholds into Light / Balanced /
Heavy / Overloaded. Per-factor breakdown returned alongside the
score so the UI tooltip can explain the result.

`computePerformance` — population: tasks owned by the resource that
closed inside `performance_window_days` (default 90). Returns the
weighted composite of on-time rate × on_time_weight + (1 − blocked
rate) × blocked_weight, sliced into Green / Yellow / Red. Below the
floor on either axis pulls the bucket down. Returns
`Insufficient` when no completed tasks fall in the window — the UI
shows a dash rather than a misleading 0.

`applyScope` — narrows the roster to "people I lead". The current
user is always included so they see their own load alongside their
team. Project leads matching by user_id OR by name (since older
data may have name strings).

### Schema — `lib/db/types.ts`

`ResourceSettings` interface with workload weights, bucket
thresholds, performance weights, performance thresholds, default
allocation percent, and configurable window days. `DEFAULT_RESOURCE_SETTINGS`
exported for the seed and reset-to-defaults flow. Slotted into
`AppSettings`.

The `default_allocation_percent` field reflects the reality that
nobody on the team is 100% dedicated to projects. Default is 50%;
admins can tune up or down per the team's actual allocation
profile.

A future schema bump will add per-assignment `allocation_percent`
on the project's resource list. That's deferred to Step 4 — for
this sweep every assignment uses the org-wide default, which is
already a meaningful improvement over the existing Capacity view's
"all assignments are equal" assumption.

### Settings repo — `lib/db/settings.ts`

`mergeResourceSettings` field-by-field defensive merger. Mirrors the
`mergeEnumExtensions` philosophy: tolerates a partial / hand-edited
file by falling back per-leaf, so a deployment that hasn't yet
written `resource_settings` to disk reads through to defaults
without crashing.

### Permissions — `lib/auth/role-permissions.ts`

Three new keys added to the catalog and threaded through to the
default role grants:

- `resources.view` — every authenticated role gets it (view the page)
- `resources.view_all` — Admin + Project Lead (lift the "my team"
  scope to Everyone)
- `admin.resource_thresholds.manage` — Admin only (edit settings)

The `DEFAULT_ROLE_PERMISSIONS` and the `DEFAULT_ROLE_PERMISSIONS_SEED`
in `lib/db/settings.ts` were updated together. Existing
deployments pick up the new defaults via the role-permission
normalizer, which adds missing keys at their default state on
every read.

### Page — `app/insights/resources/page.tsx`

Server component. Reads tab and scope from query string so deep
links and back/forward navigation work cleanly. Resolves the
session, loads projects + tasks + public users + settings in
parallel, builds the full roster, applies scope, hands result to
the client workspace.

Defensive coercion: a user without `resources.view_all` who passes
`scope=everyone` via URL is silently coerced back to `my_team`.
Permission gates aren't bypassable by URL.

### Workspace — `components/resources/workspace.tsx`

URL-synced tab strip (Overview / Capacity / Performance), KPI
strip, scope toggle, sortable roster table, free-text-resources
warning surface. Capacity and Performance tabs are placeholder
cards in this sweep — the next sweep fills them in.

The roster table:

- Default sort: workload desc (problems surface first)
- Workload cell — bucket badge (color-toned by severity) + score,
  with a hover tooltip showing the per-factor contribution and
  the bucket boundaries
- Performance cell — Green/Yellow/Red pill, Insufficient dash for
  resources with no completed-task signal in the window
- Past-due / Blocked counts visually flagged when > 0
- Last activity column shows relative time ("Today", "3d ago",
  "2w ago") with full date for older
- Row click → `/insights/resources/[user_id]` for linked users;
  free-text-only rows are not clickable (cursor + opacity hint)

KPI strip surfaces four headline counts: Overloaded resources,
Heavy load resources, Past-due tasks total, Bottleneck tasks
total. Color-toned: red when problems exist, neutral when zero.

### Detail page — `app/insights/resources/[user_id]/page.tsx`

Server component. Builds the same roster, finds the requested row,
404s if unknown. Renders three hero cards (Workload, Performance,
At a Glance), then a project list, then an open-task list with
past-due / blocked visually flagged, then a "Blocking other
people" section when bottlenecks exist.

Project IDs link to `/projects?id=...` and task IDs link to
`/tasks?id=...`. (Those query-param drill-ins exist; the detail
page doesn't need to know whether they pop a quick-view or
navigate to a row — the pages do that.)

### Admin editor — `/admin/resource-thresholds`

Five-section form mirroring the structure of `ResourceSettings`:
default allocation, workload weights, workload buckets, performance
weights, performance thresholds. Each numeric field shows its
default inline so an admin can revert a single field without
resetting the whole form.

Validates client-side as a courtesy; the server re-validates with
the bucket-ordering invariant (light < balanced < heavy) and the
performance-threshold invariant (yellow_min < green_min) enforced
both places.

No "Recalculate now" button — unlike health scores, workload and
performance scores aren't persisted on each resource. They're
computed live every time the Resources page renders. So saving
new thresholds takes effect on the next page load.

### Soft deprecation — Roadmap → Capacity

The existing `<CapacityView>` on the Roadmap workspace now renders
under a "Capacity has moved" notice that links to the new page.
Functionality unchanged for this release; removal in a future
release.

---

## Files touched

### New files
- `lib/resources/roster.ts` — analytics module (~600 lines)
- `app/insights/resources/page.tsx` — Overview server page
- `app/insights/resources/[user_id]/page.tsx` — detail server page
- `components/resources/workspace.tsx` — Overview client (~750 lines)
- `components/resources/detail.tsx` — detail client (~430 lines)
- `app/admin/resource-thresholds/page.tsx` — admin server page
- `components/admin/resource-thresholds-admin.tsx` — admin editor (~600 lines)
- `app/api/admin/resource-thresholds/route.ts` — GET + PUT API

### Modified
- `lib/db/types.ts` — `ResourceSettings` + `DEFAULT_RESOURCE_SETTINGS`;
  slotted into `AppSettings`
- `lib/db/settings.ts` — defensive merger, defaults, seed for new
  permission keys
- `lib/auth/role-permissions.ts` — three new permission keys with
  catalog entries + role grants
- `components/polaris/Shell.tsx` — `resources` and
  `admin-resource-thresholds` NavKey + nav entries
- `components/roadmap/workspace.tsx` — soft-deprecation notice on
  Capacity sub-tab

### Verified
- `npx tsc --noEmit` runs clean.

---

## What's next (Step 4)

- Port `<CapacityView>` into the Resources page's Capacity tab and
  layer tasks onto each row as a density strip below the project
  bars
- Build the Performance tab — throughput / on-time / cycle-time
  charts using recharts (already a dependency for the Velocity
  dashboard)
- Per-assignment `allocation_percent` on the project schema —
  upgrade the Workload calc from "everyone uses default" to per-
  assignment values, with a tiny editor on the project form
- Hard removal of the Roadmap → Capacity sub-tab
- "Available capacity" inverse view — a table of who's lightly
  loaded over the next quarter, ranked by available bandwidth
- A "people who are slipping but not yet failing" surface on the
  Overview — the Yellow-performance band with rising past-due
  counts is the early-warning lens for the Insights tab
