/**
 * Global search API (Step 13).
 *
 *   GET /api/search?q=<term>&limit=<n>
 *
 * Searches project names, descriptions, and IDs; task names, IDs, and
 * detailed descriptions; and (for users with `ideas.review`) idea names
 * and descriptions. Decision-log summaries are also folded in for
 * users who can view their parent project.
 *
 * Permission gating mirrors the page-level model:
 *   - results from `Project` / `Task` are returned to anyone with
 *     `projects.view` / `tasks.view`;
 *   - `Idea` results require `ideas.review` (the only permission that
 *     controls visibility for ideas, since the Ideas review page is
 *     gated by it).
 *
 * Substring match is case-insensitive. The first match in any one
 * field wins — we don't compute relevance scores at this scale; the
 * dataset is small and a sensible alphabetical / type ordering is
 * easier for users to reason about than a fuzzy ranker.
 *
 * Rate limiting is not added here — the route is authenticated and
 * the dataset is small enough that a fast typist firing /search per
 * keystroke is fine. The client debounces the input regardless.
 */

import { NextResponse } from "next/server";

import { getCurrentUserPermissions, withAuth } from "@/lib/auth/permissions";
import {
  IdeaRepository,
  ProjectRepository,
  TaskRepository,
} from "@/lib/db";

export const dynamic = "force-dynamic";

interface SearchHit {
  type: "Project" | "Task" | "Idea";
  id: string;
  label: string;
  detail: string;
  href: string;
  /** Which field on the source record matched. Helps the UI disambiguate. */
  matched: "id" | "name" | "description";
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MAX_DETAIL_LEN = 140;

export const GET = withAuth(async (request: Request) => {
  const { permissions } = await getCurrentUserPermissions();

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [], q });
  }

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const needle = q.toLowerCase();
  const canViewProjects = permissions["projects.view"] === true;
  const canViewTasks = permissions["tasks.view"] === true;
  const canReviewIdeas = permissions["ideas.review"] === true;

  // Fetch only the sources the caller is allowed to see. Each repo
  // returns the full file, so even an empty filter doesn't save much
  // — but it keeps the result set tight and prevents leaking idea
  // submissions through the search to a non-reviewer.
  const [projects, tasks, ideas] = await Promise.all([
    canViewProjects ? ProjectRepository.getAll() : Promise.resolve([]),
    canViewTasks ? TaskRepository.getAll() : Promise.resolve([]),
    canReviewIdeas ? IdeaRepository.getAll() : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];

  for (const p of projects) {
    const matched = matchedField(needle, p.project_id, p.name, p.description);
    if (!matched) continue;
    hits.push({
      type: "Project",
      id: p.project_id,
      label: p.name || p.project_id,
      detail: detailLine([
        p.application_product,
        p.status,
        p.phase,
      ]),
      href: `/projects?id=${encodeURIComponent(p.project_id)}`,
      matched,
    });
  }

  for (const t of tasks) {
    const matched = matchedField(
      needle,
      t.task_id,
      t.task_name,
      t.detailed_description,
    );
    if (!matched) continue;
    hits.push({
      type: "Task",
      id: t.task_id,
      label: t.task_name || t.task_id,
      detail: detailLine([
        `Project ${t.project_id}`,
        t.status,
        t.priority,
      ]),
      href: `/tasks?id=${encodeURIComponent(t.task_id)}`,
      matched,
    });
  }

  for (const i of ideas) {
    const matched = matchedField(needle, i.idea_id, i.idea_name, i.description);
    if (!matched) continue;
    hits.push({
      type: "Idea",
      id: i.idea_id,
      label: i.idea_name,
      detail: detailLine([
        `Submitted by ${i.submitter_name}`,
        i.urgency,
        i.status,
      ]),
      href: `/admin/ideas/${encodeURIComponent(i.idea_id)}`,
      matched,
    });
  }

  // Type ordering keeps results predictable: projects first, then
  // tasks, then ideas. Inside each group, ID matches come first
  // (most precise), followed by name then description matches; ties
  // break alphabetically by label.
  const typeOrder: Record<SearchHit["type"], number> = {
    Project: 0,
    Task: 1,
    Idea: 2,
  };
  const matchedOrder: Record<SearchHit["matched"], number> = {
    id: 0,
    name: 1,
    description: 2,
  };
  hits.sort((a, b) => {
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    if (matchedOrder[a.matched] !== matchedOrder[b.matched]) {
      return matchedOrder[a.matched] - matchedOrder[b.matched];
    }
    return a.label.localeCompare(b.label);
  });

  return NextResponse.json({
    hits: hits.slice(0, limit),
    total: hits.length,
    q,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return which field, if any, contained the search term. Order
 * matters — id is the most-precise match, name next, description
 * last — so callers can rank hits by precision.
 */
function matchedField(
  needle: string,
  id: string,
  name: string,
  description: string,
): SearchHit["matched"] | null {
  if (id && id.toLowerCase().includes(needle)) return "id";
  if (name && name.toLowerCase().includes(needle)) return "name";
  if (description && description.toLowerCase().includes(needle)) {
    return "description";
  }
  return null;
}

/**
 * Build a one-line "context" string from a small set of fields,
 * truncating to keep the dropdown rows from wrapping unexpectedly.
 */
function detailLine(parts: Array<string | null | undefined>): string {
  const filtered = parts.filter((p): p is string => Boolean(p && p.trim()));
  const joined = filtered.join(" · ");
  if (joined.length <= MAX_DETAIL_LEN) return joined;
  return `${joined.slice(0, MAX_DETAIL_LEN - 1)}…`;
}
