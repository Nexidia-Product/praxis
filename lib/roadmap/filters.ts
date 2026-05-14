/**
 * Filter state shared across all five roadmap views (Sections 5.4–5.8).
 *
 * The Projects page has its own filter bar with custom-field support. The
 * roadmap views don't render custom fields on cards or bubbles, so we use
 * a slimmer filter set here. The set is intentionally identical across
 * all five views so a user toggling between Timeline / Kanban / etc.
 * keeps the same scope without re-applying.
 */

import type {
  Priority,
  Project,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
} from "@/lib/db";

export interface RoadmapFilters {
  status: ProjectStatus[];
  phase: ProjectPhase[];
  priority: Priority[];
  project_type: ProjectType[];
  project_lead: string[];
  application_product: string[];
  search: string;
}

export const EMPTY_ROADMAP_FILTERS: RoadmapFilters = {
  status: [],
  phase: [],
  priority: [],
  project_type: [],
  project_lead: [],
  application_product: [],
  search: "",
};

/**
 * The roadmap views default to hiding Completed and Canceled projects,
 * with a toggle to include them. Most views (Kanban, Now/Next/Later)
 * show in-flight work; closed projects clutter them. The Timeline and
 * Bubble Chart can usefully show closed work for review, so the user
 * has a checkbox.
 */
export function isOpenStatus(s: ProjectStatus): boolean {
  return s !== "Completed" && s !== "Canceled";
}

/**
 * Apply the filter set to a project list. Pure function — no React
 * deps — so each view can call it inside a `useMemo`.
 */
export function applyRoadmapFilters(
  projects: Project[],
  filters: RoadmapFilters,
  options: { includeClosed?: boolean } = {},
): Project[] {
  const search = filters.search.trim().toLowerCase();
  return projects.filter((p) => {
    if (!options.includeClosed && !isOpenStatus(p.status)) return false;
    if (filters.status.length && !filters.status.includes(p.status)) {
      return false;
    }
    if (filters.phase.length && !filters.phase.includes(p.phase)) {
      return false;
    }
    if (filters.priority.length && !filters.priority.includes(p.priority)) {
      return false;
    }
    if (
      filters.project_type.length &&
      !filters.project_type.includes(p.project_type)
    ) {
      return false;
    }
    if (
      filters.project_lead.length &&
      !filters.project_lead.includes(p.project_lead)
    ) {
      return false;
    }
    if (
      filters.application_product.length &&
      !filters.application_product.includes(p.application_product)
    ) {
      return false;
    }
    if (search) {
      const hay = `${p.project_id} ${p.name} ${p.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
