"use client";

/**
 * Admin Audit Log table (Step 13 / Section 5.19).
 *
 * Read-only table of audit entries with:
 *
 *   - filter chips for entity type and action verb;
 *   - actor dropdown populated from `users.json` server-side;
 *   - free-text search over entity label and summary;
 *   - newest-first ordering;
 *   - inline loading / empty / error states.
 *
 * Entries are fetched from `GET /api/admin/audit-log` whenever a
 * filter changes. The API caps results at 200 by default so a busy
 * org doesn't pull tens of thousands of rows into the browser; if a
 * deeper history is needed, the operator can narrow filters or use
 * the `limit=` query string.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { AuditAction, AuditEntityType, AuditLogEntry } from "@/lib/db";

interface AuditLogTableProps {
  actors: Array<{ user_id: string; name: string }>;
}

/**
 * Render the actor name shown in a row.
 *
 * Resolution order:
 *
 *   1. `entry.actor_name` if it was captured at write time.
 *   2. The current display name in `actorsById` for `actor_id`. Catches
 *      the case where a row was written without a name (e.g. session
 *      JWT user_id drifted from users.json) but the user record exists
 *      now under that ID.
 *   3. `null` — caller should render the "Unknown user" / "System"
 *      fallback.
 *
 * Returning a name here keeps older rows useful as soon as the live
 * roster includes the actor's record again, without rewriting history.
 */
function resolveDisplayName(
  entry: AuditLogEntry,
  actorsById: Map<string, string>,
): string | null {
  if (entry.actor_name && entry.actor_name.trim().length > 0) {
    return entry.actor_name;
  }
  if (entry.actor_id) {
    const live = actorsById.get(entry.actor_id);
    if (live) return live;
  }
  return null;
}

const ENTITY_TYPES: AuditEntityType[] = [
  "Project",
  "Task",
  "Idea",
  "User",
  "Decision",
  "Template",
  "Settings",
];

const ACTIONS: AuditAction[] = [
  "create",
  "update",
  "delete",
  "status_change",
  "convert",
  "invite",
  "deactivate",
  "activate",
  "role_change",
  "password_reset",
];

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  status_change: "Status change",
  convert: "Convert",
  invite: "Invite",
  deactivate: "Deactivate",
  activate: "Activate",
  role_change: "Role change",
  password_reset: "Password reset",
};

const ACTION_TONE: Record<AuditAction, string> = {
  create: "pol-tag-green",
  update: "pol-tag-blue",
  delete: "pol-tag-red",
  status_change: "pol-tag-blue",
  convert: "pol-tag-teal",
  invite: "pol-tag-green",
  deactivate: "pol-tag-red",
  activate: "pol-tag-green",
  role_change: "pol-tag-blue",
  password_reset: "pol-tag-yellow",
};

interface ApiResponse {
  entries: AuditLogEntry[];
  total: number;
}

export function AuditLogTable({ actors }: AuditLogTableProps) {
  // ID → name lookup used to backfill display names for entries that
  // were written without one (legacy rows + the JWT-drift edge case).
  const actorsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of actors) map.set(a.user_id, a.name);
    return map;
  }, [actors]);

  const [entityType, setEntityType] = useState<AuditEntityType | "">("");
  const [action, setAction] = useState<AuditAction | "">("");
  const [actorId, setActorId] = useState<string>("");
  const [q, setQ] = useState<string>("");
  // Debounced text used for the actual fetch — typing into `q` shouldn't
  // fire a request on every keystroke.
  const [debouncedQ, setDebouncedQ] = useState<string>("");

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search text. 250ms feels responsive without flooding
  // the API on a fast typist.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(handle);
  }, [q]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (entityType) params.set("entity_type", entityType);
    if (action) params.set("action", action);
    if (actorId) params.set("actor_id", actorId);
    if (debouncedQ) params.set("q", debouncedQ);
    return params.toString();
  }, [entityType, action, actorId, debouncedQ]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/audit-log${queryString ? `?${queryString}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          typeof body.error === "string"
            ? body.error
            : `Could not load audit log (HTTP ${res.status}).`,
        );
        return;
      }
      const data = (await res.json()) as ApiResponse;
      setEntries(data.entries);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load audit log.",
      );
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const filtersActive =
    Boolean(entityType) || Boolean(action) || Boolean(actorId) || Boolean(debouncedQ);

  function clearFilters() {
    setEntityType("");
    setAction("");
    setActorId("");
    setQ("");
    setDebouncedQ("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="toolbar" role="search" aria-label="Audit log filters">
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            flex: 1,
          }}
        >
          <label className="form-label" htmlFor="audit-search" style={{ marginRight: 4 }}>
            Search
          </label>
          <input
            id="audit-search"
            type="search"
            className="pol-input"
            placeholder="Filter by entity name or summary…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 220, flex: "0 1 320px" }}
            aria-label="Search audit log entries"
          />

          <label className="form-label" htmlFor="audit-entity">Entity</label>
          <select
            id="audit-entity"
            className="pol-select"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as AuditEntityType | "")}
            style={{ minWidth: 130 }}
            aria-label="Filter by entity type"
          >
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label className="form-label" htmlFor="audit-action">Action</label>
          <select
            id="audit-action"
            className="pol-select"
            value={action}
            onChange={(e) => setAction(e.target.value as AuditAction | "")}
            style={{ minWidth: 150 }}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>

          <label className="form-label" htmlFor="audit-actor">Actor</label>
          <select
            id="audit-actor"
            className="pol-select"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            style={{ minWidth: 170 }}
            aria-label="Filter by actor"
          >
            <option value="">All actors</option>
            <option value="system">System</option>
            {actors.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {filtersActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="pol-btn pol-btn-ghost"
            >
              Clear filters
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchEntries()}
            className="pol-btn"
            aria-label="Refresh audit log"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="pol-card" aria-busy={loading} aria-live="polite">
        {loading && entries.length === 0 ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void fetchEntries()} />
        ) : entries.length === 0 ? (
          <EmptyState filtersActive={filtersActive} />
        ) : (
          <Table entries={entries} actorsById={actorsById} />
        )}
      </div>

      <p
        style={{
          fontSize: 11,
          color: "var(--tm)",
          marginTop: 4,
        }}
      >
        Showing the {entries.length} most recent {filtersActive ? "matching " : ""}
        entries. Adjust filters to drill in further.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Table({
  entries,
  actorsById,
}: {
  entries: AuditLogEntry[];
  actorsById: Map<string, string>;
}) {
  return (
    <div role="region" aria-label="Audit log entries" style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "var(--fs-sm)",
        }}
      >
        <thead>
          <tr>
            <Th style={{ width: 160 }}>When</Th>
            <Th style={{ width: 100 }}>Action</Th>
            <Th style={{ width: 100 }}>Entity</Th>
            <Th>Subject</Th>
            <Th>Summary</Th>
            <Th style={{ width: 160 }}>Actor</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Row
              key={entry.entry_id}
              entry={entry}
              actorsById={actorsById}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  entry,
  actorsById,
}: {
  entry: AuditLogEntry;
  actorsById: Map<string, string>;
}) {
  const displayName = resolveDisplayName(entry, actorsById);
  const href = entityHref(entry.entity_type, entry.entity_id);
  const subject = (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="mono" style={{ color: "var(--tm)" }}>
        {entry.entity_id}
      </span>
      <span style={{ color: "var(--t1)" }}>{entry.entity_label || "—"}</span>
    </div>
  );

  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <Td>
        <time dateTime={entry.occurred_at} title={entry.occurred_at}>
          {formatTimestamp(entry.occurred_at)}
        </time>
      </Td>
      <Td>
        <span className={`pol-tag ${ACTION_TONE[entry.action]}`}>
          {ACTION_LABELS[entry.action]}
        </span>
      </Td>
      <Td>
        <span className="pol-tag pol-tag-gray">{entry.entity_type}</span>
      </Td>
      <Td>
        {href ? (
          <Link
            href={href}
            style={{ color: "var(--brand)", textDecoration: "none" }}
          >
            {subject}
          </Link>
        ) : (
          subject
        )}
      </Td>
      <Td>
        <span style={{ color: "var(--t2)" }}>{entry.summary}</span>
      </Td>
      <Td>
        {displayName ? (
          <span style={{ color: "var(--t1)" }}>{displayName}</span>
        ) : (
          <span style={{ color: "var(--tm)", fontStyle: "italic" }}>
            {entry.actor_id ? "Unknown user" : "System"}
          </span>
        )}
      </Td>
    </tr>
  );
}

function Th({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <th
      scope="col"
      className="col-header"
      style={{ textAlign: "left", padding: "8px 12px", ...style }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--tm)",
        fontSize: "var(--fs-sm)",
      }}
      role="status"
    >
      Loading audit log…
    </div>
  );
}

function EmptyState({ filtersActive }: { filtersActive: boolean }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--tm)",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--t2)" }}>
        {filtersActive ? "No matching audit entries." : "No audit entries yet."}
      </p>
      <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
        {filtersActive
          ? "Try clearing one of the filters or widening the search."
          : "Activity recorded by the application — creates, updates, deletes, status changes — will appear here as it happens."}
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: "20px 16px",
        textAlign: "center",
        color: "var(--err)",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600 }}>Could not load the audit log.</p>
      <p style={{ fontSize: 12, marginTop: 4, color: "var(--t2)" }}>{message}</p>
      <button
        type="button"
        className="pol-btn pol-btn-secondary"
        onClick={onRetry}
        style={{ marginTop: 10 }}
      >
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityHref(type: string, id: string): string | null {
  switch (type) {
    case "Project":
      return `/projects?id=${encodeURIComponent(id)}`;
    case "Task":
      return `/tasks?id=${encodeURIComponent(id)}`;
    case "Idea":
      return `/admin/ideas/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

function formatTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
