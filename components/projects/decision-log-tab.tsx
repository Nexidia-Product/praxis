"use client";

/**
 * Decision Log tab (Section 5.11).
 *
 * Mounted inside the project quick view alongside the project's other
 * detail tabs. Loads the per-project decision list lazily on first mount,
 * lets editors add new entries, and renders entries as an immutable
 * reverse-chronological list.
 *
 * State:
 *   - `entries` is the list returned by the API; updated on `onSaved`
 *     after a successful POST.
 *   - The "add entry" form lives inside this component because the modal
 *     doesn't need to know anything about it.
 *
 * Per Section 4.4 / 5.11, entries are append-only. There is intentionally
 * no edit / delete UI — if a correction is needed, add a new entry that
 * supersedes the original.
 */

import { useEffect, useState } from "react";

import type {
  DecisionLogEntry,
  DecisionType,
  ProjectId,
} from "@/lib/db";

interface DecisionLogTabProps {
  projectId: ProjectId;
  /** Whether the current user can add new entries (Admin / Project Lead). */
  canEdit: boolean;
}

const DECISION_TYPES: DecisionType[] = [
  "Scope Change",
  "Priority Change",
  "Timeline Change",
  "Resource Change",
  "Technical Decision",
  "Other",
];

/**
 * Per-decision-type badge styling. Re-uses the same emerald / amber / red /
 * slate language as the project-status badges so the tab feels of-a-piece.
 */
const TYPE_BADGE: Record<DecisionType, string> = {
  "Scope Change": "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  "Priority Change":
    "bg-orange-50 text-orange-900 ring-1 ring-inset ring-orange-200",
  "Timeline Change": "bg-sky-50 text-sky-900 ring-1 ring-inset ring-sky-200",
  "Resource Change":
    "bg-purple-50 text-purple-900 ring-1 ring-inset ring-purple-200",
  "Technical Decision":
    "bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-200",
  Other: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
};

export function DecisionLogTab({ projectId, canEdit }: DecisionLogTabProps) {
  const [entries, setEntries] = useState<DecisionLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Filter / search controls (DEC-03 + DEC-04). All filtering is
  // client-side because the per-project log is small (rarely > 50
  // entries) and the data is already loaded into state.
  const [filterType, setFilterType] = useState<DecisionType | "All">("All");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setLoadError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/decisions`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          decisions?: DecisionLogEntry[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.decisions) {
          setLoadError(data.error ?? "Could not load decision log.");
          setEntries([]);
          return;
        }
        setEntries(data.decisions);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError((err as Error).message);
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function onSaved(entry: DecisionLogEntry) {
    setEntries((prev) => {
      const next = prev ? [entry, ...prev] : [entry];
      // Keep the same newest-first ordering the API uses.
      next.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
      return next;
    });
    setAdding(false);
  }

  // Derived list with filters applied. Type filter is exact match;
  // date range is inclusive on both ends; search is case-insensitive
  // and scans summary, rationale, and made_by so any prose hit lands
  // (DEC-04 wants "decision log content" searchable).
  const visibleEntries = (entries ?? []).filter((e) => {
    if (filterType !== "All" && e.decision_type !== filterType) return false;
    if (filterFrom && e.entry_date < filterFrom) return false;
    if (filterTo && e.entry_date > filterTo) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const haystack =
        `${e.decision_summary} ${e.rationale} ${e.made_by}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const totalCount = entries?.length ?? 0;
  const filteredCount = visibleEntries.length;
  const hasActiveFilter =
    filterType !== "All" ||
    filterFrom !== "" ||
    filterTo !== "" ||
    searchQuery.trim() !== "";

  function clearFilters() {
    setFilterType("All");
    setFilterFrom("");
    setFilterTo("");
    setSearchQuery("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">
          Significant decisions, scope changes, and rationale.
          {entries !== null
            ? hasActiveFilter
              ? ` ${filteredCount} of ${totalCount} ${totalCount === 1 ? "entry" : "entries"}.`
              : ` ${totalCount} ${totalCount === 1 ? "entry" : "entries"}.`
            : null}
        </p>
        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800"
          >
            + Add entry
          </button>
        ) : null}
      </div>

      {/* Filter & search row (DEC-03, DEC-04). Hidden until at least
          one entry is loaded — there's nothing to filter through
          before then, and the controls would imply emptiness for the
          wrong reason. */}
      {entries !== null && entries.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 sm:grid-cols-[140px_120px_120px_1fr_auto]">
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-600">
              Type
            </label>
            <select
              value={filterType}
              onChange={(e) =>
                setFilterType(e.target.value as DecisionType | "All")
              }
              className={`mt-1 ${inputCls}`}
            >
              <option value="All">All types</option>
              {DECISION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-600">
              From
            </label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-600">
              To
            </label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-600">
              Search
            </label>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Summary, rationale, or recorder…"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilter}
              className="h-[26px] rounded-md border border-gray-300 bg-white px-2 text-[11px] font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {adding ? (
        <AddDecisionForm
          projectId={projectId}
          onCancel={() => setAdding(false)}
          onSaved={onSaved}
        />
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {loadError}
        </div>
      ) : null}

      {entries === null ? (
        <p className="text-xs italic text-gray-500">Loading…</p>
      ) : entries.length === 0 && !adding ? (
        <p className="text-xs italic text-gray-500">
          No entries yet. The decision log is a useful place to record why
          scope changed, why a target date moved, or why a project was
          reprioritized.
        </p>
      ) : visibleEntries.length === 0 ? (
        <p className="text-xs italic text-gray-500">
          No entries match the current filters.
        </p>
      ) : (
        <ol className="space-y-2">
          {visibleEntries.map((e) => (
            <li
              key={e.entry_id}
              className="rounded-md border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${TYPE_BADGE[e.decision_type]}`}
                    >
                      {e.decision_type}
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      {e.entry_date}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-gray-900">
                    {e.decision_summary}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                    {e.rationale}
                  </p>
                  <p className="mt-1.5 text-[11px] text-gray-500">
                    Recorded by {e.made_by}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-entry form
// ---------------------------------------------------------------------------

interface AddDecisionFormProps {
  projectId: ProjectId;
  onCancel: () => void;
  onSaved: (entry: DecisionLogEntry) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddDecisionForm({
  projectId,
  onCancel,
  onSaved,
}: AddDecisionFormProps) {
  const [decisionType, setDecisionType] =
    useState<DecisionType>("Scope Change");
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const [entryDate, setEntryDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/decisions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision_type: decisionType,
          decision_summary: summary,
          rationale,
          entry_date: entryDate,
        }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      decision?: DecisionLogEntry;
      error?: string;
    };
    setSaving(false);
    if (!res.ok || !data.decision) {
      setError(data.error ?? "Could not save entry.");
      return;
    }
    onSaved(data.decision);
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3"
    >
      <p className="text-xs font-medium text-gray-700">
        Once saved, entries cannot be edited. Add a new entry to amend.
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-600">
            Decision type
          </label>
          <select
            value={decisionType}
            onChange={(e) => setDecisionType(e.target.value as DecisionType)}
            disabled={saving}
            className={`mt-1 ${inputCls}`}
          >
            {DECISION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-600">
            Date
          </label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            disabled={saving}
            className={`mt-1 ${inputCls}`}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-600">
          Summary
        </label>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={200}
          disabled={saving}
          required
          placeholder="e.g. Descoped API integration"
          className={`mt-1 ${inputCls}`}
        />
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-600">
          Rationale
        </label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          disabled={saving}
          required
          placeholder="Why this decision was made…"
          className={`mt-1 ${inputCls}`}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !summary.trim() || !rationale.trim()}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {saving ? "Saving…" : "Save entry"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100";
