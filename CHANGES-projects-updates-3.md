# Projects updates — follow-up 3

Two fixes in this round:

1. **Summary-only status updates** — the user can now add a note on
   the Status tab without changing the actual status value. The
   submit button enables when *either* a status change *or* a summary
   note is present.
2. **Recalc Health button** added to the Projects page toolbar next
   to "+ New project". Forces a portfolio-wide health-score refresh
   on demand.

---

## Summary-only status updates

### Why

Health scores recompute automatically as projects and tasks change.
Status history entries did too — but only when the *status field
itself* flipped. The user wanted a way to log a status note ("still
on track, just slipped a few days for testing") without having to
fake-flip the status to trigger an entry.

### Schema & service

No schema change. The existing `StatusHistoryEntry.summary` field is
reused. The service now writes an entry under either of two
conditions:

- **Status change** — old behavior. `previous_status` !== `status`,
  optional summary archived.
- **Summary only** — new. `previous_status === status`, summary
  archived. The UI labels the row "Note added" rather than "X → Y"
  so the audit trail stays readable.

A patch with neither a status change nor a non-empty summary still
appends nothing — orphan empty entries are still rejected.

### UI

`canSubmit` widened from `canEdit && isStatusChanged` to
`canEdit && (isStatusChanged || hasSummary)`. The submit button
labels itself "Update status" when the status is changing and
"Add note" otherwise, so the user understands what kind of entry
they're about to create.

The early-return guard in `changeStatus` (projects-table) was
relaxed: it used to short-circuit any call where the status didn't
change. It now short-circuits only when the status is unchanged
*and* there's no summary — same-status calls *with* a summary fall
through to the server.

The optimistic update only fires when the status actually changes.
Summary-only calls hit the server and wait for the response; the
local state then picks up the new entry from the returned project.

`StatusHistoryRow` got a third rendering branch — when
`previous_status === status` it shows a gray "Note added" pill next
to the unchanged status badge instead of the "X → Y" arrow pair.

## Recalc Health button

### Why

Health scores already recalculate automatically: project create /
update, task create / update, daily cron sweep, dependency cascades.
But there's value in a manual escape hatch — when an admin tweaks
thresholds, when something looks stale, when the user wants to be
sure before a stakeholder demo. The doc spec mentions both daily
recalc and admin-triggered recalc; this adds user-triggered.

### Endpoint

A new `POST /api/projects/recalculate-health` endpoint runs
`recalculateAllHealthScores()` synchronously and returns the count of
projects whose score actually changed. Distinct from the existing
admin-only `/api/admin/health-thresholds/recalculate` route:

- Admin route: gated by `admin.health_thresholds.manage`. Used after
  threshold edits.
- New route: gated by `projects.view`. Used after task / project
  edits where the user wants to force-refresh.

Both call the same underlying function. Splitting them means we
don't need to loosen the threshold-editor's permission floor — admins
can keep that gated even while everyone else has refresh.

### UI

A new "↻ Recalc health" button sits in the projects-table toolbar
next to "+ New project". Click → POST → re-fetch projects → show a
brief success toast that auto-clears after 5s ("Health scores
recalculated — 3 projects updated"). Errors surface in the same
banner as other table errors and do not auto-clear.

The button shows "Recalculating…" while in-flight and is disabled
during the request to prevent double-submits.

## Files touched

- `lib/projects/service.ts` — service-side guard widened to write
  history entries on summary-only calls; same-status entry has
  `previous_status === status`
- `components/projects/quick-view.tsx` — `canSubmit` widened;
  submit button label switches between "Update status" / "Add note";
  `StatusHistoryRow` gained the "Note added" branch
- `components/projects/projects-table.tsx` — `changeStatus` early
  return relaxed; optimistic update conditional; new
  `recalcAllHealthScores` handler with auto-clearing result toast;
  `recalcBusy` / `recalcResult` state; `useEffect` cleanup; new
  toolbar button
- `app/api/projects/recalculate-health/route.ts` — new endpoint
  gated by `projects.view`

### Verified
- `npx tsc --noEmit` runs clean.
