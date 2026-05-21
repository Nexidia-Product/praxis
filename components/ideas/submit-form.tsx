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

import { useRef, useState } from "react";

import type { IdeaUrgency } from "@/lib/db";
import {
  ALLOWED_ACCEPT_ATTR,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_SUBMISSION,
  MAX_TOTAL_SIZE_BYTES,
  formatBytes,
} from "@/lib/ideas/attachments";

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
  attachments_count?: number;
}

export function IdeaSubmitForm() {
  const [state, setState] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedIdea | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  /**
   * Add the user's freshly-selected files to the existing list,
   * applying the same constraints the server enforces — count cap,
   * per-file size, total size, MIME allowlist. We reject the whole
   * batch on the first failure with a clear message; partial
   * acceptance would silently drop files and confuse the submitter.
   */
  function handleFilesPicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);

    const incoming = Array.from(picked);
    const combined = [...files, ...incoming];

    if (combined.length > MAX_FILES_PER_SUBMISSION) {
      setError(
        `You can attach up to ${MAX_FILES_PER_SUBMISSION} files per submission.`,
      );
      return;
    }

    let runningTotal = 0;
    for (const f of combined) {
      if (!ALLOWED_MIME_TYPES.has(f.type)) {
        setError(
          `"${f.name}" has an unsupported file type (${f.type || "unknown"}). Allowed: Office docs, PNG/JPG/GIF/WEBP images, PDF, plain text, CSV.`,
        );
        return;
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setError(
          `"${f.name}" is ${formatBytes(f.size)} — max per file is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
        );
        return;
      }
      runningTotal += f.size;
    }
    if (runningTotal > MAX_TOTAL_SIZE_BYTES) {
      setError(
        `Combined attachment size exceeds ${formatBytes(MAX_TOTAL_SIZE_BYTES)}.`,
      );
      return;
    }

    setFiles(combined);
    // Reset the underlying input so the same file can be re-picked
    // after removal — without this, the change event won't fire
    // because the value hasn't changed.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const totalPct = Math.min(
    100,
    Math.round((totalSize / MAX_TOTAL_SIZE_BYTES) * 100),
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    // FormData lets us send the idea fields and attachment Files in
    // one multipart request. This replaces the prior JSON body.
    const form = new FormData();
    form.set("submitter_name", state.submitter_name.trim());
    form.set("submitter_email", state.submitter_email.trim());
    form.set("idea_name", state.idea_name.trim());
    form.set("description", state.description.trim());
    form.set("urgency", state.urgency);
    form.set("requested_target_date", state.requested_target_date);
    form.set("key_stakeholders", state.key_stakeholders.trim());
    for (const f of files) {
      form.append("attachments", f, f.name);
    }

    let res: Response;
    try {
      res = await fetch("/api/public/ideas", {
        method: "POST",
        body: form,
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
            setFiles([]);
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

      {/* Attachments */}
      <div>
        <label
          htmlFor="attachments"
          className="block text-sm font-medium text-gray-900"
        >
          Attachments (optional)
        </label>
        <p className="mt-1 text-xs text-gray-500">
          Up to {MAX_FILES_PER_SUBMISSION} files, {formatBytes(MAX_TOTAL_SIZE_BYTES)} combined.
          Allowed: Office documents (.docx, .xlsx, .pptx, .doc, .xls, .ppt),
          images (.png, .jpg, .gif, .webp), .pdf, .txt, .csv.
        </p>
        <input
          ref={fileInputRef}
          id="attachments"
          name="attachments"
          type="file"
          multiple
          accept={ALLOWED_ACCEPT_ATTR}
          onChange={(e) => handleFilesPicked(e.target.files)}
          disabled={submitting || files.length >= MAX_FILES_PER_SUBMISSION}
          className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        />

        {files.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  <span className="font-medium text-gray-900">{f.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {formatBytes(f.size)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  disabled={submitting}
                  aria-label={`Remove ${f.name}`}
                  className="text-xs font-medium text-gray-600 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {files.length > 0 ? (
          <div className="mt-2" aria-label="Total attachment size">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>
                {formatBytes(totalSize)} / {formatBytes(MAX_TOTAL_SIZE_BYTES)}
              </span>
              <span>
                {files.length} of {MAX_FILES_PER_SUBMISSION} files
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full ${
                  totalPct >= 90 ? "bg-amber-500" : "bg-gray-900"
                }`}
                style={{ width: `${totalPct}%` }}
              />
            </div>
          </div>
        ) : null}
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
