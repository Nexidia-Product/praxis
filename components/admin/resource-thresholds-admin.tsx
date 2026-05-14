"use client";

/**
 * Admin Resource Thresholds editor.
 *
 * Five sections of fields, mirroring the structure of
 * `ResourceSettings`:
 *
 *   1. Default allocation     — single field (percent dedicated to
 *                               projects when not set per assignment)
 *   2. Workload weights       — eleven multipliers (project, task,
 *                               complexity, priority, bottleneck)
 *   3. Workload buckets       — three threshold values that slice
 *                               the score into Light / Balanced /
 *                               Heavy / Overloaded
 *   4. Performance weights    — two-field weighted average (on-time
 *                               vs. blocked-rate)
 *   5. Performance thresholds — two values (Yellow and Green
 *                               minimum scores) plus a window in
 *                               days
 *
 * Each numeric field shows its default inline so an admin can
 * revert one field at a time without resetting the whole form.
 *
 * Validation runs client-side as a courtesy; the server re-validates
 * regardless. The bucket-ordering invariant (light < balanced <
 * heavy) and performance-threshold invariant (yellow_min <
 * green_min) are enforced both places.
 */

import { useState } from "react";

import type { ResourceSettings } from "@/lib/db";

interface ResourceThresholdsAdminProps {
  initialSettings: ResourceSettings;
  defaults: ResourceSettings;
}

// All values held as strings so unfinished input doesn't immediately
// crash the form. Coerced back to numbers on save.
interface Draft {
  default_allocation_percent: string;
  ww_project_assignment: string;
  ww_open_task: string;
  ww_past_due_task: string;
  ww_bottleneck_task: string;
  ww_complexity_low: string;
  ww_complexity_medium: string;
  ww_complexity_high: string;
  ww_complexity_very_high: string;
  ww_priority_critical: string;
  ww_priority_high: string;
  ww_priority_medium: string;
  ww_priority_low: string;
  wb_light_max: string;
  wb_balanced_max: string;
  wb_heavy_max: string;
  pw_on_time: string;
  pw_blocked_inverse: string;
  pt_green_min: string;
  pt_yellow_min: string;
  performance_window_days: string;
}

function toDraft(s: ResourceSettings): Draft {
  return {
    default_allocation_percent: String(s.default_allocation_percent),
    ww_project_assignment: String(s.workload_weights.project_assignment),
    ww_open_task: String(s.workload_weights.open_task),
    ww_past_due_task: String(s.workload_weights.past_due_task),
    ww_bottleneck_task: String(s.workload_weights.bottleneck_task),
    ww_complexity_low: String(s.workload_weights.complexity_low),
    ww_complexity_medium: String(s.workload_weights.complexity_medium),
    ww_complexity_high: String(s.workload_weights.complexity_high),
    ww_complexity_very_high: String(s.workload_weights.complexity_very_high),
    ww_priority_critical: String(s.workload_weights.priority_critical),
    ww_priority_high: String(s.workload_weights.priority_high),
    ww_priority_medium: String(s.workload_weights.priority_medium),
    ww_priority_low: String(s.workload_weights.priority_low),
    wb_light_max: String(s.workload_buckets.light_max),
    wb_balanced_max: String(s.workload_buckets.balanced_max),
    wb_heavy_max: String(s.workload_buckets.heavy_max),
    pw_on_time: String(s.performance_weights.on_time),
    pw_blocked_inverse: String(s.performance_weights.blocked_inverse),
    pt_green_min: String(s.performance_thresholds.green_min),
    pt_yellow_min: String(s.performance_thresholds.yellow_min),
    performance_window_days: String(s.performance_window_days),
  };
}

function toPayload(
  d: Draft,
):
  | { ok: true; settings: ResourceSettings }
  | { ok: false; error: string } {
  function num(raw: string): number | null {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  const fields: Record<keyof Draft, number | null> = {
    default_allocation_percent: num(d.default_allocation_percent),
    ww_project_assignment: num(d.ww_project_assignment),
    ww_open_task: num(d.ww_open_task),
    ww_past_due_task: num(d.ww_past_due_task),
    ww_bottleneck_task: num(d.ww_bottleneck_task),
    ww_complexity_low: num(d.ww_complexity_low),
    ww_complexity_medium: num(d.ww_complexity_medium),
    ww_complexity_high: num(d.ww_complexity_high),
    ww_complexity_very_high: num(d.ww_complexity_very_high),
    ww_priority_critical: num(d.ww_priority_critical),
    ww_priority_high: num(d.ww_priority_high),
    ww_priority_medium: num(d.ww_priority_medium),
    ww_priority_low: num(d.ww_priority_low),
    wb_light_max: num(d.wb_light_max),
    wb_balanced_max: num(d.wb_balanced_max),
    wb_heavy_max: num(d.wb_heavy_max),
    pw_on_time: num(d.pw_on_time),
    pw_blocked_inverse: num(d.pw_blocked_inverse),
    pt_green_min: num(d.pt_green_min),
    pt_yellow_min: num(d.pt_yellow_min),
    performance_window_days: num(d.performance_window_days),
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) {
      return { ok: false, error: `${k} must be a number.` };
    }
  }
  // After the null-check pass we know every entry is a number;
  // narrow with non-null assertions.
  const f = fields as Record<keyof Draft, number>;

  if (f.default_allocation_percent < 0 || f.default_allocation_percent > 100) {
    return {
      ok: false,
      error: "default_allocation_percent must be between 0 and 100.",
    };
  }
  if (!(f.wb_light_max < f.wb_balanced_max)) {
    return { ok: false, error: "Light max must be less than Balanced max." };
  }
  if (!(f.wb_balanced_max < f.wb_heavy_max)) {
    return { ok: false, error: "Balanced max must be less than Heavy max." };
  }
  if (!(f.pt_yellow_min < f.pt_green_min)) {
    return { ok: false, error: "Yellow min must be less than Green min." };
  }
  if (f.pt_green_min < 0 || f.pt_green_min > 1) {
    return {
      ok: false,
      error: "Green min must be between 0 and 1.",
    };
  }
  if (f.pt_yellow_min < 0 || f.pt_yellow_min > 1) {
    return {
      ok: false,
      error: "Yellow min must be between 0 and 1.",
    };
  }
  if (f.pw_on_time + f.pw_blocked_inverse === 0) {
    return {
      ok: false,
      error: "At least one performance weight must be greater than zero.",
    };
  }
  if (f.performance_window_days < 1) {
    return {
      ok: false,
      error: "Performance window must be at least 1 day.",
    };
  }

  return {
    ok: true,
    settings: {
      default_allocation_percent: f.default_allocation_percent,
      workload_weights: {
        project_assignment: f.ww_project_assignment,
        open_task: f.ww_open_task,
        past_due_task: f.ww_past_due_task,
        bottleneck_task: f.ww_bottleneck_task,
        complexity_low: f.ww_complexity_low,
        complexity_medium: f.ww_complexity_medium,
        complexity_high: f.ww_complexity_high,
        complexity_very_high: f.ww_complexity_very_high,
        priority_critical: f.ww_priority_critical,
        priority_high: f.ww_priority_high,
        priority_medium: f.ww_priority_medium,
        priority_low: f.ww_priority_low,
      },
      workload_buckets: {
        light_max: f.wb_light_max,
        balanced_max: f.wb_balanced_max,
        heavy_max: f.wb_heavy_max,
      },
      performance_weights: {
        on_time: f.pw_on_time,
        blocked_inverse: f.pw_blocked_inverse,
      },
      performance_thresholds: {
        green_min: f.pt_green_min,
        yellow_min: f.pt_yellow_min,
      },
      performance_window_days: f.performance_window_days,
    },
  };
}

export function ResourceThresholdsAdmin({
  initialSettings,
  defaults,
}: ResourceThresholdsAdminProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialSettings));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    { kind: "success" | "error" | "info"; text: string } | null
  >(null);

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  function resetToDefaults() {
    setDraft(toDraft(defaults));
    setMessage({
      kind: "info",
      text: "Reverted to defaults (not yet saved).",
    });
  }

  async function save() {
    const result = toPayload(draft);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/resource-thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource_settings: result.settings }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      resource_settings?: ResourceSettings;
      error?: string;
    };
    setSaving(false);
    if (!res.ok || !data.resource_settings) {
      setMessage({
        kind: "error",
        text: data.error ?? "Could not save thresholds.",
      });
      return;
    }
    setDraft(toDraft(data.resource_settings));
    setMessage({
      kind: "success",
      text: "Thresholds saved. The Resources page will reflect the new values on next render.",
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

      <Section
        title="Default allocation"
        description="The fraction of a resource's time a project assignment represents when no per-assignment value is set. Use lower values when nobody is dedicated 100% to projects."
      >
        <NumberField
          id="default_allocation_percent"
          label="Default allocation"
          value={draft.default_allocation_percent}
          defaultValue={defaults.default_allocation_percent}
          suffix="%"
          help="0 means project assignments contribute nothing to workload; 100 means each assignment counts as a full-time commitment."
          disabled={saving}
          onChange={(v) => update({ default_allocation_percent: v })}
        />
      </Section>

      <Section
        title="Workload weights"
        description="Multipliers applied per active project, per open task, and per priority / complexity tier. Higher numbers make that factor weigh more in the workload score."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            id="ww_project_assignment"
            label="Per project assignment"
            value={draft.ww_project_assignment}
            defaultValue={defaults.workload_weights.project_assignment}
            disabled={saving}
            onChange={(v) => update({ ww_project_assignment: v })}
          />
          <NumberField
            id="ww_open_task"
            label="Per open task"
            value={draft.ww_open_task}
            defaultValue={defaults.workload_weights.open_task}
            disabled={saving}
            onChange={(v) => update({ ww_open_task: v })}
          />
          <NumberField
            id="ww_past_due_task"
            label="Per past-due task"
            value={draft.ww_past_due_task}
            defaultValue={defaults.workload_weights.past_due_task}
            disabled={saving}
            onChange={(v) => update({ ww_past_due_task: v })}
          />
          <NumberField
            id="ww_bottleneck_task"
            label="Per bottleneck task"
            value={draft.ww_bottleneck_task}
            defaultValue={defaults.workload_weights.bottleneck_task}
            help="Tasks where this resource is blocking someone else's work."
            disabled={saving}
            onChange={(v) => update({ ww_bottleneck_task: v })}
          />
        </div>
        <SubHeading>Project complexity multipliers</SubHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField
            id="ww_complexity_low"
            label="Low"
            value={draft.ww_complexity_low}
            defaultValue={defaults.workload_weights.complexity_low}
            disabled={saving}
            onChange={(v) => update({ ww_complexity_low: v })}
          />
          <NumberField
            id="ww_complexity_medium"
            label="Medium"
            value={draft.ww_complexity_medium}
            defaultValue={defaults.workload_weights.complexity_medium}
            disabled={saving}
            onChange={(v) => update({ ww_complexity_medium: v })}
          />
          <NumberField
            id="ww_complexity_high"
            label="High"
            value={draft.ww_complexity_high}
            defaultValue={defaults.workload_weights.complexity_high}
            disabled={saving}
            onChange={(v) => update({ ww_complexity_high: v })}
          />
          <NumberField
            id="ww_complexity_very_high"
            label="Very High"
            value={draft.ww_complexity_very_high}
            defaultValue={defaults.workload_weights.complexity_very_high}
            disabled={saving}
            onChange={(v) => update({ ww_complexity_very_high: v })}
          />
        </div>
        <SubHeading>Task priority multipliers</SubHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField
            id="ww_priority_critical"
            label="Critical"
            value={draft.ww_priority_critical}
            defaultValue={defaults.workload_weights.priority_critical}
            disabled={saving}
            onChange={(v) => update({ ww_priority_critical: v })}
          />
          <NumberField
            id="ww_priority_high"
            label="High"
            value={draft.ww_priority_high}
            defaultValue={defaults.workload_weights.priority_high}
            disabled={saving}
            onChange={(v) => update({ ww_priority_high: v })}
          />
          <NumberField
            id="ww_priority_medium"
            label="Medium"
            value={draft.ww_priority_medium}
            defaultValue={defaults.workload_weights.priority_medium}
            disabled={saving}
            onChange={(v) => update({ ww_priority_medium: v })}
          />
          <NumberField
            id="ww_priority_low"
            label="Low"
            value={draft.ww_priority_low}
            defaultValue={defaults.workload_weights.priority_low}
            disabled={saving}
            onChange={(v) => update({ ww_priority_low: v })}
          />
        </div>
      </Section>

      <Section
        title="Workload bucket thresholds"
        description="Workload score below Light max → Light; below Balanced max → Balanced; below Heavy max → Heavy; at or above Heavy max → Overloaded. Must satisfy light < balanced < heavy."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            id="wb_light_max"
            label="Light max"
            value={draft.wb_light_max}
            defaultValue={defaults.workload_buckets.light_max}
            disabled={saving}
            onChange={(v) => update({ wb_light_max: v })}
          />
          <NumberField
            id="wb_balanced_max"
            label="Balanced max"
            value={draft.wb_balanced_max}
            defaultValue={defaults.workload_buckets.balanced_max}
            disabled={saving}
            onChange={(v) => update({ wb_balanced_max: v })}
          />
          <NumberField
            id="wb_heavy_max"
            label="Heavy max"
            value={draft.wb_heavy_max}
            defaultValue={defaults.workload_buckets.heavy_max}
            disabled={saving}
            onChange={(v) => update({ wb_heavy_max: v })}
          />
        </div>
      </Section>

      <Section
        title="Performance weights"
        description="The performance score is a weighted average: on-time rate × on-time weight + (1 − blocked rate) × blocked weight. Set one to zero to ignore that factor."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            id="pw_on_time"
            label="On-time weight"
            value={draft.pw_on_time}
            defaultValue={defaults.performance_weights.on_time}
            disabled={saving}
            onChange={(v) => update({ pw_on_time: v })}
          />
          <NumberField
            id="pw_blocked_inverse"
            label="Blocked-inverse weight"
            value={draft.pw_blocked_inverse}
            defaultValue={defaults.performance_weights.blocked_inverse}
            disabled={saving}
            onChange={(v) => update({ pw_blocked_inverse: v })}
          />
        </div>
      </Section>

      <Section
        title="Performance score thresholds"
        description="Score at or above Green min → Green; at or above Yellow min → Yellow; otherwise Red. Below Yellow min the resource needs attention. Scores range 0 to 1; must satisfy yellow_min < green_min."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            id="pt_yellow_min"
            label="Yellow min"
            value={draft.pt_yellow_min}
            defaultValue={defaults.performance_thresholds.yellow_min}
            disabled={saving}
            onChange={(v) => update({ pt_yellow_min: v })}
          />
          <NumberField
            id="pt_green_min"
            label="Green min"
            value={draft.pt_green_min}
            defaultValue={defaults.performance_thresholds.green_min}
            disabled={saving}
            onChange={(v) => update({ pt_green_min: v })}
          />
          <NumberField
            id="performance_window_days"
            label="Window"
            value={draft.performance_window_days}
            defaultValue={defaults.performance_window_days}
            suffix="days"
            help="How far back to look for completed tasks when computing the score."
            disabled={saving}
            onChange={(v) => update({ performance_window_days: v })}
          />
        </div>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={resetToDefaults}
          disabled={saving}
          className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save thresholds"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-xs text-gray-600">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  defaultValue: number;
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
          step="any"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:bg-gray-50"
        />
        {suffix ? (
          <span className="text-sm text-gray-500">{suffix}</span>
        ) : null}
      </div>
      {help ? <p className="mt-1 text-[11px] text-gray-500">{help}</p> : null}
    </div>
  );
}
