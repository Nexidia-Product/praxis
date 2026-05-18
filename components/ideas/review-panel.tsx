"use client";

/**
 * Idea review panel (Section 5.18).
 *
 * One screen, three sections:
 *
 *   1. Submission details — read-only summary of what was submitted.
 *   2. Reviewer controls — status change, admin comments, AI overlap.
 *   3. Convert to project — pops open the conversion form pre-filled
 *      from the idea, posts to /api/ideas/[id]/convert which runs the
 *      payload through the project service and back-links the idea.
 *
 * State management is local. All writes hit /api/ideas/[id] (status,
 * comments, overlap analysis) or /api/ideas/[id]/convert. After a
 * successful save the local idea state is replaced with the server
 * response so the form reflects what's actually persisted.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  CustomFieldDefinition,
  IdeaStatus,
  IdeaUrgency,
  Project,
  ProjectIdea,
  TaskTemplate,
} from "@/lib/db";
import type { EnumOption } from "@/lib/projects/enum-options";
import { IdeaConversionForm } from "./conversion-form";

const STATUS_BADGE: Record<IdeaStatus, string> = {
  New: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200",
  "Under Review": "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  Approved: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  Rejected: "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200",
  Converted: "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-300",
};

const URGENCY_BADGE: Record<IdeaUrgency, string> = {
  Critical: "bg-red-100 text-red-900 ring-1 ring-inset ring-red-200",
  High: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200",
  Medium: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  Low: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
};

interface IdeaReviewPanelProps {
  initialIdea: ProjectIdea;
  customFields: CustomFieldDefinition[];
  templates: TaskTemplate[];
  leadOptions: string[];
  applicationOptions: string[];
  /**
   * Merged option lists for the four extensible enums. Optional;
   * passed through to `IdeaConversionForm` so admin-added values
   * appear when an idea is converted into a project.
   */
  statusOptions?: EnumOption[];
  phaseOptions?: EnumOption[];
  priorityOptions?: EnumOption[];
  /**
   * Whether the current user holds `ideas.convert`. The Convert
   * button (and the conversion form it opens) are hidden when false
   * (IDEA-09). Without this gate, a user with `ideas.review` but
   * not `ideas.convert` could click Convert, fill out the form,
   * and only learn the action was forbidden after the server
   * rejected it.
   */
  canConvert: boolean;
}

export function IdeaReviewPanel({
  initialIdea,
  customFields,
  templates,
  leadOptions,
  applicationOptions,
  statusOptions,
  phaseOptions,
  priorityOptions,
  canConvert,
}: IdeaReviewPanelProps) {
  const router = useRouter();
  const [idea, setIdea] = useState(initialIdea);
  const [comments, setComments] = useState(initialIdea.admin_comments);
  const [savingComments, setSavingComments] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);

  const isFinal = idea.status === "Converted";

  async function patchIdea(patch: {
    status?: IdeaStatus;
    admin_comments?: string;
  }): Promise<boolean> {
    setError(null);
    const res = await fetch(`/api/ideas/${idea.idea_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as {
      idea?: ProjectIdea;
      error?: string;
    };
    if (!res.ok || !data.idea) {
      setError(data.error ?? "Could not update the idea.");
      return false;
    }
    setIdea(data.idea);
    setComments(data.idea.admin_comments);
    return true;
  }

  async function handleStatus(next: IdeaStatus) {
    if (statusBusy || isFinal) return;
    setStatusBusy(true);
    await patchIdea({ status: next });
    setStatusBusy(false);
  }

  async function handleSaveComments() {
    if (savingComments || isFinal) return;
    setSavingComments(true);
    await patchIdea({ admin_comments: comments });
    setSavingComments(false);
  }

  async function handleOverlapCheck() {
    if (overlapBusy) return;
    setError(null);
    setOverlapBusy(true);
    const res = await fetch(`/api/ideas/${idea.idea_id}/overlap`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as {
      analysis?: string;
      source?: "ai" | "heuristic";
      error?: string;
    };
    setOverlapBusy(false);
    if (!res.ok || !data.analysis) {
      setError(data.error ?? "Could not run overlap analysis.");
      return;
    }
    setIdea((prev) => ({ ...prev, ai_overlap_analysis: data.analysis ?? null }));
  }

  function onConverted(result: { project: Project; idea: ProjectIdea }) {
    setIdea(result.idea);
    setShowConvert(false);
    // Refresh the list page in the background so the queue reflects the
    // new status when the user navigates back.
    router.refresh();
    // Land the user on the brand-new project.
    router.push(`/projects?focus=${result.project.project_id}`);
  }

  return (
    <div className="space-y-6">
      {/* ---- Submission summary ---- */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {idea.idea_name}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Submitted {formatTimestamp(idea.submitted_at)} by{" "}
              <span className="font-medium text-gray-700">
                {idea.submitter_name}
              </span>
              {idea.submitter_email ? (
                <>
                  {" "}
                  · <span>{idea.submitter_email}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${URGENCY_BADGE[idea.urgency]}`}
            >
              Urgency: {idea.urgency}
            </span>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[idea.status]}`}
            >
              {idea.status}
            </span>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Requested target date
            </dt>
            <dd className="mt-1 text-gray-900">
              {idea.requested_target_date ?? (
                <span className="text-gray-400">Not specified</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Key stakeholders
            </dt>
            <dd className="mt-1 text-gray-900">
              {idea.key_stakeholders || (
                <span className="text-gray-400">Not specified</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Description
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
            {idea.description}
          </dd>
        </div>

        {idea.converted_to_project_id ? (
          <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            This idea was converted to project{" "}
            <Link
              href={`/projects?focus=${idea.converted_to_project_id}`}
              className="font-mono font-medium underline-offset-2 hover:underline"
            >
              {idea.converted_to_project_id}
            </Link>
            .
          </div>
        ) : null}
      </section>

      {/* ---- Reviewer controls ---- */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900">
          Reviewer actions
        </h3>
        {isFinal ? (
          <p className="mt-2 text-sm text-gray-600">
            This idea has been converted and is now read-only. View the
            resulting project to make further changes.
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-600">
            Move the idea through review, capture internal notes, or convert
            to a project.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            disabled={isFinal || statusBusy || idea.status === "Under Review"}
            onClick={() => handleStatus("Under Review")}
            tone="neutral"
          >
            Mark under review
          </ActionButton>
          <ActionButton
            disabled={isFinal || statusBusy || idea.status === "Approved"}
            onClick={() => handleStatus("Approved")}
            tone="positive"
          >
            Approve
          </ActionButton>
          <ActionButton
            disabled={isFinal || statusBusy || idea.status === "Rejected"}
            onClick={() => handleStatus("Rejected")}
            tone="negative"
          >
            Reject
          </ActionButton>
          <div className="ml-auto">
            {canConvert ? (
              <ActionButton
                disabled={isFinal || showConvert}
                onClick={() => setShowConvert(true)}
                tone="primary"
              >
                Convert to project →
              </ActionButton>
            ) : null}
          </div>
        </div>

        {/* Admin comments */}
        <div className="mt-6">
          <label
            htmlFor="admin_comments"
            className="block text-sm font-medium text-gray-900"
          >
            Reviewer notes
          </label>
          <textarea
            id="admin_comments"
            rows={4}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            disabled={isFinal || savingComments}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
            placeholder="Internal notes about this idea — visible only to reviewers."
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={handleSaveComments}
              disabled={
                isFinal || savingComments || comments === idea.admin_comments
              }
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingComments ? "Saving…" : "Save notes"}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}
      </section>

      {/* ---- AI overlap check ---- */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Overlap check
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Compares the idea against existing projects to flag potential
              duplicates or related work.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOverlapCheck}
            disabled={overlapBusy}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {overlapBusy ? "Checking…" : idea.ai_overlap_analysis ? "Re-run check" : "Run overlap check"}
          </button>
        </div>

        {idea.ai_overlap_analysis ? (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">
              {idea.ai_overlap_analysis}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-xs text-gray-500">
            No analysis run yet. When AI is enabled, this calls Bedrock and
            looks for semantic overlap; otherwise it falls back to a
            keyword-overlap heuristic so reviewers still get a signal.
          </p>
        )}
      </section>

      {/* ---- Convert form ---- */}
      {showConvert && canConvert ? (
        <IdeaConversionForm
          idea={idea}
          customFields={customFields}
          templates={templates}
          leadOptions={leadOptions}
          applicationOptions={applicationOptions}
          statusOptions={statusOptions}
          phaseOptions={phaseOptions}
          priorityOptions={priorityOptions}
          onCancel={() => setShowConvert(false)}
          onConverted={onConverted}
        />
      ) : null}
    </div>
  );
}

interface ActionButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "primary" | "positive" | "negative" | "neutral";
}

function ActionButton({ children, onClick, disabled, tone }: ActionButtonProps) {
  const base =
    "rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50";
  // Tailwind is happy with these strings; they're literal so JIT compiles
  // them. Don't switch to template-string interpolation here.
  const palette: Record<ActionButtonProps["tone"], string> = {
    primary: "bg-gray-900 text-white hover:bg-gray-800",
    positive:
      "border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    negative:
      "border border-red-300 bg-red-50 text-red-900 hover:bg-red-100",
    neutral:
      "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${palette[tone]}`}
    >
      {children}
    </button>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
