"use client";

/**
 * AI Priority Review modal (§5.18.2).
 *
 * Opens from the Projects page toolbar. Calls POST /api/ai/prioritize
 * (which gathers every open project, sends them to the model with
 * full context, and returns a ranked list with rationales). Output
 * is advisory — nothing is auto-applied. The user reviews the
 * ranking, then clicks individual projects to act on them.
 *
 * Each ranked row links to the project's quick view by triggering
 * the parent's `onSelectProject` callback. The parent decides what
 * "open" means — usually open the quick-view drawer that the
 * Projects table already has.
 */

import { useState } from "react";

import type { Project, ProjectId } from "@/lib/db";

interface RankedProject {
  project_id: ProjectId;
  recommended_rank: number;
  rationale: string;
}

interface PrioritizeResult {
  ranked: RankedProject[];
  cohort_notes: string;
  modelId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onSelectProject: (id: ProjectId) => void;
}

export function AiPriorityReviewModal({
  open,
  onClose,
  projects,
  onSelectProject,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrioritizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/ai/prioritize", { method: "POST" });
      const data = (await resp.json().catch(() => ({}))) as
        | PrioritizeResult
        | { error?: string };
      if (!resp.ok || !("ranked" in data)) {
        throw new Error(
          ("error" in data && data.error) ||
            `Prioritize failed (HTTP ${resp.status})`,
        );
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prioritize failed.");
    } finally {
      setBusy(false);
    }
  }

  const projectById = new Map(projects.map((p) => [p.project_id, p]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Priority Review"
      className="pol-modal-overlay"
      onClick={onClose}
    >
      <div
        className="pol-modal"
        style={{ maxWidth: 760 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pol-modal-header">
          <h2 className="pol-modal-title">AI Priority Review</h2>
          <button
            type="button"
            className="pol-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="pol-modal-body" style={{ maxHeight: "70vh" }}>
          {!result ? (
            <div>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--t2)", margin: 0 }}>
                The AI Advisor will read every open project (priority,
                status, dependencies, target dates, descriptions) and
                produce a recommended ranking with a short rationale per
                project. The output is advisory — nothing is auto-applied.
              </p>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="pol-btn pol-btn-primary"
                style={{ marginTop: 16 }}
              >
                {busy ? "Reviewing…" : "Run review"}
              </button>
              {error ? (
                <p
                  role="alert"
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--err)",
                    marginTop: 12,
                  }}
                >
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {result.cohort_notes ? (
                <div
                  style={{
                    background: "var(--hover)",
                    padding: "10px 12px",
                    borderRadius: "var(--pol-radius)",
                    fontSize: "var(--fs-sm)",
                  }}
                >
                  <strong>Overview:</strong> {result.cohort_notes}
                </div>
              ) : null}
              <ol
                style={{
                  listStyle: "decimal",
                  margin: 0,
                  paddingLeft: 24,
                  display: "grid",
                  gap: 8,
                }}
              >
                {result.ranked.map((r) => {
                  const p = projectById.get(r.project_id);
                  return (
                    <li key={r.project_id}>
                      <button
                        type="button"
                        onClick={() => onSelectProject(r.project_id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--brand)",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                          textAlign: "left",
                        }}
                      >
                        {p ? `${r.project_id} — ${p.name}` : r.project_id}
                      </button>
                      <div
                        style={{
                          fontSize: "var(--fs-sm)",
                          color: "var(--t2)",
                          marginTop: 2,
                        }}
                      >
                        {r.rationale}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--tm)",
                  marginTop: 8,
                }}
              >
                Model: {result.modelId}
              </p>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="pol-btn"
                style={{ alignSelf: "flex-start" }}
              >
                {busy ? "Reviewing…" : "Re-run review"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
