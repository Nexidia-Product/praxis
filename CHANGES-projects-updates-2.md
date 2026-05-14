# Projects updates — follow-up

Two follow-up fixes on the projects sweep:

1. **Phase + Priority are now inline-editable directly in the projects
   table row**, alongside the existing inline Status edit. The previous
   pass made them editable on the panel, but the test feedback wanted
   them editable in the table itself.
2. **Status tab gained a summary field**. When changing status, the
   user can now attach a free-text note that's archived alongside the
   change in the history.

---

## Inline Phase + Priority in the table row

Both cells are now `<select>` controls matching the existing inline
Status edit:

- `stopPropagation` on the `<td>` so opening the dropdown doesn't fire
  the row's `onClick` (which would open the quick-view drawer).
- Same defensive "preserve archived value" branch as the panel — if an
  admin archives a phase or priority that's still in use on a project,
  the dropdown keeps that value selectable so it isn't silently
  overwritten.
- Falls back to the built-in `PROJECT_PHASES` / `PRIORITIES` arrays
  when no merged options are passed.
- Read-only render (a plain span) when `canEdit` is false.

Re-imported `PRIORITIES` and `PROJECT_PHASES` from `lib/projects/display`
(both had been removed during cleanup of the old bulk-action bar).

## Status tab — summary field

### Schema

`StatusHistoryEntry` gained a `summary: string | null` field. Trimmed
server-side; whitespace-only inputs become `null`.

### Service

`ProjectUpdatePayload` gained an optional `status_summary` field. The
service reads it inside `updateProject` and includes it on the
appended history entry — but only when `status` actually changes. A
patch with `status_summary` and no `status` change silently drops the
summary; orphan history entries would just confuse the audit trail.

The service validates by `typeof check`, then trims, then null-coerces
empties — no regex or schema library needed.

### UI

The Status tab editor is now form-style rather than fire-on-change:

- Status `<select>` keeps the old chrome.
- New textarea (3 rows) for the summary, labelled "Summary (optional —
  archives with this status change)".
- "Update status" submit button. Disabled until the user actually
  picks a different status — pure-summary submits would be no-ops
  given the service-side guard.
- Local `pendingStatus` / `pendingSummary` / `saving` state. Status is
  reset to the server value after the project prop updates, so
  switching to the Status tab on a project that just changed
  elsewhere doesn't show stale state.

The Details tab's inline status dropdown stays as the "quick fix"
flow (no summary). The row-level inline status select in the
projects table also stays summary-free; summaries are reserved for
the deliberate Status-tab path.

History rows now show the archived summary inline beneath the
attribution line, in a small light-gray bordered block with
`whitespace-pre-wrap` so multi-line notes render readably.

### Wire path

`onStatusChange` was widened from `(status) => void` to
`(status, summary?) => void`:

- `components/projects/projects-table.tsx` `changeStatus(project,
  status, summary?)` builds a PATCH body that conditionally includes
  `status_summary`.
- `components/roadmap/workspace.tsx` `handleStatusChange(projectId,
  status, summary?)` does the same. (Previously delegated to
  `handleUpdateField`; that helper sends a single
  `{ [field]: value }` shape, which can't carry the summary alongside
  the status atomically — so this got its own fetch.)
- API route `app/api/projects/[id]/route.ts` is unchanged; the body is
  cast to `ProjectUpdatePayload` and forwarded whole.

## Files touched

- `lib/db/types.ts` — `StatusHistoryEntry.summary`
- `lib/projects/service.ts` — `ProjectUpdatePayload.status_summary`;
  service reads / validates / null-coerces; entry includes summary
- `components/projects/quick-view.tsx` — `onStatusChange` signature
  widened; `StatusTab` rewritten as form with submit + textarea;
  `StatusHistoryRow` renders summary block when present
- `components/projects/projects-table.tsx` — `changeStatus` signature
  widened with optional summary; conditional patch body; `PRIORITIES`
  + `PROJECT_PHASES` re-imported; Phase + Priority cells made
  inline-editable
- `components/roadmap/workspace.tsx` — `handleStatusChange` widened;
  inlined fetch (replacing the delegated `handleUpdateField` call) so
  status + summary can be sent atomically; quick-view callback
  forwards the summary

### Verified
- `npx tsc --noEmit` runs clean.
