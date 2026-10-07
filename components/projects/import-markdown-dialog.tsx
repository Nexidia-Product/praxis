"use client";

/**
 * "Import from Markdown" dialog for the project quick view.
 *
 * Flow: choose a PROJECT.md (as produced by the Export action and
 * enriched by the use-case scoping skill) → parse + plan → preview →
 * Apply. All merge rules live in `lib/projects/markdown-import.ts`; this
 * component only renders the plan and sends one PATCH with the fields the
 * reviewer left checked.
 */

import { useMemo, useState } from "react";

import type { Project } from "@/lib/db";
import {
  buildImportPayload,
  parseProjectMarkdown,
  planImport,
  type ImportPlan,
  type ReplacedFieldKey,
} from "@/lib/projects/markdown-import";

interface ImportMarkdownDialogProps {
  project: Project;
  outcomeProducts: string[];
  outcomeTypes: string[];
  onImported: (project: Project) => void;
  onClose: () => void;
}

export function ImportMarkdownDialog({
  project,
  outcomeProducts,
  outcomeTypes,
  onImported,
  onClose,
}: ImportMarkdownDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [accepted, setAccepted] = useState<Set<ReplacedFieldKey>>(new Set());
  const [includeOutcomes, setIncludeOutcomes] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  async function onFile(file: File | undefined) {
    setPlan(null);
    setReadError(null);
    setApplyError(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseProjectMarkdown(text, {
        products: outcomeProducts,
        types: outcomeTypes,
      });
      const next = planImport(project, parsed);
      setPlan(next);
      setAccepted(new Set(next.fields.filter((f) => f.changed).map((f) => f.key)));
      setIncludeOutcomes(true);
    } catch {
      setReadError("Could not read that file.");
    }
  }

  const payload = useMemo(
    () => (plan ? buildImportPayload(plan, accepted, includeOutcomes) : {}),
    [plan, accepted, includeOutcomes],
  );
  const canApply =
    plan !== null && plan.errors.length === 0 && Object.keys(payload).length > 0 && !applying;

  function toggleField(key: ReplacedFieldKey) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function apply() {
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.project_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        project?: Project;
        error?: string;
      };
      if (!res.ok || !data.project) {
        setApplyError(data.error ?? "Import failed.");
        return;
      }
      onImported(data.project);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-md-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <header className="border-b border-gray-200 px-6 py-4">
          <h2 id="import-md-title" className="text-base font-semibold text-gray-900">
            Import from Markdown
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Updates Description, Definition of Done, Supports and Benefits (replaced) and adds
            new Outcomes (existing ones are kept) on {project.name}.
          </p>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
          <div>
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50"
            />
            {readError ? <p className="mt-2 text-red-700">{readError}</p> : null}
          </div>

          {plan ? (
            <>
              {plan.errors.length > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                  {plan.errors.map((e) => (
                    <p key={e}>{e}</p>
                  ))}
                </div>
              ) : null}

              {plan.warnings.length > 0 ? (
                <ul className="list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 pl-7 text-amber-900">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}

              {plan.errors.length === 0 ? (
                <>
                  <section className="space-y-3">
                    {plan.fields.map((f) => (
                      <div key={f.key} className="rounded-md border border-gray-200 p-3">
                        <label className="flex items-center gap-2 font-medium text-gray-900">
                          <input
                            type="checkbox"
                            checked={accepted.has(f.key)}
                            disabled={!f.changed}
                            onChange={() => toggleField(f.key)}
                          />
                          {f.label}
                          <span className="text-xs font-normal text-gray-500">
                            {f.after === null
                              ? "not in file — unchanged"
                              : f.changed
                                ? f.clears
                                  ? "will be cleared"
                                  : "will be replaced"
                                : "no change"}
                          </span>
                        </label>
                        {f.changed ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <DiffBox title="Current" text={f.before} />
                            <DiffBox title="From file" text={f.after ?? ""} />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </section>

                  <section className="rounded-md border border-gray-200 p-3">
                    <label className="flex items-center gap-2 font-medium text-gray-900">
                      <input
                        type="checkbox"
                        checked={includeOutcomes}
                        disabled={plan.outcomes.added.length === 0}
                        onChange={(e) => setIncludeOutcomes(e.target.checked)}
                      />
                      Outcomes
                      <span className="text-xs font-normal text-gray-500">
                        {plan.outcomes.kept.length} kept · {plan.outcomes.added.length} to add ·{" "}
                        {plan.outcomes.duplicates.length} already present
                      </span>
                    </label>
                    {plan.outcomes.added.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-800">
                        {plan.outcomes.added.map((o) => {
                          const tags = [o.product, o.type].filter(Boolean).join(", ");
                          return (
                            <li key={o.text}>
                              {o.text}
                              {tags ? <span className="text-gray-500"> ({tags})</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>

                  {!plan.hasChanges ? (
                    <p className="text-gray-600">
                      {fileName} matches the project — nothing to import.
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {applyError ? <p className="text-red-700">{applyError}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!canApply}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? "Importing…" : "Apply import"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DiffBox({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</div>
      <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-800">
        {text.trim() ? text : <span className="italic text-gray-400">empty</span>}
      </div>
    </div>
  );
}
