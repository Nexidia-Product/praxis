"use client";

/**
 * Use cases admin — list, create, edit, delete use cases.
 *
 * Each use case has a name, description, a set of organizational
 * a primary objective plus optional secondary objectives (same lists
 * projects use), and individually selected member projects. A project
 * can belong to only one use case. The API enforces
 * `usecases.manage`; this page is only reachable with it.
 */

import { useMemo, useState } from "react";

import type { Project, ProjectId, UseCase } from "@/lib/db";

interface Props {
  initialUseCases: UseCase[];
  projects: Project[];
  primaryOptions: string[];
  secondaryOptions: string[];
}

interface UseCasePayload {
  name: string;
  description: string;
  caveats: string;
  primary_objective: string;
  secondary_objectives: string[];
  member_project_ids: ProjectId[];
  /** Move selected projects out of any other use case they are in. */
  move_projects: boolean;
}

const LABEL_STYLE = {
  display: "block",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  marginBottom: 4,
} as const;

export function UseCasesAdmin({
  initialUseCases,
  projects,
  primaryOptions,
  secondaryOptions,
}: Props) {
  const [useCases, setUseCases] = useState<UseCase[]>(initialUseCases);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<UseCase | null>(null);
  const [creating, setCreating] = useState(false);

  const projectsById = useMemo(() => {
    const m = new Map<ProjectId, Project>();
    for (const p of projects) m.set(p.project_id, p);
    return m;
  }, [projects]);

  async function save(
    url: string,
    method: "POST" | "PUT",
    payload: UseCasePayload,
  ): Promise<UseCase> {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      useCase?: UseCase;
      error?: string;
    };
    if (!resp.ok || !data.useCase) {
      throw new Error(data.error ?? `HTTP ${resp.status}`);
    }
    return data.useCase;
  }

  // After a move, drop the moved projects from every other use case in
  // local state so the list matches what the server now holds.
  function stripMoved(list: UseCase[], dest: UseCase): UseCase[] {
    const moved = new Set(dest.member_project_ids);
    return list.map((u) =>
      u.use_case_id === dest.use_case_id
        ? u
        : {
            ...u,
            member_project_ids: u.member_project_ids.filter(
              (pid) => !moved.has(pid),
            ),
          },
    );
  }

  async function handleCreate(payload: UseCasePayload) {
    const created = await save("/api/use-cases", "POST", payload);
    setUseCases((prev) =>
      stripMoved(prev, created).concat(created).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setCreating(false);
  }

  async function handleUpdate(id: string, payload: UseCasePayload) {
    const updated = await save(`/api/use-cases/${id}`, "PUT", payload);
    setUseCases((prev) =>
      stripMoved(prev, updated)
        .map((u) => (u.use_case_id === id ? updated : u))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditing(null);
  }

  async function handleDelete(uc: UseCase) {
    if (
      !window.confirm(
        `Delete use case "${uc.name}"? Projects are not affected — only the use case and its associations are removed.`,
      )
    ) {
      return;
    }
    const resp = await fetch(`/api/use-cases/${uc.use_case_id}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? `HTTP ${resp.status}`);
      return;
    }
    setUseCases((prev) => prev.filter((u) => u.use_case_id !== uc.use_case_id));
    if (expandedId === uc.use_case_id) setExpandedId(null);
  }

  return (
    <div className="space-y-3">
      <div className="toolbar">
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--tm)" }}>
          {useCases.length === 0
            ? "No use cases yet."
            : `${useCases.length} use case${useCases.length === 1 ? "" : "s"}.`}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="pol-btn pol-btn-primary"
        >
          + New use case
        </button>
      </div>

      <div className="pol-card" style={{ padding: 0 }}>
        {useCases.length === 0 ? (
          <div
            style={{
              padding: "24px 12px",
              fontSize: "var(--fs-sm)",
              color: "var(--tm)",
              textAlign: "center",
            }}
          >
            Click New use case to define your first one.
          </div>
        ) : null}

        {useCases.map((uc) => {
          const isExpanded = expandedId === uc.use_case_id;
          return (
            <div
              key={uc.use_case_id}
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                className="hoverable-row"
                onClick={() => setExpandedId(isExpanded ? null : uc.use_case_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(isExpanded ? null : uc.use_case_id);
                  }
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr 90px 160px",
                  gap: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                  alignItems: "center",
                  background: isExpanded ? "var(--hover)" : "transparent",
                }}
              >
                <span aria-hidden="true" style={{ color: "var(--tm)" }}>
                  {isExpanded ? "▾" : "▸"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--t1)" }}>
                    {uc.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      marginTop: 4,
                    }}
                  >
                    {uc.primary_objective ? (
                      <span
                        title="Primary objective"
                        style={{
                          background: "var(--hover)",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "1px 8px",
                          fontSize: "var(--fs-xs)",
                          fontWeight: 700,
                        }}
                      >
                        {uc.primary_objective}
                      </span>
                    ) : (
                      <span
                        style={{ fontSize: "var(--fs-xs)", color: "var(--tm)" }}
                      >
                        No primary objective
                      </span>
                    )}
                    {uc.secondary_objectives.map((o) => (
                      <span
                        key={o}
                        title="Secondary objective"
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "1px 8px",
                          fontSize: "var(--fs-xs)",
                          color: "var(--t2)",
                        }}
                      >
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--t2)" }}>
                  {uc.member_project_ids.length} project
                  {uc.member_project_ids.length === 1 ? "" : "s"}
                </span>
                <span
                  style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="pol-btn pol-btn-secondary"
                    onClick={() => setEditing(uc)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="pol-btn pol-btn-secondary"
                    onClick={() => handleDelete(uc)}
                  >
                    Delete
                  </button>
                </span>
              </div>

              {isExpanded ? (
                <div style={{ padding: "8px 12px 14px 44px" }}>
                  <p
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: uc.description ? "var(--t1)" : "var(--tm)",
                      fontStyle: uc.description ? "normal" : "italic",
                      whiteSpace: "pre-wrap",
                      margin: "0 0 10px",
                    }}
                  >
                    {uc.description || "No description."}
                  </p>
                  {uc.caveats ? (
                    <div
                      style={{
                        fontSize: "var(--fs-sm)",
                        background: "var(--hover)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--pol-radius)",
                        padding: "8px 12px",
                        margin: "0 0 10px",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      <strong>Caveats:</strong> {uc.caveats}
                    </div>
                  ) : null}
                  {uc.member_project_ids.length === 0 ? (
                    <div
                      style={{ fontSize: "var(--fs-sm)", color: "var(--tm)" }}
                    >
                      No projects assigned yet.
                    </div>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {uc.member_project_ids.map((pid) => {
                        const p = projectsById.get(pid);
                        return (
                          <li
                            key={pid}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "110px 1fr 160px 120px",
                              gap: 8,
                              padding: "4px 0",
                              fontSize: "var(--fs-sm)",
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "var(--font-mono, monospace)",
                                fontSize: 12,
                                color: "var(--t2)",
                              }}
                            >
                              {pid}
                            </span>
                            <span>{p ? p.name : "(unknown project)"}</span>
                            <span style={{ color: "var(--tm)" }}>
                              {p?.primary_objective ?? "—"}
                            </span>
                            <span style={{ color: "var(--tm)" }}>
                              {p?.status ?? ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {creating ? (
        <UseCaseFormModal
          useCase={null}
          projects={projects}
          primaryOptions={primaryOptions}
          secondaryOptions={secondaryOptions}
          useCases={useCases}
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      ) : null}
      {editing ? (
        <UseCaseFormModal
          useCase={editing}
          projects={projects}
          primaryOptions={primaryOptions}
          secondaryOptions={secondaryOptions}
          useCases={useCases}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => handleUpdate(editing.use_case_id, payload)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form modal
// ---------------------------------------------------------------------------

interface FormModalProps {
  useCase: UseCase | null;
  projects: Project[];
  primaryOptions: string[];
  secondaryOptions: string[];
  useCases: UseCase[];
  onClose: () => void;
  onSubmit: (payload: UseCasePayload) => Promise<void>;
}

function UseCaseFormModal({
  useCase,
  projects,
  primaryOptions,
  secondaryOptions,
  useCases,
  onClose,
  onSubmit,
}: FormModalProps) {
  const [name, setName] = useState(useCase?.name ?? "");
  const [description, setDescription] = useState(useCase?.description ?? "");
  const [caveats, setCaveats] = useState(useCase?.caveats ?? "");
  const [primary, setPrimary] = useState<string>(
    useCase?.primary_objective ?? "",
  );
  const [secondary, setSecondary] = useState<string[]>(
    useCase?.secondary_objectives ?? [],
  );
  const [showAssigned, setShowAssigned] = useState(false);
  const [memberIds, setMemberIds] = useState<ProjectId[]>(
    useCase?.member_project_ids ?? [],
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberSet = useMemo(() => new Set(memberIds), [memberIds]);

  // Projects already held by a *different* use case (a project can be in
  // only one). Hidden from the picker by default.
  const assignedElsewhere = useMemo(() => {
    const m = new Map<ProjectId, string>();
    for (const uc of useCases) {
      if (uc.use_case_id === useCase?.use_case_id) continue;
      for (const pid of uc.member_project_ids) m.set(pid, uc.name);
    }
    return m;
  }, [useCases, useCase]);

  // Selected projects currently held by another use case; saving moves them.
  const movingIds = memberIds.filter((id) => assignedElsewhere.has(id));

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = projects
      .filter((p) => showAssigned || !assignedElsewhere.has(p.project_id))
      .sort((a, b) =>
      a.project_id < b.project_id ? 1 : a.project_id > b.project_id ? -1 : 0,
    );
    if (q === "") return sorted;
    return sorted.filter(
      (p) =>
        p.project_id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q),
    );
  }, [projects, query, showAssigned, assignedElsewhere]);

  function changePrimary(o: string) {
    setPrimary(o);
    setSecondary((prev) => prev.filter((x) => x !== o));
  }

  function toggleSecondary(o: string) {
    setSecondary((prev) =>
      prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o],
    );
  }

  function toggleMember(id: ProjectId) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        caveats: caveats.trim(),
        primary_objective: primary,
        secondary_objectives: secondary,
        member_project_ids: memberIds,
        move_projects: movingIds.length > 0,
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
      aria-label={useCase ? "Edit use case" : "New use case"}
      className="pol-modal-overlay"
      onClick={onClose}
    >
      <div
        className="pol-modal"
        style={{ maxWidth: 680 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pol-modal-header">
          <h2 className="pol-modal-title">
            {useCase ? "Edit use case" : "New use case"}
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
            <label htmlFor="uc-name" style={LABEL_STYLE}>
              Name <span style={{ color: "var(--err)" }}>*</span>
            </label>
            <input
              id="uc-name"
              type="text"
              className="pol-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              maxLength={200}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label htmlFor="uc-desc" style={LABEL_STYLE}>
              Description
            </label>
            <textarea
              id="uc-desc"
              className="pol-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={4}
              maxLength={4000}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label htmlFor="uc-caveats" style={LABEL_STYLE}>
              Caveats
            </label>
            <textarea
              id="uc-caveats"
              className="pol-input"
              value={caveats}
              onChange={(e) => setCaveats(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={4000}
              placeholder="Limitations, assumptions, or exceptions that apply to this use case."
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label htmlFor="uc-primary" style={LABEL_STYLE}>
              Primary objective <span style={{ color: "var(--err)" }}>*</span>
            </label>
            <select
              id="uc-primary"
              className="pol-input"
              value={primary}
              onChange={(e) => changePrimary(e.target.value)}
              disabled={busy}
              style={{ width: "100%" }}
            >
              <option value="">Select…</option>
              {primaryOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={LABEL_STYLE}>
              Secondary objectives ({secondary.length})
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
              {secondaryOptions
                .filter((o) => o !== primary)
                .map((o) => (
                  <label
                    key={o}
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                      fontSize: "var(--fs-sm)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={secondary.includes(o)}
                      onChange={() => toggleSecondary(o)}
                      disabled={busy}
                    />
                    {o}
                  </label>
                ))}
            </div>
          </fieldset>

          <div>
            <div style={LABEL_STYLE}>Projects ({memberIds.length})</div>
            <label
              style={{
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                fontSize: "var(--fs-xs)",
                color: "var(--t2)",
                marginBottom: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showAssigned}
                onChange={(e) => setShowAssigned(e.target.checked)}
              />
              Also show projects already in another use case (select to move)
            </label>
            <input
              type="text"
              className="pol-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={busy}
              placeholder="Filter by ID or name…"
              style={{ width: "100%", marginBottom: 6 }}
            />
            <div
              role="listbox"
              aria-label="Projects"
              aria-multiselectable="true"
              style={{
                maxHeight: 280,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: "var(--pol-radius)",
                background: "var(--card)",
              }}
            >
              {candidates.length === 0 ? (
                <div
                  style={{
                    padding: "10px 12px",
                    fontSize: "var(--fs-sm)",
                    color: "var(--tm)",
                    fontStyle: "italic",
                  }}
                >
                  No projects match.
                </div>
              ) : (
                candidates.map((p) => {
                  const checked = memberSet.has(p.project_id);
                  const owner = assignedElsewhere.get(p.project_id);
                  return (
                    <label
                      key={p.project_id}
                      className="hoverable-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "20px 100px 1fr 150px",
                        gap: 8,
                        alignItems: "center",
                        padding: "6px 12px",
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                        opacity: owner && !checked ? 0.7 : 1,
                        fontSize: "var(--fs-sm)",
                        background: checked ? "var(--hover)" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(p.project_id)}
                        disabled={busy}
                        aria-label={`Toggle ${p.project_id} ${p.name}`}
                      />
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: 12,
                          color: "var(--t2)",
                        }}
                      >
                        {p.project_id}
                      </span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.name}
                      </span>
                      <span
                        style={{
                          color: "var(--tm)",
                          fontSize: "var(--fs-xs)",
                          textAlign: "right",
                        }}
                      >
                        {owner
                          ? checked
                            ? `Moving from: ${owner}`
                            : `In: ${owner}`
                          : (p.primary_objective ?? "No objective")}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {movingIds.length > 0 ? (
            <div
              style={{
                fontSize: "var(--fs-sm)",
                background: "var(--hover)",
                border: "1px solid var(--border)",
                padding: "8px 12px",
                borderRadius: "var(--pol-radius)",
              }}
            >
              Saving will move {movingIds.length} project
              {movingIds.length === 1 ? "" : "s"} out of{" "}
              {movingIds.length === 1 ? "its" : "their"} current use case
              {movingIds.length === 1 ? "" : "s"}: {movingIds.join(", ")}.
            </div>
          ) : null}

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
            disabled={busy || name.trim() === "" || primary === ""}
            className="pol-btn pol-btn-primary"
          >
            {busy ? "Saving…" : useCase ? "Save changes" : "Create use case"}
          </button>
        </footer>
      </div>
    </div>
  );
}
