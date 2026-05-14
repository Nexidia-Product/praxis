"use client";

/**
 * Notification preferences form (Section 5.12).
 *
 * Renders a row per notification type with two radio choices
 * (InAppOnly | EmailAndInApp) plus a top-level digest_mode
 * checkbox. Saves on submit via PUT `/api/profile/notifications`.
 *
 * Why a single submit instead of save-on-change? The user almost
 * always toggles several rows in one sitting; per-row writes would
 * be chatty and visually noisy. The Save button is right there.
 *
 * Note: a third "Off" option was previously offered but removed —
 * notifications are system signals, not opt-in marketing, so the
 * floor is now "in-app only". Legacy user records carrying "Off"
 * are normalized on read here and at the dispatch layer.
 */

import { useMemo, useState } from "react";

import type {
  NotificationDelivery,
  NotificationPreferences,
  NotificationType,
} from "@/lib/db";

interface PreferencesFormProps {
  initialPreferences: NotificationPreferences;
  initialDigestMode: boolean;
  types: NotificationType[];
  deliveryOptions: NotificationDelivery[];
}

const TYPE_LABELS: Record<NotificationType, { title: string; description: string }> = {
  TaskAssigned: {
    title: "Task assigned to me",
    description:
      "When a task is created with you as the responsible owner, or you are reassigned an existing task.",
  },
  TaskDueSoon: {
    title: "Task due soon",
    description:
      "Daily reminder for tasks within three days of their target date that are still Not Started or In Progress.",
  },
  TaskOverdue: {
    title: "Task overdue",
    description:
      "Daily reminder for tasks past their target date that are still Not Started or In Progress.",
  },
  ProjectBlocked: {
    title: "A project I'm on is blocked",
    description:
      "When a project where you are the lead or an additional resource transitions to Blocked.",
  },
  DependencyBlocked: {
    title: "An upstream dependency is blocked",
    description:
      "When a project that one of your projects depends on transitions to Blocked, On Hold, or Delayed.",
  },
  HealthScoreChanged: {
    title: "Project health degrades",
    description:
      "When a project you're on drops from Green to Yellow, or Yellow to Red. Recoveries are not notified.",
  },
  IdeaStatusChanged: {
    title: "Update on submitted ideas",
    description:
      "Internal users rarely need this; it primarily exists for the public-portal email path.",
  },
};

const DELIVERY_LABELS: Record<NotificationDelivery, string> = {
  InAppOnly: "In-app only",
  EmailAndInApp: "Email + in-app",
  Off: "Off",
};

export function NotificationPreferencesForm({
  initialPreferences,
  initialDigestMode,
  types,
  deliveryOptions,
}: PreferencesFormProps) {
  // Normalize any legacy "Off" value to "InAppOnly" for the UI. Users
  // can no longer set "Off" — see app/api/profile/notifications/route.ts.
  // Older user records may still carry "Off"; without this fix the form
  // would render with no radio selected because "Off" isn't in the
  // options list. The dispatch layer also normalizes on read, so this
  // is purely a display concern.
  const normalized = useMemo<NotificationPreferences>(() => {
    const out = { ...initialPreferences } as NotificationPreferences;
    for (const t of types) {
      if (out[t] === ("Off" as NotificationDelivery)) {
        out[t] = "InAppOnly";
      }
    }
    return out;
  }, [initialPreferences, types]);

  const [prefs, setPrefs] = useState<NotificationPreferences>(normalized);
  const [digestMode, setDigestMode] = useState(initialDigestMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    | { kind: "success"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);

  // The "Off → InAppOnly" normalization should count as a not-yet-saved
  // change — the user opening the page on a legacy record sees a
  // dirty form with InAppOnly visibly chosen, and saving locks it in.
  const dirty = useMemo(() => {
    if (digestMode !== initialDigestMode) return true;
    for (const t of types) {
      if (prefs[t] !== initialPreferences[t]) return true;
    }
    return false;
  }, [prefs, digestMode, initialPreferences, initialDigestMode, types]);

  function setDelivery(type: NotificationType, value: NotificationDelivery) {
    setPrefs((p) => ({ ...p, [type]: value }));
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const r = await fetch("/api/profile/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: prefs,
          digest_mode: digestMode,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setMessage({
          kind: "error",
          text: body.error ?? "Could not save preferences.",
        });
      } else {
        setMessage({ kind: "success", text: "Preferences saved." });
      }
    } catch {
      setMessage({ kind: "error", text: "Network error. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-gray-200 bg-white"
    >
      <div className="border-b border-gray-100 px-5 py-4">
        <p className="text-sm font-semibold text-gray-900">Per-type delivery</p>
        <p className="mt-0.5 text-xs text-gray-500">
          &ldquo;In-app only&rdquo; still shows the bell badge — it just
          skips email.
        </p>
      </div>

      <ul className="divide-y divide-gray-100">
        {types.map((type) => {
          const label = TYPE_LABELS[type];
          const selected = prefs[type];
          return (
            <li key={type} className="px-5 py-4">
              <p className="text-sm font-medium text-gray-900">
                {label.title}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {label.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {deliveryOptions.map((option) => (
                  <label
                    key={option}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      selected === option
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`delivery-${type}`}
                      value={option}
                      checked={selected === option}
                      onChange={() => setDelivery(type, option)}
                      className="sr-only"
                    />
                    {DELIVERY_LABELS[option]}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={digestMode}
            onChange={(e) => {
              setDigestMode(e.currentTarget.checked);
              setMessage(null);
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="font-medium text-gray-900">Daily digest mode</span>
        </label>
        <p className="mt-1 pl-6 text-xs text-gray-500">
          Receive one summary email per day instead of per-event emails.
          In-app notifications still appear in real time.
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
        <div className="text-xs">
          {message ? (
            <span
              className={
                message.kind === "success"
                  ? "text-green-700"
                  : "text-red-700"
              }
            >
              {message.text}
            </span>
          ) : (
            <span className="text-gray-500">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!dirty || saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
