"use client";

/**
 * Admin Portfolio Quadrants editor.
 *
 * Four text fields rename the strategic-position bucket labels shown
 * in the Projects table, Kanban cards, and bubble chart. The bucket
 * each project lands in is determined by priority × complexity and
 * doesn't change when labels are renamed — admins can swap "Quick Win"
 * for "Easy Wins" or domain-specific phrasing without re-bucketing
 * any project.
 *
 * Validation matches the API: each label trims to a non-empty string
 * of at most 60 characters. Empty input on save shows the field's
 * default placeholder, but the form blocks submission until the user
 * either provides a value or clicks "Reset to defaults" to repopulate.
 *
 * The "Reset to defaults" button repopulates the form with the
 * canonical defaults (Quick Win / Major Bet / Fill-In / Deprioritize)
 * but doesn't save until the user clicks Save — so it's a non-
 * destructive convenience.
 */

import { useState } from "react";

import type { PortfolioQuadrantLabels } from "@/lib/db";

interface PortfolioQuadrantsAdminProps {
  initialLabels: PortfolioQuadrantLabels;
  defaults: PortfolioQuadrantLabels;
}

interface Draft {
  quick_win: string;
  major_bet: string;
  fill_in: string;
  deprioritize: string;
}

const MAX_LABEL_LENGTH = 60;

const FIELD_DEFINITIONS: Array<{
  key: keyof PortfolioQuadrantLabels;
  label: string;
  description: string;
}> = [
  {
    key: "quick_win",
    label: "Quick Win",
    description:
      "High priority + low/medium complexity. High-impact, low-effort work that should usually go to the front of the queue.",
  },
  {
    key: "major_bet",
    label: "Major Bet",
    description:
      "High priority + high/very high complexity. Strategic, expensive, multi-quarter investments — the big-rocks tier.",
  },
  {
    key: "fill_in",
    label: "Fill-In",
    description:
      "Low/medium priority + low/medium complexity. Worth doing when capacity opens up; no urgency.",
  },
  {
    key: "deprioritize",
    label: "Deprioritize",
    description:
      "Low/medium priority + high/very high complexity. Expensive and not strategic — strong candidates for cutting or deferring.",
  },
];

export function PortfolioQuadrantsAdmin({
  initialLabels,
  defaults,
}: PortfolioQuadrantsAdminProps) {
  const [draft, setDraft] = useState<Draft>(() => ({
    quick_win: initialLabels.quick_win,
    major_bet: initialLabels.major_bet,
    fill_in: initialLabels.fill_in,
    deprioritize: initialLabels.deprioritize,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function update(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    // Clear the "Saved" toast as soon as the user makes another edit
    // — leaving it up while they're typing reads as misleading.
    setSavedAt(null);
    setError(null);
  }

  function resetToDefaults() {
    setDraft({
      quick_win: defaults.quick_win,
      major_bet: defaults.major_bet,
      fill_in: defaults.fill_in,
      deprioritize: defaults.deprioritize,
    });
    setError(null);
    setSavedAt(null);
  }

  // Local validation. Keeps Save disabled while the form is invalid
  // so the user gets a clear "this isn't ready" signal — server still
  // re-validates regardless.
  const trimmedDraft: Draft = {
    quick_win: draft.quick_win.trim(),
    major_bet: draft.major_bet.trim(),
    fill_in: draft.fill_in.trim(),
    deprioritize: draft.deprioritize.trim(),
  };
  const allFilled =
    trimmedDraft.quick_win !== "" &&
    trimmedDraft.major_bet !== "" &&
    trimmedDraft.fill_in !== "" &&
    trimmedDraft.deprioritize !== "";
  const anyTooLong =
    trimmedDraft.quick_win.length > MAX_LABEL_LENGTH ||
    trimmedDraft.major_bet.length > MAX_LABEL_LENGTH ||
    trimmedDraft.fill_in.length > MAX_LABEL_LENGTH ||
    trimmedDraft.deprioritize.length > MAX_LABEL_LENGTH;
  const dirty =
    trimmedDraft.quick_win !== initialLabels.quick_win.trim() ||
    trimmedDraft.major_bet !== initialLabels.major_bet.trim() ||
    trimmedDraft.fill_in !== initialLabels.fill_in.trim() ||
    trimmedDraft.deprioritize !== initialLabels.deprioritize.trim();
  const canSave = allFilled && !anyTooLong && dirty && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/portfolio-quadrants", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_quadrants: trimmedDraft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      const data = (await res.json()) as {
        portfolio_quadrants: PortfolioQuadrantLabels;
      };
      // Rebase the draft on whatever the server actually persisted —
      // covers cases where it normalized whitespace or otherwise
      // adjusted input.
      setDraft({
        quick_win: data.portfolio_quadrants.quick_win,
        major_bet: data.portfolio_quadrants.major_bet,
        fill_in: data.portfolio_quadrants.fill_in,
        deprioritize: data.portfolio_quadrants.deprioritize,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pol-card">
      <div className="pol-card-pad space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Strategic-position labels
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Rename the four buckets that classify projects by priority
            and complexity. Renaming changes the labels everywhere the
            buckets appear — the Projects table&apos;s Position column,
            Kanban card badges, and the bubble chart&apos;s default
            quadrants. Which bucket each project falls into is
            determined by priority × complexity and is not affected by
            the label text.
          </p>
        </div>

        {error ? (
          <div role="alert" className="pol-notice pol-notice-err">
            <span aria-hidden="true">!</span>
            <span>{error}</span>
          </div>
        ) : null}

        {savedAt && !dirty ? (
          <div className="pol-notice pol-notice-ok">
            <span aria-hidden="true">✓</span>
            <span>
              Labels saved. The new wording will appear on the Projects
              and Roadmap pages immediately.
            </span>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {FIELD_DEFINITIONS.map((def) => {
            const value = draft[def.key];
            const trimmed = value.trim();
            const tooLong = trimmed.length > MAX_LABEL_LENGTH;
            const empty = trimmed === "";
            return (
              <div key={def.key} className="space-y-1">
                <label
                  htmlFor={`pq-${def.key}`}
                  className="block text-xs font-semibold uppercase tracking-wider text-gray-700"
                >
                  {def.label}
                </label>
                <input
                  id={`pq-${def.key}`}
                  type="text"
                  className={`pol-input w-full ${tooLong || empty ? "ring-1 ring-red-300" : ""}`}
                  value={value}
                  maxLength={MAX_LABEL_LENGTH + 10 /* hard cap; soft-limit in UI */}
                  placeholder={defaults[def.key]}
                  onChange={(e) =>
                    update({ [def.key]: e.target.value } as Partial<Draft>)
                  }
                  disabled={saving}
                />
                <p className="text-xs text-gray-500">{def.description}</p>
                {empty ? (
                  <p className="text-xs text-red-600">
                    Required. Use &quot;Reset to defaults&quot; to
                    restore the standard wording.
                  </p>
                ) : tooLong ? (
                  <p className="text-xs text-red-600">
                    {trimmed.length}/{MAX_LABEL_LENGTH} characters — too
                    long.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            className="pol-btn pol-btn-primary"
            disabled={!canSave}
            onClick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="pol-btn pol-btn-secondary"
            disabled={saving}
            onClick={resetToDefaults}
          >
            Reset to defaults
          </button>
          {dirty ? (
            <span className="text-xs text-gray-500">Unsaved changes.</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
