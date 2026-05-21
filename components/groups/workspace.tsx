"use client";

/**
 * Groups workspace — list, expand, and manage project groups.
 *
 * One row per group. The row is expandable; clicking the chevron
 * (or anywhere on the row chrome that isn't an action button) reveals
 * a sub-table of the group's member projects with the columns the
 * team asked for: ID, name, lead, status, health, start date, target
 * date. Each member project links back to its quick view via the
 * standard /projects?id=… deep link.
 *
 * Create / edit / delete are client-side calls against /api/project-
 * groups; the responses replace local state so the UI reflects what
 * was persisted without a full page reload. canEdit toggles the
 * write affordances; the API enforces the same gate regardless.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import type { Project, ProjectGroup, ProjectId } from "@/lib/db";
import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
} from "@/lib/projects/display";

interface Props {
  initialGroups: ProjectGroup[];
  projects: Project[];
  userNamesById: Record<string, string>;
  canEdit: boolean;
}

// Member-detail column metadata. Centralized so the header and rows
// stay in lockstep when the column set changes.
const MEMBER_COLUMNS: Array<{ key: string; label: string; align?: "left" | "right" }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "lead", label: "Lead" },
  { key: "status", label: "Status" },
  { key: "health", label: "Health" },
  { key: "start", label: "Start" },
  { key: "target", label: "Target" },
];

export function GroupsWorkspace({
  initialGroups,
  projects,
  userNamesById,
  canEdit,
}: Props) {
  const [groups, setGroups] = useState<ProjectGroup[]>(initialGroups);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectGroup | null>(null);
  const [creating, setCreating] = useState(false);

  const projectsById = useMemo(() => {
    const m = new Map<ProjectId, Project>();
    for (const p of projects) m.set(p.project_id, p);
    return m;
  }, [projects]);

  function resolveLead(p: Project): string {
    if (!p.project_lead) return "—";
    // project_lead can be a UUID (UserId) or a free-text name. If it
    // resolves through the users table we render the friendly name;
    // otherwise we trust the string as already-readable.
    return userNamesById[p.project_lead] ?? p.project_lead;
  }

  async function handleCreate(payload: {
    name: string;
    description: string;
    member_project_ids: ProjectId[];
  }) {
    const resp = await fetch("/api/project-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      group?: ProjectGroup;
      error?: string;
    };
    if (!resp.ok || !data.group) {
      throw new Error(data.error ?? `HTTP ${resp.status}`);
    }
    setGroups((prev) => [data.group as ProjectGroup, ...prev]);
    setCreating(false);
  }

  async function handleUpdate(
    id: string,
    payload: {
      name: string;
      description: string;
      member_project_ids: ProjectId[];
    },
  ) {
    const resp = await fetch(`/api/project-groups/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      group?: ProjectGroup;
      error?: string;
    };
    if (!resp.ok || !data.group) {
      throw new Error(data.error ?? `HTTP ${resp.status}`);
    }
    setGroups((prev) =>
      prev.map((g) =>
        g.group_id === id ? (data.group as ProjectGroup) : g,
      ),
    );
    setEditing(null);
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm(
        "Delete this group? Member projects are not affected — only the group itself is removed.",
      )
    ) {
      return;
    }
    const resp = await fetch(`/api/project-groups/${id}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? `HTTP ${resp.status}`);
      return;
    }
    setGroups((prev) => prev.filter((g) => g.group_id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="toolbar">
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--tm)" }}>
          {groups.length === 0
            ? "No groups yet."
            : `${groups.length} group${groups.length === 1 ? "" : "s"}.`}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="pol-btn pol-btn-primary"
          >
            + New group
          </button>
        ) : null}
      </div>

      {/* Group list — one expandable row per group */}
      <div className="pol-card" style={{ padding: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "32px 1fr 100px 140px 160px",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--hover)",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--tm)",
          }}
        >
          <span></span>
          <span>Name</span>
          <span>Members</span>
          <span>Created</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </div>

        {groups.length === 0 ? (
          <div
            style={{
              padding: "24px 12px",
              fontSize: "var(--fs-sm)",
              color: "var(--tm)",
              textAlign: "center",
            }}
          >
            {canEdit
              ? "Click New group to create your first cluster."
              : "No groups have been created yet."}
          </div>
        ) : null}

        {groups.map((g) => {
          const isExpanded = expandedId === g.group_id;
          const memberProjects = g.member_project_ids
            .map((id) => projectsById.get(id))
            .filter((p): p is Project => Boolean(p));

          return (
            <div
              key={g.group_id}
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              {/* Row chrome */}
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setExpandedId(isExpanded ? null : g.group_id)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(isExpanded ? null : g.group_id);
                  }
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr 100px 140px 160px",
                  gap: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                  alignItems: "center",
                  background: isExpanded ? "var(--hover)" : "transparent",
                  transition: "background 0.1s",
                }}
                className="hoverable-row"
                aria-expanded={isExpanded}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 14,
                    color: "var(--tm)",
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                    display: "inline-block",
                    width: 16,
                    textAlign: "center",
                  }}
                >
                  ▸
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--fs-sm)",
                      fontWeight: 600,
                      color: "var(--t1)",
                    }}
                  >
                    {g.name}
                  </div>
                  {g.description ? (
                    <div
                      style={{
                        fontSize: "var(--fs-xs)",
                        color: "var(--tm)",
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {g.description}
                    </div>
                  ) : null}
                </div>
                <span
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--t2)",
                  }}
                >
                  {g.member_project_ids.length}
                </span>
                <span
                  style={{
                    fontSize: "var(--fs-xs)",
                    color: "var(--tm)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {g.created_at.slice(0, 10)}
                </span>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 6,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(g)}
                        className="pol-btn pol-btn-secondary"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(g.group_id)}
                        className="pol-btn pol-btn-secondary"
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          color: "var(--err)",
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Expanded: member sub-table */}
              {isExpanded ? (
                <div
                  style={{
                    padding: "8px 12px 12px 48px",
                    background: "var(--bg)",
                  }}
                >
                  {memberProjects.length === 0 ? (
                    <div
                      style={{
                        fontSize: "var(--fs-sm)",
                        color: "var(--tm)",
                        fontStyle: "italic",
                      }}
                    >
                      No member projects.
                    </div>
                  ) : (
                    <div
                      style={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--pol-radius)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "100px 1fr 160px 130px 80px 110px 110px",
                          gap: 8,
                          padding: "6px 10px",
                          borderBottom: "1px solid var(--border)",
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "var(--tm)",
                        }}
                      >
                        {MEMBER_COLUMNS.map((c) => (
                          <span key={c.key}>{c.label}</span>
                        ))}
                      </div>
                      {memberProjects.map((p) => (
                        <div
                          key={p.project_id}
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "100px 1fr 160px 130px 80px 110px 110px",
                            gap: 8,
                            padding: "8px 10px",
                            borderBottom: "1px solid var(--border)",
                            fontSize: "var(--fs-sm)",
                            alignItems: "center",
                          }}
                          className="hoverable-row"
                        >
                          <span
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: 12,
                              color: "var(--t2)",
                            }}
                          >
                            {p.project_id}
                          </span>
                          <Link
                            href={`/projects?id=${p.project_id}`}
                            style={{
                              color: "var(--brand)",
                              fontWeight: 600,
                              textDecoration: "none",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.name}
                          </Link>
                          <span style={{ color: "var(--t2)" }}>
                            {resolveLead(p)}
                          </span>
                          <span style={{ color: "var(--t2)" }}>{p.status}</span>
                          <span>
                            {p.health_score ? (
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[p.health_score]}`}
                                title={HEALTH_TOOLTIP[p.health_score]}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[p.health_score]}`}
                                />
                                {p.health_score}
                              </span>
                            ) : (
                              <span style={{ color: "var(--tm)" }}>—</span>
                            )}
                          </span>
                          <span
                            style={{
                              color: "var(--t2)",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: 12,
                            }}
                          >
                            {p.roadmap_timeline_start ?? "—"}
                          </span>
                          <span
                            style={{
                              color: "var(--t2)",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: 12,
                            }}
                          >
                            {p.target_date ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {creating ? (
        <GroupFormModal
          projects={projects}
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      ) : null}
      {editing ? (
        <GroupFormModal
          group={editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => handleUpdate(editing.group_id, payload)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit modal
// ---------------------------------------------------------------------------

interface FormPayload {
  name: string;
  description: string;
  member_project_ids: ProjectId[];
}

interface GroupFormModalProps {
  group?: ProjectGroup;
  projects: Project[];
  onClose: () => void;
  onSubmit: (payload: FormPayload) => Promise<void>;
}

function GroupFormModal({
  group,
  projects,
  onClose,
  onSubmit,
}: GroupFormModalProps) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [memberIds, setMemberIds] = useState<ProjectId[]>(
    group?.member_project_ids ?? [],
  );
  const [pickerQuery, setPickerQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (a.project_id !== b.project_id) {
        return a.project_id < b.project_id ? 1 : -1;
      }
      return 0;
    });
  }, [projects]);

  const candidateProjects = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return sortedProjects.filter((p) => {
      if (memberIds.includes(p.project_id)) return false;
      if (q === "") return true;
      return (
        p.project_id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q)
      );
    });
  }, [sortedProjects, memberIds, pickerQuery]);

  const projectsById = useMemo(() => {
    const m = new Map<ProjectId, Project>();
    for (const p of projects) m.set(p.project_id, p);
    return m;
  }, [projects]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        member_project_ids: memberIds,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={group ? "Edit group" : "New group"}
      className="pol-modal-overlay"
      onClick={onClose}
    >
      <div
        className="pol-modal"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pol-modal-header">
          <h2 className="pol-modal-title">
            {group ? "Edit group" : "New group"}
          </h2>
          <button
            type="button"
            className="pol-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="pol-modal-body">
          <div>
            <label
              htmlFor="grp-name"
              style={{
                display: "block",
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              Name <span style={{ color: "var(--err)" }}>*</span>
            </label>
            <input
              id="grp-name"
              type="text"
              className="pol-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              maxLength={200}
              placeholder="e.g. Repeat Call Analysis cluster"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              htmlFor="grp-desc"
              style={{
                display: "block",
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              Description
            </label>
            <textarea
              id="grp-desc"
              className="pol-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={2000}
              placeholder="Why are these projects clustered? Shared dataset, audience, analyst pool, etc."
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <div
              style={{
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              Member projects ({memberIds.length})
            </div>
            {memberIds.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {memberIds.map((id) => {
                  const p = projectsById.get(id);
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: "var(--hover)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--pol-radius-pill, 999px)",
                        padding: "3px 4px 3px 10px",
                        fontSize: "var(--fs-xs)",
                      }}
                    >
                      <span>
                        <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {id}
                        </strong>{" "}
                        {p ? p.name : "(unknown)"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setMemberIds((prev) =>
                            prev.filter((m) => m !== id),
                          )
                        }
                        disabled={busy}
                        aria-label={`Remove ${id}`}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--tm)",
                          fontSize: 14,
                          lineHeight: 1,
                          padding: "0 4px",
                        }}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            <input
              type="text"
              className="pol-input"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              disabled={busy}
              placeholder="Search projects by ID or name…"
              style={{ width: "100%" }}
            />
            {pickerQuery.trim() !== "" ? (
              <div
                style={{
                  marginTop: 6,
                  maxHeight: 200,
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--pol-radius)",
                }}
              >
                {candidateProjects.slice(0, 25).map((p) => (
                  <button
                    key={p.project_id}
                    type="button"
                    onClick={() => {
                      setMemberIds((prev) => [...prev, p.project_id]);
                      setPickerQuery("");
                    }}
                    disabled={busy}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      fontSize: "var(--fs-sm)",
                    }}
                    className="hoverable-row"
                  >
                    <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>
                      {p.project_id}
                    </strong>{" "}
                    {p.name}
                  </button>
                ))}
                {candidateProjects.length === 0 ? (
                  <div
                    style={{
                      padding: "6px 10px",
                      fontSize: "var(--fs-sm)",
                      color: "var(--tm)",
                      fontStyle: "italic",
                    }}
                  >
                    No matches.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {error ? (
            <div
              role="alert"
              style={{
                fontSize: "var(--fs-sm)",
                color: "var(--err)",
                background: "var(--err-tint, rgba(220, 38, 38, 0.08))",
                padding: "8px 12px",
                borderRadius: "var(--pol-radius)",
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <footer className="pol-modal-footer" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pol-btn pol-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || name.trim() === ""}
            className="pol-btn pol-btn-primary"
          >
            {busy ? "Saving…" : group ? "Save changes" : "Create group"}
          </button>
        </footer>
      </div>
    </div>
  );
}
