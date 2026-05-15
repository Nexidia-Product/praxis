"use client";

/**
 * External dependency editor.
 *
 * Lives alongside `<DependencyEditor>` (internal project-to-project
 * deps) in the project form modal. Lets the project owner record
 * things outside Praxis the project is waiting on — a Jira ticket
 * on another team, a vendor commitment, a SaaS feature request.
 *
 * State management mirrors `<DependencyEditor>`: parent owns the
 * canonical `external_dependencies` array, this component is fully
 * controlled. New rows append with sensible defaults; the user can
 * edit any field inline; "×" removes a row.
 *
 * No server interaction here — the project service validator stamps
 * IDs, created_at, and resolved_at on save.
 */

import { useState } from "react";

import type {
  ExternalDependency,
  ExternalDependencyStatus,
} from "@/lib/db";

interface ExternalDependenciesEditorProps {
  value: ExternalDependency[];
  onChange: (next: ExternalDependency[]) => void;
  disabled?: boolean;
}

const STATUS_OPTIONS: ExternalDependencyStatus[] = [
  "Open",
  "In Progress",
  "Resolved",
];

const STATUS_BADGE_CLASS: Record<ExternalDependencyStatus, string> = {
  Open: "pol-tag pol-tag-yellow",
  "In Progress": "pol-tag pol-tag-blue",
  Resolved: "pol-tag pol-tag-green",
};

export function ExternalDependenciesEditor({
  value,
  onChange,
  disabled,
}: ExternalDependenciesEditorProps) {
  // The new-row form sits below the existing rows; tracking it
  // locally keeps each draft tidy without forcing the parent to
  // hold an "in-progress new row" placeholder.
  const [draft, setDraft] = useState<{
    label: string;
    owner: string;
    url: string;
  }>({ label: "", owner: "", url: "" });

  function addRow() {
    if (!draft.label.trim()) return;
    const now = new Date().toISOString();
    onChange([
      ...value,
      {
        // The server validator will replace this id and timestamps;
        // we use placeholders so the row is well-typed in the
        // meantime. `external_dependency_id` is the only field a
        // duplicate-detector keys on, but new rows don't have an
        // existing match, so the placeholder is fine for one render.
        external_dependency_id: `pending-${Math.random().toString(36).slice(2)}`,
        label: draft.label.trim(),
        description: "",
        owner: draft.owner.trim(),
        url: draft.url.trim() || null,
        status: "Open",
        target_date: null,
        created_at: now,
        created_by: null,
        resolved_at: null,
      },
    ]);
    setDraft({ label: "", owner: "", url: "" });
  }

  function patchRow(index: number, patch: Partial<ExternalDependency>) {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function removeRow(index: number) {
    const next = value.slice();
    next.splice(index, 1);
    onChange(next);
  }

  return (
    <div className="form-field">
      <label className="form-label">External dependencies</label>
      <p className="form-help" style={{ marginBottom: 8 }}>
        Things outside Praxis this project is waiting on — Jira tickets on
        other teams, vendor deliveries, SaaS feature requests, etc.
      </p>

      {value.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginBottom: 10,
          }}
        >
          {value.map((row, i) => (
            <div
              key={row.external_dependency_id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--pol-radius)",
                padding: "10px 12px",
                background: "var(--card)",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "start",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <label
                    htmlFor={`ext-dep-label-${i}`}
                    className="form-label"
                    style={{ fontSize: 11 }}
                  >
                    Title
                  </label>
                  <input
                    id={`ext-dep-label-${i}`}
                    type="text"
                    className="pol-input"
                    value={row.label}
                    onChange={(e) => patchRow(i, { label: e.target.value })}
                    disabled={disabled}
                  />
                </div>

                <div className="form-field">
                  <label
                    htmlFor={`ext-dep-owner-${i}`}
                    className="form-label"
                    style={{ fontSize: 11 }}
                  >
                    Owner / team
                  </label>
                  <input
                    id={`ext-dep-owner-${i}`}
                    type="text"
                    className="pol-input"
                    value={row.owner}
                    placeholder="e.g. Platform team"
                    onChange={(e) => patchRow(i, { owner: e.target.value })}
                    disabled={disabled}
                  />
                </div>

                <div className="form-field">
                  <label
                    htmlFor={`ext-dep-status-${i}`}
                    className="form-label"
                    style={{ fontSize: 11 }}
                  >
                    Status
                  </label>
                  <select
                    id={`ext-dep-status-${i}`}
                    className="pol-select"
                    value={row.status}
                    onChange={(e) =>
                      patchRow(i, {
                        status: e.target.value as ExternalDependencyStatus,
                      })
                    }
                    disabled={disabled}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label
                    htmlFor={`ext-dep-url-${i}`}
                    className="form-label"
                    style={{ fontSize: 11 }}
                  >
                    Link (optional)
                  </label>
                  <input
                    id={`ext-dep-url-${i}`}
                    type="url"
                    className="pol-input"
                    value={row.url ?? ""}
                    placeholder="https://…"
                    onChange={(e) =>
                      patchRow(i, { url: e.target.value || null })
                    }
                    disabled={disabled}
                  />
                </div>

                <div className="form-field">
                  <label
                    htmlFor={`ext-dep-target-${i}`}
                    className="form-label"
                    style={{ fontSize: 11 }}
                  >
                    Expected resolution (optional)
                  </label>
                  <input
                    id={`ext-dep-target-${i}`}
                    type="date"
                    className="pol-input"
                    value={row.target_date ?? ""}
                    onChange={(e) =>
                      patchRow(i, { target_date: e.target.value || null })
                    }
                    disabled={disabled}
                  />
                </div>

                <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <label
                    htmlFor={`ext-dep-desc-${i}`}
                    className="form-label"
                    style={{ fontSize: 11 }}
                  >
                    Notes (optional)
                  </label>
                  <textarea
                    id={`ext-dep-desc-${i}`}
                    className="pol-textarea"
                    rows={2}
                    value={row.description}
                    onChange={(e) =>
                      patchRow(i, { description: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <span className={STATUS_BADGE_CLASS[row.status]}>
                    {row.status}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeRow(i)}
                className="pol-btn pol-btn-ghost pol-btn-sm"
                disabled={disabled}
                aria-label={`Remove ${row.label || "external dependency"}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* New-row entry. Quick add: just a title, with optional
          owner/link. Everything else can be edited inline on the
          row after it lands. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr auto",
          gap: 8,
          alignItems: "end",
        }}
      >
        <div className="form-field">
          <label
            htmlFor="ext-dep-new-label"
            className="form-label"
            style={{ fontSize: 11 }}
          >
            Add an external dependency
          </label>
          <input
            id="ext-dep-new-label"
            type="text"
            className="pol-input"
            placeholder="Title"
            value={draft.label}
            onChange={(e) =>
              setDraft((d) => ({ ...d, label: e.target.value }))
            }
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRow();
              }
            }}
          />
        </div>
        <input
          type="text"
          className="pol-input"
          placeholder="Owner / team"
          value={draft.owner}
          onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}
          disabled={disabled}
          aria-label="Owner or team"
        />
        <input
          type="url"
          className="pol-input"
          placeholder="Link"
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          disabled={disabled}
          aria-label="Link to tracking ticket"
        />
        <button
          type="button"
          onClick={addRow}
          disabled={disabled || !draft.label.trim()}
          className="pol-btn pol-btn-secondary"
        >
          Add
        </button>
      </div>
    </div>
  );
}
