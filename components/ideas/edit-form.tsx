"use client";

/**
 * Public idea edit form.
 *
 * Mirrors the submittable fields of `IdeaSubmitForm` (title, description,
 * urgency, target date, stakeholders) but pre-filled and PATCHed to the
 * token-authorized endpoint. Attachments and the submitter's name/email
 * aren't editable here — the link edits the idea's content only.
 *
 * On a 409 the idea has been converted while the page was open; we swap to
 * a terminal "can no longer edit" message rather than letting the user keep
 * trying to save.
 */

import { useState } from "react";

import type { IdeaUrgency } from "@/lib/db";

const URGENCIES: IdeaUrgency[] = ["Low", "Medium", "High", "Critical"];

const URGENCY_HELP: Record<IdeaUrgency, string> = {
  Critical: "A blocking issue or urgent opportunity that needs attention now.",
  High: "Important; should be picked up in the next planning cycle.",
  Medium: "Worth doing; no specific deadline.",
  Low: "A nice-to-have for later.",
};

interface EditFormState {
  idea_name: string;
  description: string;
  urgency: IdeaUrgency;
  requested_target_date: string;
  key_stakeholders: string;
}

interface IdeaEditFormProps {
  token: string;
  initial: EditFormState;
}

type Result = "saved" | "converted" | null;

export function IdeaEditForm({ token, initial }: IdeaEditFormProps) {
  const [state, setState] = useState<EditFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);

  function update<K extends keyof EditFormState>(
    key: K,
    value: EditFormState[K],
  ) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/public/ideas/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          idea_name: state.idea_name.trim(),
          description: state.description.trim(),
          urgency: state.urgency,
          requested_target_date: state.requested_target_date,
          key_stakeholders: state.key_stakeholders.trim(),
        }),
      });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSaving(false);
      return;
    }

    if (res.status === 409) {
      // Converted while the page was open — editing is now frozen.
      setResult("converted");
      setSaving(false);
      return;
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not save your changes. Please try again.");
      setSaving(false);
      return;
    }

    setResult("saved");
    setSaving(false);
  }

  if (result === "converted") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-900">
          This idea has been converted to a project
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          It can no longer be edited here. Your earlier changes may not have
          been saved. Reach out to the team if something needs to change.
        </p>
      </div>
    );
  }

  if (result === "saved") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">
          Your changes have been saved.
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          &ldquo;{state.idea_name}&rdquo; has been updated. You can keep editing
          from the same link until the idea is converted to a project.
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="mt-4 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-100"
        >
          Keep editing
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="idea_name" className="block text-sm font-medium text-gray-900">
          Idea title <span className="text-red-600">*</span>
        </label>
        <input
          id="idea_name"
          type="text"
          required
          value={state.idea_name}
          onChange={(e) => update("idea_name", e.target.value)}
          disabled={saving}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-900">
          Description <span className="text-red-600">*</span>
        </label>
        <textarea
          id="description"
          required
          rows={6}
          value={state.description}
          onChange={(e) => update("description", e.target.value)}
          disabled={saving}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="urgency" className="block text-sm font-medium text-gray-900">
            Urgency <span className="text-red-600">*</span>
          </label>
          <select
            id="urgency"
            value={state.urgency}
            onChange={(e) => update("urgency", e.target.value as IdeaUrgency)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          >
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">{URGENCY_HELP[state.urgency]}</p>
        </div>

        <div>
          <label
            htmlFor="requested_target_date"
            className="block text-sm font-medium text-gray-900"
          >
            Requested target date (optional)
          </label>
          <input
            id="requested_target_date"
            type="date"
            value={state.requested_target_date}
            onChange={(e) => update("requested_target_date", e.target.value)}
            disabled={saving}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="key_stakeholders"
          className="block text-sm font-medium text-gray-900"
        >
          Key stakeholders (optional)
        </label>
        <input
          id="key_stakeholders"
          type="text"
          value={state.key_stakeholders}
          onChange={(e) => update("key_stakeholders", e.target.value)}
          disabled={saving}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          placeholder="e.g., Customer Support, Compliance, Product"
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={
          saving ||
          !state.idea_name.trim() ||
          !state.description.trim()
        }
        className="w-full rounded-md bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-dark)] disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
