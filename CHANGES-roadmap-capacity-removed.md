# Capacity removed from the Roadmap

The Roadmap had five views: Timeline, Kanban, Bubble (Portfolio),
Now / Next / Later, and Capacity. The same Capacity view also lived
on the Insights → Resources page (with task density and per-resource
detail layered on top). Two homes for the same view confused the
mental model and produced two answers to "where is the capacity view?"

This sweep deletes the Roadmap copy. **The Roadmap now has four views.**
**Capacity lives only on `/insights/resources`.**

This is the "hard removal" that prior sweeps deferred — see
`CHANGES-insights-resources.md` (which introduced the soft "Capacity has
moved" banner) and `CHANGES-insights-resources-step4.md` (which built
the richer Resources Capacity tab and explicitly punted the Roadmap-side
removal to a later sweep).

---

## What changed in the UI

### Roadmap (`/roadmap`)

- **Tab strip:** four tabs — Timeline, Kanban, Portfolio, Now / Next /
  Later. The Capacity tab is gone.
- **Page subtitle:** "Five lenses…" → "Four lenses on the same
  portfolio: timeline, board, scatter, and horizons."
- **Include-closed-projects toggle** is now shown only on Timeline and
  Bubble (no behavioral change — Capacity was the only other view that
  hid the toggle, and it's gone).

### Home page (`/`)

- The Roadmap quick-access tile now says **"Four views over the same
  portfolio: Timeline, Kanban, Portfolio bubble chart, and Now / Next /
  Later."**

### Roles & Permissions

- The `roadmap.view` permission description now reads **"Open the
  Timeline, Kanban, Bubble Chart, and Now/Next/Later views."** No
  permission semantics changed; only the description.

### PPTX export

- The slide picker no longer offers "Capacity / Resources." A previously
  saved deck configuration that selected the capacity slide will simply
  skip that slide on the next export — no error.

### Resources page (`/insights/resources`)

- Unchanged. The Capacity tab there is now the canonical home for the
  swim-lane Gantt; references in code comments and docs that said
  "the existing roadmap CapacityView" have been corrected to past tense.

---

## Files changed

| File | What changed |
| --- | --- |
| `lib/roadmap/views.ts` | `RoadmapView` union and `ROADMAP_VIEWS` array no longer include `"capacity"`. Doc updated to "Sections 5.4–5.7" with a forwarding pointer to Resources. |
| `components/roadmap/workspace.tsx` | Dropped the `CapacityView` import, the entire `view === "capacity"` render block (including the soft "Capacity has moved" notice), and updated doc comments + the `showIncludeClosed` comment. |
| `components/roadmap/tabs.tsx` | Doc comment "five views" → "four views"; section ref updated. |
| `components/roadmap/capacity-view.tsx` | **Deleted.** |
| `components/roadmap/export-renderer.tsx` | Dropped `CapacityView` import + `case "capacity"` branch; doc comment updated. |
| `lib/export/slide-types.ts` | `"capacity"` removed from the `SlideKind` union and from the `SLIDE_TYPES` catalog. The export modal no longer offers the slide. |
| `lib/export/payload.ts` | Three doc comments dropped "capacity" mentions. |
| `lib/export/slide-builders.ts` | "Raster slide (Timeline / Kanban / Bubble / Capacity)" comment dropped Capacity. |
| `app/api/export/pptx/route.ts` | `RASTER_SLIDE_TITLES` no longer carries a `capacity` entry; the `case "capacity":` fallthrough in the build switch is gone; route doc comment updated. |
| `app/page.tsx` | Home page Roadmap tile description updated. |
| `app/roadmap/page.tsx` | Page subtitle updated; the prior sweep's `isAdminProject` filter comment dropped its "capacity" mention. |
| `lib/auth/role-permissions.ts` | `roadmap.view` permission description updated. |
| `lib/roadmap/filters.ts` | Doc comment dropped Capacity. |
| `lib/roadmap/dates.ts` | Doc updated to clarify the helpers now feed the Timeline view *and* the Resources Capacity tab. |
| `lib/roadmap/capacity.ts` | Top comment updated to point at the Resources Capacity tab as its consumer. The file lives under `lib/roadmap/` for historical reasons. |
| `components/projects/form-modal.tsx` | Field comment for `start_date` updated: "Now/Next/Later view, Timeline, Capacity, and Velocity surfaces" → "Now/Next/Later view, Timeline, Resources, and Velocity surfaces." |
| `components/resources/capacity-tab.tsx` | Top comment no longer references the deleted `components/roadmap/capacity-view.tsx`. Replaced with an accurate explanation of why it's a fresh component and where the shared helpers live. |
| `app/insights/resources/page.tsx` | Top comment updated to reflect that the Resources Capacity tab is the only home for the view. |
| `scripts/smoke-export.ts` | `expectedKinds` set no longer contains `"capacity"`. (Total: 73 → 69 checks.) |
| `scripts/smoke-roadmap.ts` | New "views (catalog)" section: 11 assertions locking in the four-view contract, including `isRoadmapView('capacity') === false`. (Total: 78 → 89 checks.) |
| `README.md` | Roadmap section, library layout list, PPTX slide table, and directory tree updated for the four-view configuration. New row in the smoke-test table for `npm run smoke:admin-exclusion` (had been missing since the prior sweep). |
| `INSTALL.md` | Feature list updated. |
| `CHANGES-admin-exclusion.md` | "five views" → "four views" in two places. |

---

## What I deliberately left alone

### `lib/roadmap/dates.ts` and `lib/roadmap/capacity.ts`

Both files still live under `/lib/roadmap/`. The Resources Capacity tab
imports from them directly. The choices were:

1. **Move them to `/lib/resources/`** — touches every importer, breaks
   import paths in older changelogs, requires a careful pass on smoke
   tests. The benefit is purely organizational.
2. **Leave them where they are** — accurate top comments explain that
   the helpers still feed both the Timeline view (Roadmap) and the
   Capacity tab (Resources), and that the location is historical.

I picked (2). Moving the files would be churn for its own sake; the
helpers are pure functions and don't carry the architectural boundary.
If a future sweep does the move, this is the right time to revisit.

### `lib/velocity/metrics.ts`

The phrase "essential for capacity planning" appears in a doc comment
quoting Section 5.15 of the design document. That's a different sense
of "capacity" (resource forecasting in the abstract), not the view name,
and the wording is from the design doc verbatim. Left.

### Generic English uses of "capacity"

The Portfolio bubble chart and the quadrant-labels admin both contain
"…worth doing when capacity opens up…" — that's a colloquial English
use of the word, not a reference to the view. Left.

### Historical CHANGES docs

`CHANGES-insights-resources.md` and `CHANGES-insights-resources-step4.md`
describe the *soft-deprecation* state (the "Capacity has moved" banner)
that this sweep replaces with hard removal. They're accurate for the
sweeps they describe, and rewriting them would falsify history. The
"Hard removal of the Roadmap → Capacity sub-tab" item that both files
list under "Future work" is now done — that's what this sweep is.

`CHANGES-project-values.md` mentions
`components/roadmap/{capacity,now-next-later,timeline,kanban}-view.tsx`
in the list of files it touched. The file `capacity-view.tsx` is now
deleted, so a future reader navigating from that doc will hit a 404 in
the file tree. Left as-is — that's an accurate record of what was true
when the sweep ran. A reader who follows the breadcrumbs ends up at
this doc, which is the truth of where the file went.

---

## Tests

- `npm run typecheck` — clean.
- `npm run smoke:roadmap` — **89 checks pass** (was 78). The new
  `views (catalog)` block:
  - asserts `ROADMAP_VIEWS.length === 4`,
  - asserts each entry has the expected key (`timeline`, `kanban`,
    `bubble`, `now-next-later`) and a non-empty label,
  - explicitly asserts `isRoadmapView('capacity') === false` so a
    re-introduction of the view fails loudly here.
- `npm run smoke:export` — **69 checks pass** (was 73; the four
  capacity-slide assertions correctly no longer apply).
- All other smoke tests still pass (`db`, `projects`, `tasks`,
  `velocity`, `ideas`, `template`, `admin-exclusion`, `decisions`,
  `notifications`, `health`).

---

## Notes for upgrade

- **No data migration required.** No data changes; this is purely a
  view-layer sweep.
- **No settings migration required.** The PPTX slide picker reads from
  the SLIDE_TYPES catalog at render time. A previously stored "default
  selection" — if any team had one — that included `capacity` will be
  silently filtered out. No error, no broken save.
- **Direct links to a Capacity view URL.** The Roadmap workspace was a
  single `/roadmap` page with the active tab held in component state,
  not in the URL — there are no broken `/roadmap?view=capacity` links
  to migrate. Anyone who shared a screenshot will discover the new
  location organically.
