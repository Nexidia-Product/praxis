"use client";

/**
 * Admin Health Thresholds editor (Section 5.13, Section 5.19).
 *
 * Five numeric fields control the Red / Yellow / Green scoring rules.
 * Defaults match the design doc (20% Yellow, 40% Red, 14-day inactivity,
 * etc.) and are surfaced inline so an Admin can revert a field with one
 * click.
 *
 * After save, an optional one-click "Recalculate now" button hits the
 * `/recalculate` endpoint to apply the new thresholds across every
 * project's persisted score immediately. Without this, the new
 * thresholds would only take effect on the next individual project edit
 * or the daily 07:00 UTC sweep.
 *
 * Validation runs client-side as a courtesy; the server re-validates
 * regardless. The Red-must-exceed-Yellow invariant is enforced both
 * places.
 */

import { useState } from "react";

import type { HealthScoreThresholds } from "@/lib/db";

interface HealthThresholdsAdminProps {
  initialThresholds: HealthScoreThresholds;
  defaults: HealthScoreThresholds;
}

interface Draft {
  yellow_blocked_or_overdue_pct: string;
  red_blocked_or_overdue_pct: string;
  yellow_inactivity_days: string;
  yellow_target_date_proximity_days: string;
  yellow_open_tasks_pct: string;
  yellow_due_soon_tasks_pct: string;
}

function toDraft(t: HealthScoreThresholds): Draft {
  return {
    yellow_blocked_or_overdue_pct: String(t.yellow_blocked_or_overdue_pct),
    red_blocked_or_overdue_pct: String(t.red_blocked_or_overdue_pct),
    yellow_inactivity_days: String(t.yellow_inactivity_days),
    yellow_target_date_proximity_days: String(
      t.yellow_target_date_proximity_days,
    ),
    yellow_open_tasks_pct: String(t.yellow_open_tasks_pct),
    yellow_due_soon_tasks_pct: String(t.yellow_due_soon_tasks_pct),
  };
}

function toPayload(
  d: Draft,
):
  | { ok: true; thresholds: HealthScoreThresholds }
  | { ok: false; error: string } {
  function num(field: string, raw: string): number | null {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  const yellowPct = num("yellow_blocked_or_overdue_pct", d.yellow_blocked_or_overdue_pct);
  const redPct = num("red_blocked_or_overdue_pct", d.red_blocked_or_overdue_pct);
  const inactivity = num("yellow_inactivity_days", d.yellow_inactivity_days);
  const proximity = num(
    "yellow_target_date_proximity_days",
    d.yellow_target_date_proximity_days,
  );
  const openPct = num("yellow_open_tasks_pct", d.yellow_open_tasks_pct);
  const dueSoonPct = num(
    "yellow_due_soon_tasks_pct",
    d.yellow_due_soon_tasks_pct,
  );

  if (
    yellowPct === null ||
    redPct === null ||
    inactivity === null ||
    proximity === null ||
    openPct === null ||
    dueSoonPct === null
  ) {
    return { ok: false, error: "All fields must be numbers." };
  }
  for (const [name, val] of [
    ["Yellow blocked-or-overdue %", yellowPct],
    ["Red blocked-or-overdue %", redPct],
    ["Yellow open-task %", openPct],
    ["Yellow due-soon task %", dueSoonPct],
  ] as const) {
    if (val < 0 || val > 100) {
      return { ok: false, error: `${name} must be between 0 and 100.` };
    }
  }
  for (const [name, val] of [
    ["Inactivity days", inactivity],
    ["Target-date proximity days", proximity],
  ] as const) {
    if (val < 0 || val > 365) {
      return { ok: false, error: `${name} must be between 0 and 365.` };
    }
  }
  if (redPct <= yellowPct) {
    return {
      ok: false,
      error:
        "Red threshold must be greater than Yellow threshold for blocked-or-overdue percentage.",
    };
  }
  return {
    ok: true,
    thresholds: {
      yellow_blocked_or_overdue_pct: yellowPct,
      red_blocked_or_overdue_pct: redPct,
      yellow_inactivity_days: inactivity,
      yellow_target_date_proximity_days: proximity,
      yellow_open_tasks_pct: openPct,
      yellow_due_soon_tasks_pct: dueSoonPct,
    },
  };
}

export function HealthThresholdsAdmin({
  initialThresholds,
  defaults,
}: HealthThresholdsAdminProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialThresholds));
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [message, setMessage] = useState<
    { kind: "success" | "error" | "info"; text: string } | null
  >(null);

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function resetToDefaults() {
    setDraft(toDraft(defaults));
    setMessage({ kind: "info", text: "Reverted to defaults (not yet saved)." });
  }

  async function save() {
    const result = toPayload(draft);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/health-thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ health_score_thresholds: result.thresholds }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      health_score_thresholds?: HealthScoreThresholds;
      error?: string;
    };
    setSaving(false);
    if (!res.ok || !data.health_score_thresholds) {
      setMessage({
        kind: "error",
        text: data.error ?? "Could not save thresholds.",
      });
      return;
    }
    setDraft(toDraft(data.health_score_thresholds));
    setMessage({
      kind: "success",
      text: "Thresholds saved. Click ‘Recalculate now’ to apply them to existing projects.",
    });
  }

  async function recalculate() {
    setRecalculating(true);
    setMessage(null);
    const res = await fetch("/api/admin/health-thresholds/recalculate", {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as {
      changed?: number;
      duration_ms?: number;
      error?: string;
    };
    setRecalculating(false);
    if (!res.ok) {
      setMessage({
        kind: "error",
        text: data.error ?? "Recalculation failed.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: `Recalculation complete. ${data.changed ?? 0} project(s) changed score in ${data.duration_ms ?? 0}ms.`,
    });
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div
          role="alert"
          className={
            message.kind === "success"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              : message.kind === "info"
                ? "rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
                : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          }
        >
          {message.text}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">
          Red &amp; Yellow tier thresholds
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          Percent of a project&rsquo;s tasks that are blocked or overdue. Red
          must be strictly greater than Yellow.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            id="yellow_blocked_or_overdue_pct"
            label="Yellow blocked-or-overdue %"
            value={draft.yellow_blocked_or_overdue_pct}
            defaultValue={defaults.yellow_blocked_or_overdue_pct}
            min={0}
            max={100}
            suffix="%"
            disabled={saving || recalculating}
            onChange={(v) => update({ yellow_blocked_or_overdue_pct: v })}
          />
          <NumberField
            id="red_blocked_or_overdue_pct"
            label="Red blocked-or-overdue %"
            value={draft.red_blocked_or_overdue_pct}
            defaultValue={defaults.red_blocked_or_overdue_pct}
            min={0}
            max={100}
            suffix="%"
            disabled={saving || recalculating}
            onChange={(v) => update({ red_blocked_or_overdue_pct: v })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Yellow-only triggers</h2>
        <p className="mt-1 text-xs text-gray-600">
          Conditions that flip a project to Yellow even when the
          blocked-or-overdue percentage is below the Yellow tier threshold.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            id="yellow_inactivity_days"
            label="Inactivity days"
            value={draft.yellow_inactivity_days}
            defaultValue={defaults.yellow_inactivity_days}
            min={0}
            max={365}
            suffix="days"
            help="Days since last task update before flagging as Yellow."
            disabled={saving || recalculating}
            onChange={(v) => update({ yellow_inactivity_days: v })}
          />
          <NumberField
            id="yellow_target_date_proximity_days"
            label="Target-date proximity"
            value={draft.yellow_target_date_proximity_days}
            defaultValue={defaults.yellow_target_date_proximity_days}
            min={0}
            max={365}
            suffix="days"
            help="Days remaining to target_date below which the open-task check applies."
            disabled={saving || recalculating}
            onChange={(v) => update({ yellow_target_date_proximity_days: v })}
          />
          <NumberField
            id="yellow_open_tasks_pct"
            label="Open-task %"
            value={draft.yellow_open_tasks_pct}
            defaultValue={defaults.yellow_open_tasks_pct}
            min={0}
            max={100}
            suffix="%"
            help="Percent of open tasks that, when paired with target-date proximity, triggers Yellow."
            disabled={saving || recalculating}
            onChange={(v) => update({ yellow_open_tasks_pct: v })}
          />
          <NumberField
            id="yellow_due_soon_tasks_pct"
            label="Due-soon task %"
            value={draft.yellow_due_soon_tasks_pct}
            defaultValue={defaults.yellow_due_soon_tasks_pct}
            min={0}
            max={100}
            suffix="%"
            help="Percent of tasks whose own target_date falls within the proximity window above which Yellow triggers — independent of the project's own target date."
            disabled={saving || recalculating}
            onChange={(v) => update({ yellow_due_soon_tasks_pct: v })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={resetToDefaults}
          disabled={saving || recalculating}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Revert to defaults
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={recalculate}
            disabled={saving || recalculating}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {recalculating ? "Recalculating…" : "Recalculate now"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || recalculating}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save thresholds"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  defaultValue: number;
  min: number;
  max: number;
  suffix?: string;
  help?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function NumberField({
  id,
  label,
  value,
  defaultValue,
  min,
  max,
  suffix,
  help,
  disabled,
  onChange,
}: NumberFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}
        <span className="ml-1.5 font-normal text-gray-400">
          (default {defaultValue}
          {suffix ? suffix : ""})
        </span>
      </label>
      <div className="mt-1 flex items-center gap-1">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step="1"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:bg-gray-50"
        />
        {suffix ? (
          <span className="text-sm text-gray-500">{suffix}</span>
        ) : null}
      </div>
      {help ? (
        <p className="mt-1 text-[11px] text-gray-500">{help}</p>
      ) : null}
    </div>
  );
}
