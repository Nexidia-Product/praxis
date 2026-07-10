"use client";

/**
 * Key findings review view (Insights → Key findings).
 *
 * Pick a project (searchable dropdown), then review the most recent key
 * finding for each of its tasks — regardless of task status. Tasks with
 * no findings are hidden by default; a toggle reveals them. The table
 * defaults to task-ID order and every column header re-sorts. Each row
 * shows a short text preview; "View" opens a quick-view panel with the
 * task's findings in full (newest-first), formatting and tables intact.
 *
 * Tasks are fetched on demand from GET /api/tasks?project_id= so the
 * page load stays light no matter how many projects exist.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  KeyFindingEntry,
  Project,
  ProjectFindingSummary,
  Task,
} from "@/lib/db";

interface KeyFindingsViewProps {
  projects: Project[];
  /** Whether AI is enabled; gates the Generate/Regenerate summary button. */
  aiEnabled: boolean;
}

type SortKey = "task_id" | "task_name" | "status" | "when";
type SortDir = "asc" | "desc";

interface Row {
  task: Task;
  latest: KeyFindingEntry | null;
  findingCount: number;
}

export function KeyFindingsView({
  projects,
  aiEnabled,
}: KeyFindingsViewProps) {
  const [projectId, setProjectId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("task_id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [quickViewId, setQuickViewId] = useState<string | null>(null);

  // Persisted summary for the selected project (loaded independently of
  // tasks so a stored summary shows even while tasks are still loading).
  const [summary, setSummary] = useState<ProjectFindingSummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Fetch the selected project's tasks (includes key_findings).
  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuickViewId(null);
    fetch(`/api/tasks?project_id=${encodeURIComponent(projectId)}`)
      .then(async (r) => {
        const data = (await r.json()) as { tasks?: Task[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? "Failed to load tasks.");
        return data.tasks ?? [];
      })
      .then((t) => {
        if (!cancelled) setTasks(t);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tasks.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load the stored summary for the selected project.
  useEffect(() => {
    if (!projectId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setGenError(null);
    fetch(
      `/api/insights/findings-summary?projectId=${encodeURIComponent(projectId)}`,
    )
      .then(async (r) => {
        const data = (await r.json()) as {
          summary?: ProjectFindingSummary | null;
          error?: string;
        };
        if (!r.ok) throw new Error(data.error ?? "Failed to load summary.");
        return data.summary ?? null;
      })
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        // A summary is optional; don't block the page on a load failure.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const rows: Row[] = useMemo(
    () =>
      tasks.map((task) => ({
        task,
        latest: latestFinding(task.key_findings),
        findingCount: task.key_findings.length,
      })),
    [tasks],
  );

  const visible = useMemo(() => {
    const base = showAll ? rows : rows.filter((r) => r.latest);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => dir * compareRows(a, b, sortKey));
  }, [rows, showAll, sortKey, sortDir]);

  const withFindings = rows.filter((r) => r.latest).length;
  const selectedProject =
    projects.find((p) => p.project_id === projectId) ?? null;
  // The summary was generated over the findings that existed then; if the
  // current count differs, it may be stale.
  const summaryStale =
    summary != null && summary.source_finding_count !== withFindings;

  async function generateSummary() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/insights/findings-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as {
        summary?: ProjectFindingSummary;
        error?: string;
      };
      if (!res.ok || !data.summary) {
        throw new Error(data.error ?? "Could not generate the summary.");
      }
      setSummary(data.summary);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "Could not generate the summary.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function downloadMarkdown() {
    if (!summary || !selectedProject) return;
    const md = buildMarkdown(selectedProject, summary, rows);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `key-findings-${projectId}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const quickViewTask = quickViewId
    ? tasks.find((t) => t.task_id === quickViewId) ?? null
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-sm">
          <label className="block text-xs font-medium uppercase tracking-wider text-gray-700">
            Project
          </label>
          <div className="mt-1">
            <ProjectPicker
              projects={projects}
              value={projectId}
              onChange={setProjectId}
            />
          </div>
        </div>
        {projectId && !loading && !error ? (
          <label className="flex items-center gap-2 pb-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Show tasks without findings
          </label>
        ) : null}
      </div>

      {projectId ? (
        <section className="rounded-md border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">Summary</h2>
              {summary ? (
                <p className="text-[11px] text-gray-500">
                  Generated {formatWhen(summary.updated_at)}
                  {summary.generated_by_name
                    ? ` by ${summary.generated_by_name}`
                    : ""}{" "}
                  · {summary.source_finding_count} finding
                  {summary.source_finding_count === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {summary ? (
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Download markdown
                </button>
              ) : null}
              {aiEnabled ? (
                <button
                  type="button"
                  onClick={generateSummary}
                  disabled={generating || withFindings === 0}
                  className="rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating
                    ? "Generating…"
                    : summary
                      ? "Regenerate"
                      : "Generate summary"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="px-4 py-3">
            {genError ? (
              <p
                role="alert"
                className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
              >
                {genError}
              </p>
            ) : null}
            {summaryStale ? (
              <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Findings have changed since this summary was generated (
                {summary?.source_finding_count} → {withFindings}). Regenerate to
                update it.
              </p>
            ) : null}
            {generating ? (
              <p className="text-sm text-gray-500">
                Synthesizing the findings — this can take up to a minute.
              </p>
            ) : summary ? (
              <div className="pol-rich">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {summary.summary_md}
                </ReactMarkdown>
              </div>
            ) : withFindings === 0 ? (
              <p className="text-sm text-gray-500">
                No key findings yet — add findings on tasks to summarize.
              </p>
            ) : aiEnabled ? (
              <p className="text-sm text-gray-500">
                No summary generated yet. Click “Generate summary”.
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                No summary generated yet. AI generation is disabled in this
                environment.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {!projectId ? (
        <p className="text-sm text-gray-500">
          Select a project to review its task key findings.
        </p>
      ) : loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">This project has no tasks.</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500">
          No tasks have key findings yet.{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => setShowAll(true)}
          >
            Show all tasks
          </button>
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {withFindings} of {rows.length} task
            {rows.length === 1 ? "" : "s"} have key findings
            {showAll ? " · showing all tasks" : ""}.
          </p>
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortHeader
                    label="Task ID"
                    col="task_id"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="Task"
                    col="task_name"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="Status"
                    col="status"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Latest finding
                  </th>
                  <SortHeader
                    label="When"
                    col="when"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(({ task, latest, findingCount }) => (
                  <tr key={task.task_id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                      {task.task_id}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {task.task_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {task.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {latest ? (
                        <span className="line-clamp-2 block max-w-md">
                          {preview(latest.html)}
                        </span>
                      ) : (
                        <span className="text-gray-400">— no findings —</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                      {latest ? formatWhen(latest.created_at) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {latest ? (
                        <button
                          type="button"
                          onClick={() => setQuickViewId(task.task_id)}
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          View{findingCount > 1 ? ` (${findingCount})` : ""}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {quickViewTask ? (
        <FindingsQuickView
          task={quickViewTask}
          onClose={() => setQuickViewId(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable header
// ---------------------------------------------------------------------------

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className="px-3 py-2 text-left font-medium text-gray-600">
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 hover:text-gray-900"
      >
        {label}
        <span className="text-[10px] text-gray-400" aria-hidden>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Findings quick view — a right-hand panel with the task's findings in full
// ---------------------------------------------------------------------------

function FindingsQuickView({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const newestFirst = useMemo(
    () =>
      [...task.key_findings].sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
      ),
    [task.key_findings],
  );

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Key findings for ${task.task_id}`}
    >
      <div
        className="absolute inset-0 bg-gray-900/30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <header className="flex items-start justify-between border-b border-gray-200 p-6">
          <div className="min-w-0">
            <p className="font-mono text-xs font-medium text-gray-500">
              {task.task_id}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-gray-900">
              {task.task_name}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {task.status} · {task.key_findings.length} finding
              {task.key_findings.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {newestFirst.map((f) => (
            <div key={f.id} className="rounded-md border border-gray-200">
              <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500">
                {f.created_by_name ? (
                  <span className="font-medium text-gray-700">
                    {f.created_by_name}
                  </span>
                ) : (
                  <span>System</span>
                )}
                <span aria-hidden>·</span>
                <time dateTime={f.created_at} title={f.created_at}>
                  {formatWhen(f.created_at)}
                </time>
              </div>
              <div
                className="pol-rich overflow-x-auto px-3 py-2"
                dangerouslySetInnerHTML={{ __html: f.html }}
              />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searchable project picker (all projects, regardless of status)
// ---------------------------------------------------------------------------

function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          (a.project_id < b.project_id ? -1 : 1),
      ),
    [projects],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_id.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const selected = projects.find((p) => p.project_id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  function choose(p: Project) {
    onChange(p.project_id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[activeIdx]) choose(filtered[activeIdx]);
      else setOpen(true);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        <span className={selected ? "truncate" : "truncate text-gray-400"}>
          {selected
            ? `${selected.project_id} — ${selected.name}`
            : "Select a project…"}
        </span>
        <span className="ml-2 text-gray-400" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search projects…"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No matches.</li>
            ) : (
              filtered.map((p, i) => (
                <li key={p.project_id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => choose(p)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      i === activeIdx ? "bg-gray-100" : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="font-mono text-[11px] text-gray-500">
                      {p.project_id}
                    </span>
                    <span className="truncate text-gray-900">{p.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestFinding(entries: KeyFindingEntry[]): KeyFindingEntry | null {
  if (!entries || entries.length === 0) return null;
  return entries.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

function compareRows(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "task_id":
      return a.task.task_id < b.task.task_id
        ? -1
        : a.task.task_id > b.task.task_id
          ? 1
          : 0;
    case "task_name":
      return a.task.task_name.localeCompare(b.task.task_name, undefined, {
        sensitivity: "base",
      });
    case "status":
      return a.task.status.localeCompare(b.task.status);
    case "when": {
      const av = a.latest?.created_at ?? "";
      const bv = b.latest?.created_at ?? "";
      if (av === bv) return 0;
      // Tasks without a finding have no date; they only appear when
      // "show all" is on, and cluster at the ascending end (top in asc,
      // bottom in desc) — the caller applies the direction multiplier.
      if (!av) return 1;
      if (!bv) return -1;
      return av < bv ? -1 : 1;
    }
  }
}

function buildMarkdown(
  project: Project,
  summary: ProjectFindingSummary,
  rows: Row[],
): string {
  const withFindings = rows
    .filter((r): r is Row & { latest: KeyFindingEntry } => r.latest !== null)
    .sort((a, b) => (a.task.task_id < b.task.task_id ? -1 : 1));

  const lines: string[] = [
    `# Key findings — ${project.name} (${project.project_id})`,
    "",
    `_Summary generated ${formatWhen(summary.updated_at)}${
      summary.generated_by_name ? ` by ${summary.generated_by_name}` : ""
    }._`,
    "",
    "## Summary",
    "",
    summary.summary_md.trim(),
    "",
    "## Findings",
    "",
  ];

  // Findings are rich HTML (tables included); embed them as HTML blocks —
  // valid inside Markdown and preserves tables that plain text would lose.
  for (const { task, latest } of withFindings) {
    lines.push(`### ${task.task_id} — ${task.task_name} (${task.status})`);
    lines.push("");
    lines.push(
      `_Recorded ${formatWhen(latest.created_at)}${
        latest.created_by_name ? ` by ${latest.created_by_name}` : ""
      }._`,
    );
    lines.push("");
    lines.push(latest.html.trim());
    lines.push("");
  }

  return lines.join("\n");
}

function preview(html: string): string {
  if (typeof document === "undefined") return "";
  const el = document.createElement("div");
  el.innerHTML = html;
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
