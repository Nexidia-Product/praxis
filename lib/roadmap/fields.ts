/**
 * Project field metadata for the roadmap views.
 *
 * Section 5.5 says any field can define Kanban columns; Section 5.6 says
 * any numeric or enum field can serve as a bubble chart axis. Rather than
 * spread "which fields show up where" across each component, we centralize
 * the catalog here. Each entry knows:
 *
 *   - the user-facing label
 *   - how to read the value off a Project
 *   - whether the field has a fixed enum order (used for natural axis /
 *     column ordering)
 *   - a numeric mapping (only for fields usable as chart axes)
 *
 * Adding a new field to a roadmap view is a one-place change: add an entry
 * here and pick it up by name in the consumer.
 */

import {
  PORTFOLIO_PROJECT_TYPES,
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
} from "@/lib/projects/display";
import type { Project } from "@/lib/db";

// ---------------------------------------------------------------------------
// Kanban column / swimlane fields
// ---------------------------------------------------------------------------

/**
 * One field that can be used to define Kanban columns or swimlanes
 * (Section 5.5). `values` is the natural left-to-right order — for
 * fixed-enum fields this is the enum order; for `roadmap_bucket` it is
 * the order in which the values were first encountered (overridden by
 * a SavedKanbanConfig.column_order when one exists).
 *
 * `getValue(project)` returns the bucket the project belongs to. Empty
 * string means "unassigned" — those projects flow into the Unbucketed
 * column.
 */
export interface KanbanField {
  key: string;
  label: string;
  /** Fixed enum values; `null` means values are derived from the data. */
  values: readonly string[] | null;
  getValue(project: Project): string;
  /** Whether to use the value verbatim as the column label (vs prettifying). */
  formatLabel?(value: string): string;
}

export const KANBAN_FIELDS: KanbanField[] = [
  {
    key: "status",
    label: "Status",
    values: PROJECT_STATUSES,
    getValue: (p) => p.status,
  },
  {
    key: "phase",
    label: "Phase",
    values: PROJECT_PHASES,
    getValue: (p) => p.phase,
  },
  {
    key: "priority",
    label: "Priority",
    values: PRIORITIES,
    getValue: (p) => p.priority,
  },
  {
    key: "project_type",
    label: "Project Type",
    // Roadmap-scoped: Admin work is filtered out at the page level, so
    // emitting an Admin column would always be empty. Use the portfolio
    // list so the column set matches what the page can actually show.
    values: PORTFOLIO_PROJECT_TYPES,
    getValue: (p) => p.project_type,
  },
  {
    key: "roadmap_bucket",
    label: "Roadmap Bucket",
    values: null, // user-defined; derived from data
    getValue: (p) => p.roadmap_bucket ?? "",
  },
  {
    key: "application_product",
    label: "Application / Product",
    values: null,
    getValue: (p) => p.application_product,
  },
  {
    key: "project_lead",
    label: "Project Lead",
    values: null,
    getValue: (p) => p.project_lead,
  },
];

export function findKanbanField(key: string): KanbanField | null {
  return KANBAN_FIELDS.find((f) => f.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Bubble chart axes
// ---------------------------------------------------------------------------

/**
 * One axis for the Portfolio Bubble Chart (Section 5.6). Returns a numeric
 * coordinate so the chart can scale and position bubbles, plus a label
 * string for tick marks. Returning `null` means the project lacks the
 * field and is excluded from the chart.
 */
export interface BubbleAxis {
  key: string;
  label: string;
  /** Numeric value, or null to drop the project from the chart. */
  getValue(project: Project): number | null;
  /** The discrete tick values in display order (low to high). */
  ticks: { value: number; label: string }[];
  /** Numeric → original string for hover tooltips and write-back. */
  invert?(value: number): string;
}

const COMPLEXITY_ORDER: Record<string, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  "Very High": 4,
};

const PRIORITY_ORDER: Record<string, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

const PROJECT_TYPE_ORDER: Record<string, number> = {
  Enhancement: 1,
  "New Feature": 2,
  "New Prototype": 3,
  "New Application": 4,
};

/**
 * "Days until target date." Negative means past due, 0 means today,
 * positive means in the future. Projects without a target date plot at
 * 0 so they're still visible on the chart (ROAD-13) — they share the
 * "Today / —" tick. The leading dash makes it visually obvious those
 * bubbles aren't actually due today.
 */
function targetDateProximity(p: Project): number {
  if (!p.target_date) return 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(p.target_date + "T00:00:00Z");
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export const BUBBLE_AXES: BubbleAxis[] = [
  {
    key: "ai_complexity_score",
    label: "AI Complexity",
    // Projects without an AI complexity score plot in an "Unscored"
    // lane at 0 rather than being silently dropped (ROAD-13). Newly
    // created projects don't have a score until the AI hook runs; users
    // expect the chart to show every open project.
    getValue: (p) =>
      p.ai_complexity_score ? COMPLEXITY_ORDER[p.ai_complexity_score] : 0,
    ticks: [
      { value: 0, label: "—" },
      { value: 1, label: "Low" },
      { value: 2, label: "Medium" },
      { value: 3, label: "High" },
      { value: 4, label: "Very High" },
    ],
  },
  {
    key: "priority",
    label: "Priority",
    // Custom priorities added through enum_extensions don't appear in
    // PRIORITY_ORDER and would otherwise return null; bucket them into
    // "Other" at 0 so they still plot.
    getValue: (p) => PRIORITY_ORDER[p.priority] ?? 0,
    ticks: [
      { value: 0, label: "—" },
      { value: 1, label: "Low" },
      { value: 2, label: "Medium" },
      { value: 3, label: "High" },
      { value: 4, label: "Critical" },
    ],
  },
  {
    key: "project_type",
    label: "Project Type",
    getValue: (p) => PROJECT_TYPE_ORDER[p.project_type] ?? 0,
    ticks: [
      { value: 0, label: "—" },
      { value: 1, label: "Enhancement" },
      { value: 2, label: "New Feature" },
      { value: 3, label: "New Prototype" },
      { value: 4, label: "New Application" },
    ],
  },
  {
    key: "stakeholder_count",
    label: "Stakeholder Count",
    getValue: (p) => p.primary_stakeholders.length,
    ticks: [
      { value: 0, label: "0" },
      { value: 2, label: "2" },
      { value: 4, label: "4" },
      { value: 6, label: "6+" },
    ],
  },
  {
    key: "resource_count",
    label: "Resource Count",
    getValue: (p) =>
      (p.project_lead ? 1 : 0) + p.additional_resources.length,
    ticks: [
      { value: 0, label: "0" },
      { value: 2, label: "2" },
      { value: 4, label: "4" },
      { value: 6, label: "6+" },
    ],
  },
  {
    key: "days_to_target",
    label: "Days to Target Date",
    // Projects without a target_date plot at 0 ("Today") so they're
    // visible — same rationale as ai_complexity_score above.
    getValue: targetDateProximity,
    ticks: [
      { value: -30, label: "−30d" },
      { value: 0, label: "Today / —" },
      { value: 30, label: "+30d" },
      { value: 90, label: "+90d" },
    ],
  },
];

export function findBubbleAxis(key: string): BubbleAxis | null {
  return BUBBLE_AXES.find((a) => a.key === key) ?? null;
}
