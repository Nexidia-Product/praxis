"use client";

/**
 * Public idea submission form (Section 5.17).
 *
 * Client-side because we own:
 *   - field state (controlled inputs)
 *   - inline validation messages
 *   - the post-submit confirmation view (we swap to a success card rather
 *     than reload the page, since the user has nowhere logged-in to land)
 *
 * On 429 we surface a "too many submissions" message specifically — the
 * generic error swallows the real reason and a confused user tends to
 * keep retrying, making the rate limit even more punishing.
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

interface FormState {
  submitter_name: string;
  submitter_email: string;
  idea_name: string;
  description: string;
  urgency: IdeaUrgency;
  requested_target_date: string;
  key_stakeholders: string;
}

const EMPTY: FormState = {
  submitter_name: "",
  submitter_email: "",
  idea_name: "",
  description: "",
  urgency: "Medium",
  requested_target_date: "",
  key_stakeholders: "",
};

interface SubmittedIdea {
  idea_id: string;
  idea_name: string;
  submitted_at: string;
  status: string;
}

export function IdeaSubmitForm() {
  const [state, setState] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedIdea | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const payload = {
      submitter_name: state.submitter_name.trim(),
      submitter_email: state.submitter_email.trim() || null,
      idea_name: state.idea_name.trim(),
      description: state.description.trim(),
      urgency: state.urgency,
      requested_target_date: state.requested_target_date || null,
      key_stakeholders: state.key_stakeholders.trim(),
    };

    let res: Response;
    try {
      res = await fetch("/api/public/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setError(
        "Couldn't reach the server. Check your connection and try again.",
      );
      setSubmitting(false);
      return;
    }

    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      const minutes = retry ? Math.ceil(Number(retry) / 60) : null;
      setError(
        minutes && Number.isFinite(minutes)
          ? `Too many submissions from this address. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
          : "Too many submissions from this address. Please try again later.",
      );
      setSubmitting(false);
      return;
    }

    let body: { idea?: SubmittedIdea; error?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      setError("Server response wasn't valid JSON. Please try again.");
      setSubmitting(false);
      return;
    }

    if (!res.ok || !body.idea) {
      setError(body.error ?? "Submission failed. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitted(body.idea);
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">
          Thanks — your idea has been submitted.
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          A team member will review &ldquo;{submitted.idea_name}&rdquo; and
          {state.submitter_email
            ? " send an update to the email you provided."
            : " follow up if more information is needed."}
        </p>
        <p className="mt-1 text-xs text-emerald-900/80">
          Reference ID: <span className="font-mono">{submitted.idea_id}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(null);
            setState(EMPTY);
          }}
          className="mt-4 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-100"
        >
          Submit another idea
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="submitter_name"
          label="Your name"
          required
          value={state.submitter_name}
          onChange={(v) => update("submitter_name", v)}
          disabled={submitting}
        />
        <Field
          id="submitter_email"
          label="Email (optional)"
          type="email"
          autoComplete="email"
          value={state.submitter_email}
          onChange={(v) => update("submitter_email", v)}
          disabled={submitting}
          help="If provided, you'll get an update when the idea is reviewed."
        />
      </div>

      <Field
        id="idea_name"
        label="Idea title"
        required
        value={state.idea_name}
        onChange={(v) => update("idea_name", v)}
        disabled={submitting}
        help="A short, scannable title — one line."
      />

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-gray-900"
        >
          Description <span className="text-red-600">*</span>
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={6}
          value={state.description}
          onChange={(e) => update("description", e.target.value)}
          disabled={submitting}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          placeholder="What's the idea, who would it help, and what does success look like?"
        />
        <p className="mt-1 text-xs text-gray-500">
          The more specific the better. Include the user, the problem, and a
          rough sketch of the proposed solution.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="urgency"
            className="block text-sm font-medium text-gray-900"
          >
            Urgency <span className="text-red-600">*</span>
          </label>
          <select
            id="urgency"
            name="urgency"
            value={state.urgency}
            onChange={(e) => update("urgency", e.target.value as IdeaUrgency)}
            disabled={submitting}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          >
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {URGENCY_HELP[state.urgency]}
          </p>
        </div>

        <Field
          id="requested_target_date"
          label="Requested target date (optional)"
          type="date"
          value={state.requested_target_date}
          onChange={(v) => update("requested_target_date", v)}
          disabled={submitting}
          help="When would you like this delivered, if there's a deadline?"
        />
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
          name="key_stakeholders"
          type="text"
          value={state.key_stakeholders}
          onChange={(e) => update("key_stakeholders", e.target.value)}
          disabled={submitting}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
          placeholder="e.g., Customer Support, Compliance, Product"
        />
        <p className="mt-1 text-xs text-gray-500">
          Teams or individuals who would benefit or need to be involved.
        </p>
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
          submitting ||
          !state.submitter_name.trim() ||
          !state.idea_name.trim() ||
          !state.description.trim()
        }
        className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {submitting ? "Submitting…" : "Submit idea"}
      </button>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  type?: "text" | "email" | "date";
  autoComplete?: string;
  help?: string;
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  required,
  type = "text",
  autoComplete,
  help,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
      />
      {help ? <p className="mt-1 text-xs text-gray-500">{help}</p> : null}
    </div>
  );
}
