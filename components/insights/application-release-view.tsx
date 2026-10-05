"use client";

/**
 * Application Release view.
 *
 * A release-date picker over a grid of per-project cards in the same
 * visual language as the Key Capabilities cards (identity + health
 * header, task-progress strip, latest status note, outcomes), extended
 * with stage, primary objective, use case, schedule-risk and blockers.
 * Read-only: selecting a date just updates `?date=` and the server
 * re-renders.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  priorityBadgeClass,
} from "@/lib/projects/display";
import { formatQuarter, latestStatusSummary } from "@/lib/key-capabilities";
import type { ReleaseDateOption } from "@/lib/releases/calendar";
import type {
  ReleaseProjectEntry,
  ReleaseReport,
} from "@/lib/releases/report";
import { OutcomesList } from "@/components/projects/outcomes-list";

interface Props {
  options: ReleaseDateOption[];
  selectedDate: string | null;
  today: string;
  report: ReleaseReport | null;
  /** Whether the viewer may add/edit/delete release caveats. */
  canEditCaveats: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ApplicationReleaseView({
  options,
  selectedDate,
  today,
  report,
  canEditCaveats,
}: Props) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      {/* Release date picker */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
        <label
          htmlFor="release-date"
          className="text-sm font-medium text-gray-700"
        >
          Release date
        </label>
        <select
          id="release-date"
          value={selectedDate ?? ""}
          onChange={(e) =>
            router.push(
              `/insights/application-release?date=${encodeURIComponent(e.target.value)}`,
            )
          }
          className="min-w-[18rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          {options.length === 0 ? <option value="">No release dates</option> : null}
          {options.map((o) => (
            <option key={o.date} value={o.date}>
              {formatDate(o.date)}
              {o.date === today ? " (today)" : ""}
              {" — "}
              {o.projectCount} project{o.projectCount === 1 ? "" : "s"}
              {o.offCycle ? " (off-cycle)" : ""}
            </option>
          ))}
        </select>
        {selectedDate ? (
          <span className="text-xs text-gray-500">
            {selectedDate < today
              ? "Past release"
              : selectedDate === today
                ? "Releases today"
                : "Upcoming release"}
          </span>
        ) : null}
      </div>

      {report ? (
        <>
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
            <Summary value={report.entries.length} label="projects" />
            <Summary
              value={report.missedCount}
              label="missed delivery"
              danger={report.missedCount > 0}
            />
            <Summary
              value={report.atRiskCount}
              label="at risk"
              danger={report.atRiskCount > 0}
            />
            <Summary
              value={report.blockedCount}
              label="with blockers"
              danger={report.blockedCount > 0}
            />
            <Summary value={report.deliveredCount} label="delivered" />
          </div>

          {report.entries.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              No projects are aligned to this release date.
            </p>
          ) : (
            <div className="space-y-2">
              <div
                className={`hidden gap-3 px-3 text-[10px] font-medium uppercase tracking-wide text-gray-400 ${ROW_COLS}`}
              >
                <span>Project</span>
                <span>Stage &amp; alignment</span>
                <span>Planned dates</span>
                <span>Progress</span>
                <span>Risk, blockers &amp; status</span>
              </div>
              {report.entries.map((entry) => (
                <ReleaseRow
                  key={entry.project.project_id}
                  entry={entry}
                  releaseDate={report.date}
                  canEditCaveats={canEditCaveats}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No release dates available yet.
        </p>
      )}
    </div>
  );
}

function Summary({
  value,
  label,
  danger = false,
}: {
  value: number;
  label: string;
  danger?: boolean;
}) {
  return (
    <span>
      <span
        className={`font-semibold ${danger ? "text-rose-600" : "text-gray-900"}`}
      >
        {value}
      </span>{" "}
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

/** Column template shared by the header and every row (desktop only). */
const ROW_COLS =
  "lg:grid lg:[grid-template-columns:230px_190px_220px_150px_minmax(0,1fr)]";

function ReleaseRow({
  entry,
  releaseDate,
  canEditCaveats,
}: {
  entry: ReleaseProjectEntry;
  releaseDate: string;
  canEditCaveats: boolean;
}) {
  const { project, stats } = entry;
  const statusSummary = latestStatusSummary(project.status_history);

  return (
    <div
      className={`flex flex-col gap-3 rounded-md border bg-white p-3 shadow-sm ${ROW_COLS} ${
        entry.atRisk || entry.missedDelivery
          ? "border-rose-300"
          : "border-gray-200"
      }`}
    >
      {/* Project identity + health */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-gray-500">
            {project.project_id}
          </span>
          <span
            className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityBadgeClass(project.priority)}`}
          >
            {project.priority}
          </span>
          {project.health_score ? (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_BADGE[project.health_score]}`}
              title={HEALTH_TOOLTIP[project.health_score]}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health_score]}`}
              />
              {project.health_score}
            </span>
          ) : null}
        </div>
        <h3 className="mt-0.5 text-sm font-semibold leading-snug text-gray-900">
          {project.name}
        </h3>
        {project.is_key_capability ? (
          <span
            className="mt-1 inline-flex rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
            title="Designated key capability"
          >
            Key capability
            {project.key_capability_quarter
              ? ` · ${formatQuarter(project.key_capability_quarter)}`
              : ""}
          </span>
        ) : null}
        <div className="mt-1 text-[11px] text-gray-500">
          Lead: {entry.leadName || "—"}
        </div>
        <div className="text-[11px] text-gray-500">{project.track || "—"}</div>
      </div>

      {/* Stage + alignment */}
      <dl className="space-y-1.5 text-[11px]">
        <Fact label="Stage">
          {project.stage || "—"}
          {entry.stageIndex > 0
            ? ` (${entry.stageIndex}/${entry.stageCount})`
            : ""}
        </Fact>
        <Fact label="Status">{project.status}</Fact>
        <Fact label="Primary objective">
          {project.primary_objective || "—"}
        </Fact>
        <Fact label="Use case">
          {entry.useCaseNames.length > 0 ? entry.useCaseNames.join(", ") : "—"}
        </Fact>
      </dl>

      {/* Planned dates */}
      <div className="text-[11px]">
        <ul className="space-y-0.5 text-gray-700">
          <li className="flex justify-between gap-2 font-medium">
            <span>Application deploy</span>
            <span className="font-mono">{project.target_date || "—"}</span>
          </li>
          <li className="flex justify-between gap-2 font-medium">
            <span>Executable deploy</span>
            <span className="font-mono">
              {project.target_executable_deployment_date || "—"}
            </span>
          </li>
          {entry.milestones.map((m) => (
            <li
              key={m.label}
              className={`flex justify-between gap-2 ${
                m.passed ? "text-gray-400" : "text-gray-600"
              }`}
              title={m.passed ? "Date has passed" : undefined}
            >
              <span className="truncate">
                {m.label}
                {m.passed ? " ✓" : ""}
              </span>
              <span className="shrink-0 font-mono">{m.date}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Task progress */}
      <div>
        <div className="grid grid-cols-4 gap-1">
          <MiniStat label="Open" value={stats.open} />
          <MiniStat
            label="Late"
            value={stats.pastDue}
            danger={stats.pastDue > 0}
          />
          <MiniStat
            label="Blkd"
            value={stats.blocked}
            danger={stats.blocked > 0}
          />
          <MiniStat label="Done" value={stats.completed} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500">
          <span>
            {stats.completed}/{stats.total} tasks
          </span>
          <span className="font-medium text-gray-700">{stats.pctComplete}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${stats.pctComplete}%` }}
          />
        </div>
      </div>

      {/* Risk, blockers, status */}
      <div className="min-w-0 space-y-2 text-[11px]">
        {entry.delivered ? (
          <div className="rounded-md bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
            Delivered — reached {project.stage} after the {project.target_date}{" "}
            release.
          </div>
        ) : null}

        {entry.atRisk ? (
          <div
            role="alert"
            className="rounded-md bg-rose-50 px-2.5 py-1.5 text-rose-800 ring-1 ring-inset ring-rose-200"
          >
            <div className="font-semibold">
              {entry.missedDelivery
                ? `Missed delivery — ${project.target_date} release`
                : `At risk of missing the ${project.target_date} release`}
            </div>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {entry.riskReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {entry.blockers.length > 0 ? (
          <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-900 ring-1 ring-inset ring-amber-200">
            <div className="font-semibold uppercase tracking-wide">
              Blocked ({entry.blockers.length})
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {entry.blockers.map((b, i) => (
                <li key={`${b.subject}-${i}`}>
                  <span className="font-medium">
                    {b.scope === "task" ? "Task " : ""}
                    {b.subject}:
                  </span>{" "}
                  {b.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="leading-snug">
          <span className="font-medium uppercase tracking-wide text-gray-400">
            Status
          </span>{" "}
          {statusSummary ? (
            <span className="text-gray-600">{statusSummary}</span>
          ) : (
            <span className="italic text-gray-400">—</span>
          )}
        </div>

        <OutcomesList outcomes={project.outcomes} />

        <CaveatsPanel
          projectId={project.project_id}
          releaseDate={releaseDate}
          caveats={entry.caveats}
          canEdit={canEditCaveats}
        />
      </div>
    </div>
  );
}

/**
 * Release caveats for one project: a running record of limitations,
 * assumptions or exceptions for this release, each with author and date.
 * Editors can add, edit and delete; everyone else reads. Mutations hit
 * /api/release-caveats and then refresh the server data.
 */
function CaveatsPanel({
  projectId,
  releaseDate,
  caveats,
  canEdit,
}: {
  projectId: string;
  releaseDate: string;
  caveats: ReleaseProjectEntry["caveats"];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(
    url: string,
    method: "POST" | "PUT" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const ok = await call("/api/release-caveats", "POST", {
      release_date: releaseDate,
      project_id: projectId,
      caveat: draft,
    });
    if (ok) {
      setDraft("");
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    const ok = await call(`/api/release-caveats/${id}`, "PUT", {
      caveat: editText,
    });
    if (ok) setEditingId(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this caveat?")) return;
    await call(`/api/release-caveats/${id}`, "DELETE");
  }

  if (caveats.length === 0 && !canEdit) return null;

  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-1.5 ring-1 ring-inset ring-gray-200">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Caveats ({caveats.length})
        </span>
        {canEdit && !adding ? (
          <button
            type="button"
            className="text-[11px] font-medium text-blue-700 hover:underline"
            onClick={() => setAdding(true)}
          >
            + Add caveat
          </button>
        ) : null}
      </div>

      {caveats.length === 0 && !adding ? (
        <p className="mt-0.5 italic text-gray-400">None recorded.</p>
      ) : null}

      <ul className="mt-1 space-y-1.5">
        {caveats.map((c) => (
          <li key={c.caveat_id} className="text-gray-700">
            {editingId === c.caveat_id ? (
              <div className="space-y-1">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  disabled={busy}
                  className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="pol-btn pol-btn-primary pol-btn-sm"
                    disabled={busy || editText.trim() === ""}
                    onClick={() => saveEdit(c.caveat_id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="pol-btn pol-btn-ghost pol-btn-sm"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{c.caveat}</p>
                <p className="text-[10px] text-gray-400">
                  {c.created_by_name || "Unknown"} ·{" "}
                  {c.created_at.slice(0, 10)}
                  {c.updated_at.slice(0, 19) !== c.created_at.slice(0, 19)
                    ? " (edited)"
                    : ""}
                  {canEdit ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => {
                          setEditingId(c.caveat_id);
                          setEditText(c.caveat);
                        }}
                      >
                        Edit
                      </button>
                      {" · "}
                      <button
                        type="button"
                        className="text-rose-700 hover:underline"
                        onClick={() => remove(c.caveat_id)}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-1.5 space-y-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={2000}
            disabled={busy}
            autoFocus
            placeholder="Limitations, assumptions, or exceptions for this project in this release"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="pol-btn pol-btn-primary pol-btn-sm"
              disabled={busy || draft.trim() === ""}
              onClick={add}
            >
              {busy ? "Saving…" : "Add"}
            </button>
            <button
              type="button"
              className="pol-btn pol-btn-ghost pol-btn-sm"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-gray-700">
        {children}
      </dd>
    </div>
  );
}

function MiniStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={`text-base font-semibold ${danger ? "text-rose-600" : "text-gray-900"}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
    </div>
  );
}
