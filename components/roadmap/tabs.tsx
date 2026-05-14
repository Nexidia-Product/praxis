"use client";

/**
 * Sub-view tabs shared across the roadmap page (Sections 5.4–5.7).
 *
 * The four views share filter state and project data, but each renders
 * differently. Rather than separate routes per view, we use a single
 * /roadmap page with a tab switch — keeps the data load and filter
 * state consistent and lets the user A/B between views without losing
 * what they had selected.
 */

import type { RoadmapView } from "@/lib/roadmap/views";
import { ROADMAP_VIEWS } from "@/lib/roadmap/views";

interface RoadmapTabsProps {
  active: RoadmapView;
  onChange: (next: RoadmapView) => void;
}

export function RoadmapTabs({ active, onChange }: RoadmapTabsProps) {
  return (
    <nav
      role="tablist"
      aria-label="Roadmap views"
      className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
    >
      {ROADMAP_VIEWS.map((v) => {
        const isActive = v.key === active;
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(v.key)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              isActive
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                : "text-gray-600 hover:bg-white/60 hover:text-gray-900"
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </nav>
  );
}
