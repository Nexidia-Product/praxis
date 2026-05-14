/**
 * Catalog of roadmap views (Sections 5.4–5.7).
 *
 * Centralized so the tab strip, the page-level tab switcher, and the
 * PPTX export menu (Section 5.9) all use the same names and ordering.
 * Adding a fifth view later is a one-place change.
 *
 * The Capacity / Resources view that originally lived here (Section 5.8)
 * has moved to `/insights/resources` — it combines the swim-lane Gantt
 * with task load, performance metrics, and per-resource detail, and
 * doesn't share filter state with the portfolio views the way Timeline
 * / Kanban / Bubble / Now-Next-Later do.
 */

export type RoadmapView =
  | "timeline"
  | "kanban"
  | "bubble"
  | "now-next-later";

export const ROADMAP_VIEWS: { key: RoadmapView; label: string }[] = [
  { key: "timeline", label: "Timeline" },
  { key: "kanban", label: "Kanban" },
  { key: "bubble", label: "Portfolio" },
  { key: "now-next-later", label: "Now / Next / Later" },
];

export function isRoadmapView(value: string): value is RoadmapView {
  return ROADMAP_VIEWS.some((v) => v.key === value);
}
