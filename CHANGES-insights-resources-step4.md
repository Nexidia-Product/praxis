# Insights → Resources, Step 4

The fourth and final sweep on Insights → Resources. Brings the
Capacity and Performance tabs to life, makes per-assignment
allocations a real schema concept, and exposes a small editor for
them on the project form.

This sweep builds directly on the foundation, Overview, detail page,
admin thresholds, and soft deprecation work shipped in Steps 1-3.

---

## What's new

### Capacity tab — swim-lane Gantt + task density

The Capacity tab now renders a swim-lane Gantt scoped to the same
roster the Overview surfaces, with a task density strip layered
under each row.

- Granularity toggle (weeks / months / quarters)
- Color-by toggle (project / priority / status)
- First-fit lane packing for overlapping assignments — same algorithm
  the existing Roadmap → Capacity uses so visual density matches
- A thin strip below each row's project bars shows that resource's
  open tasks at their `target_date` positions, color-coded:
    - Green dot = open task
    - Orange dot = past-due task
    - Red dot = blocked task
- A workload-bucket chip next to each resource name carries over the
  same Light / Balanced / Heavy / Overloaded coloring from the
  Overview so scanning the swim lanes immediately shows who's hot
- Filter input narrows the view by name; legend at the bottom

The view reads tasks from the same roster the page already
loaded — nothing extra is fetched. Dates are projected against the
shared time-window math in `lib/roadmap/dates.ts` (reused as-is).

### Performance tab — per-resource throughput, on-time, cycle time

The Performance tab is a comparison lens across the team, with a
team-summary row at top and one card per resource in a responsive
auto-fill grid.

Team summary:
- Resources active (with ≥1 completion in the window)
- Tasks completed
- Team on-time average
- Median cycle time

Per-resource card:
- Performance pill (Green / Yellow / Red, computed against the
  admin-configured thresholds)
- Three mini-stats: Completed, On-time %, Median cycle days
- Throughput sparkline (per ISO week)
- Cycle-time distribution histogram with dynamic bucket count
  (Sturges-ish: `Math.min(8, Math.max(3, ceil(sqrt(n))))`)

Sortable by completed / on-time / cycle-time / name. Filterable by
name. Default sort: most completions first, since the most-active
resources are usually the most interesting comparison points.

**Charts are pure SVG**, matching the Velocity & Throughput dashboard's
approach. No chart-library dependency added — `Sparkline` and
`Histogram` are small, hand-rolled components in
`components/resources/performance-tab.tsx`. They're accessibility-
friendly (`role="img"`, `aria-label`, per-element `<title>`) and the
empty / single-point cases render gracefully.

### Per-assignment `allocation_percent`

The biggest schema change in the sweep. Previously, every project
assignment counted equally toward a resource's workload — they all
used the org-wide `default_allocation_percent`. Now each project
carries a `resource_allocations: Record<string, number>` map keyed
by the same names / user_ids in `additional_resources` and
`project_lead`. Missing keys still fall back to the org-wide default.

This is non-breaking: the existing `additional_resources: string[]`
field is unchanged. The new field is purely additive. A project
that never touches the new editor sees no difference in its
workload numbers, because every resource resolves to the same
default it always did.

The resolver tries user_id, then user.name, then the original
display string — so a project that lists "Jane Doe" gets the same
allocation lookup whether the resource resolved to a real user
account or stayed free-text.

Where it shows up:
- `lib/db/types.ts` — `resource_allocations` field on `Project`
- `lib/db/projects.ts` — defensive backfill on every read
  (`withDefaults`)
- `lib/projects/service.ts` — `validateResourceAllocations` helper
  plumbed into both create and update paths
- `lib/resources/roster.ts` — `lookupAllocationPercent` and the
  updated `computeWorkload` per-project allocation lookup
- Project-form editor (see below)

### Project-form allocations editor

A small inline section on the project create/edit form, right
below the "Additional resources" field:

- Derives the resource list from `project_lead + additional_resources`
  (deduplicated by trimmed string)
- Two-column grid of rows; each row has the resource name and a
  numeric percent input
- Empty input means "use the default" — no value forced; placeholder
  text says "default" so admins know what's implicit
- Empty state when no resources are listed yet ("Add a project lead
  or additional resources above…") so the editor doesn't appear out
  of nowhere
- Form state holds the values as strings during edit (so a
  half-typed value doesn't crash) and coerces back to numbers on
  save via `numberifyAllocations`

The server-side `validateResourceAllocations` is the source of
truth — it rejects out-of-range or non-numeric values with the
offending key in the error message. Empty strings are treated as
"delete this key" so clearing a field removes the override and lets
the org-wide default apply at read time.

---

## Files

### New
- `components/resources/capacity-tab.tsx` — swim-lane Gantt with
  task density strip (~480 lines)
- `components/resources/performance-tab.tsx` — per-resource
  performance dashboard with hand-rolled SVG charts (~600 lines)

### Modified
- `lib/db/types.ts` — `resource_allocations` field on `Project`
- `lib/db/projects.ts` — defensive `withDefaults` backfill
- `lib/projects/service.ts` — `validateResourceAllocations` helper +
  create/update plumbing
- `lib/resources/roster.ts` — `lookupAllocationPercent` helper,
  `computeWorkload` signature change, `buildPerformanceSeries`
  (new exported function for the Performance tab)
- `components/resources/workspace.tsx` — wires CapacityTab and
  PerformanceTab into the tab switch; PlaceholderTab removed
- `app/insights/resources/page.tsx` — calls `buildPerformanceSeries`
  and passes the result through to the workspace
- `components/projects/form-modal.tsx` — `resource_allocations`
  threaded through `FormState`/`fromProject`/`toPayload`, plus the
  inline `AllocationsEditor` sub-component
- `data/projects.json`, `data/seed/projects.json` — backfilled
  `resource_allocations: {}` on all 7 records each
- `scripts/{seed,smoke-db,smoke-decisions,smoke-export,smoke-health,smoke-roadmap,smoke-velocity}.ts`
  — `resource_allocations: {}` added to every Project literal (13
  entries across 7 scripts)

### Verified
- `npx tsc --noEmit` runs clean
- `smoke-db`, `smoke-roadmap`, `smoke-velocity` all pass

---

## Decisions worth flagging

### Soft deprecation stays on Roadmap → Capacity for now

The Step 1-3 plan included "hard removal" of the Roadmap → Capacity
sub-tab as the final step. Holding off for at least one release —
the new view ships behind a banner pointing here, but the old view
remains live as a fallback. We'll cut it once we've seen the new
tab work in practice and confirmed nothing on the existing dashboard
relied on the old data shape.

### Performance pill weights are hardcoded on the per-card view

The Overview's roster carries the canonical performance bucket,
computed with the admin-configured `performance_weights` from
`ResourceSettings`. The Performance tab's per-card pill recomputes
locally with hardcoded 0.6/0.4 weights to avoid threading the
weights prop through every card. The bucket boundaries (`green_min`
/ `yellow_min`) still respect admin config; only the weighting is
pinned. Close enough for visual signal, and the Overview is the
authoritative scoreboard. A future refactor can pass the weights
down if we ever want full parity.

### recharts is not a dependency

Earlier draft of the Performance tab imported recharts assuming the
Velocity dashboard pulled it in. It doesn't — the Velocity dashboard
deliberately uses pure SVG. The Performance tab follows the same
pattern with `Sparkline` and `Histogram` components. Less code,
zero deps, consistent house style.

### Per-assignment allocation kept as a separate map

Considered changing `additional_resources: string[]` to
`additional_resources: Array<{name: string, allocation: number}>`.
Decided against it — it would touch every read site of that field
across the codebase. The map shape is non-breaking and lets the
two arrays evolve independently (e.g., changing a resource's name
doesn't lose their allocation; resetting an allocation doesn't
change who's on the project).

---

## What's next (post-Step 4)

- Hard removal of the Roadmap → Capacity sub-tab once the new view
  is field-proven
- "Available capacity" inverse view — a table of who's lightly
  loaded over the next quarter, ranked by available bandwidth
- Drill-down from a Performance tab card to the per-resource detail
  page (currently the Overview row click is the only entry)
- Persisted historical workload and performance scores so a
  resource's trend line over time is available, not just the
  snapshot
