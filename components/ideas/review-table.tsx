"use client";

/**
 * Ideas review table (Section 5.18).
 *
 * Lists submitted ideas with a status filter. Clicking a row opens the
 * detail page for the idea. Inline status chips are colored to match the
 * project status badge palette in `lib/projects/display.ts` so the visual
 * language is consistent across pages.
 *
 * State here is purely presentational — filter selection and the list
 * itself. Status changes happen on the detail page; the list refreshes
 * via `router.refresh()` when the user navigates back.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { IdeaStatus, IdeaUrgency, ProjectIdea } from "@/lib/db";

const STATUS_FILTERS: { label: string; value: IdeaStatus | "All" | "Open" }[] = [
  { label: "Open (New + Under Review)", value: "Open" },
  { label: "All", value: "All" },
  { label: "New", value: "New" },
  { label: "Under Review", value: "Under Review" },
  { label: "Approved", value: "Approved" },
  { label: "Rejected", value: "Rejected" },
  { label: "Converted", value: "Converted" },
];

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

interface IdeasReviewTableProps {
  initialIdeas: ProjectIdea[];
}

export function IdeasReviewTable({ initialIdeas }: IdeasReviewTableProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<IdeaStatus | "All" | "Open">("Open");

  const visible = useMemo(() => {
    if (filter === "All") return initialIdeas;
    if (filter === "Open") {
      return initialIdeas.filter(
        (i) => i.status === "New" || i.status === "Under Review",
      );
    }
    return initialIdeas.filter((i) => i.status === filter);
  }, [initialIdeas, filter]);

  const counts = useMemo(() => {
    const c: Record<IdeaStatus, number> = {
      New: 0,
      "Under Review": 0,
      Approved: 0,
      Rejected: 0,
      Converted: 0,
    };
    for (const i of initialIdeas) c[i.status] += 1;
    return c;
  }, [initialIdeas]);

  return (
    <div className="space-y-3">
      <div
        className="toolbar"
        style={{ flexWrap: "wrap", gap: 8 }}
      >
        <span className="section-label">Filter</span>
        {STATUS_FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              style={{
                padding: "3px 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--pol-radius)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                background: active ? "var(--brand)" : "var(--card)",
                color: active ? "#fff" : "var(--t2)",
                borderColor: active ? "var(--brand)" : "var(--border)",
                transition: "background 0.1s, color 0.1s, border-color 0.1s",
              }}
            >
              {f.label}
            </button>
          );
        })}
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--tm)" }}>
          {counts.New} new · {counts["Under Review"]} under review ·{" "}
          {counts.Approved} approved · {counts.Converted} converted
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border)",
            background: "var(--card)",
            borderRadius: "var(--pol-radius)",
            padding: "32px 20px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>
            No ideas match this filter.
          </p>
          <p style={{ marginTop: 4, fontSize: 12, color: "var(--t2)" }}>
            {initialIdeas.length === 0
              ? "Nothing submitted yet — share the /submit link with stakeholders."
              : "Try a different filter, or pick All to see everything."}
          </p>
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
          <table className="min-w-full text-sm">
            <thead style={{ background: "var(--bg)", borderBottom: "2px solid var(--border)" }}>
              <tr style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--tm)", textAlign: "left" }}>
                <th className="px-4 py-2">Idea</th>
                <th className="px-4 py-2">Submitter</th>
                <th className="px-4 py-2">Urgency</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody style={{ background: "var(--card)" }}>
              {visible.map((idea) => (
                <tr
                  key={idea.idea_id}
                  className="hoverable-row"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                  onClick={() => router.push(`/admin/ideas/${idea.idea_id}`)}
                  onKeyDown={(e) => {
                    // Make the row keyboard-navigable: Enter or Space opens
                    // the detail page. Without this, the row is mouse-only.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/admin/ideas/${idea.idea_id}`);
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open idea ${idea.idea_name}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/ideas/${idea.idea_id}`}
                      className="font-medium text-gray-900 underline-offset-2 hover:underline"
                    >
                      {idea.idea_name}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 max-w-xl text-xs text-gray-600">
                      {idea.description}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{idea.submitter_name}</div>
                    {idea.submitter_email ? (
                      <div className="text-xs text-gray-500">
                        {idea.submitter_email}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${URGENCY_BADGE[idea.urgency]}`}
                    >
                      {idea.urgency}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[idea.status]}`}
                    >
                      {idea.status}
                    </span>
                    {idea.converted_to_project_id ? (
                      <Link
                        href={`/projects?focus=${idea.converted_to_project_id}`}
                        className="ml-2 text-xs text-gray-600 underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        → {idea.converted_to_project_id}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {formatDate(idea.submitted_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/ideas/${idea.idea_id}`}
                      className="pol-btn pol-btn-sm pol-btn-secondary"
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
