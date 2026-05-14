"use client";

/**
 * Admin Notifications panel (Section 5.12).
 *
 * Single-action page: a button that fires the manual sweep route. After
 * a run, displays the per-phase counts so the operator can validate
 * what fired (and confirm idempotency by clicking again — the second
 * click reports zero new in-app notifications because the dedup keys
 * skip already-notified entities).
 *
 * "Health-recalc attempted" reflects whether the health-recalc hook
 * was registered when the sweep ran (Step 8's hook). It's a count of
 * projects examined, not necessarily projects whose score changed.
 */

import { useState } from "react";

interface SweepResult {
  due_soon_notified: number;
  overdue_notified: number;
  digests_sent: number;
  purged_old: number;
  health_recalc_attempted: number;
  duration_ms: number;
}

type Message =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

export function NotificationsAdmin() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [lastResult, setLastResult] = useState<SweepResult | null>(null);
  const [lastRanAt, setLastRanAt] = useState<string | null>(null);

  async function runSweep() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/notifications/sweep", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as
        | SweepResult
        | { error?: string };
      if (!res.ok) {
        const err =
          typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : "Sweep failed.";
        setMessage({ kind: "error", text: err });
        return;
      }
      const sweep = data as SweepResult;
      setLastResult(sweep);
      setLastRanAt(new Date().toISOString());
      const total =
        sweep.due_soon_notified +
        sweep.overdue_notified +
        sweep.digests_sent +
        sweep.purged_old;
      setMessage({
        kind: "success",
        text:
          total === 0
            ? `Sweep completed in ${sweep.duration_ms}ms. Nothing new to do — all eligible notifications already fired today.`
            : `Sweep completed in ${sweep.duration_ms}ms. See per-phase counts below.`,
      });
    } catch (err) {
      setMessage({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Sweep failed with an unknown error.",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div
          role="alert"
          className={
            message.kind === "success"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          }
        >
          {message.text}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">
          Run notifications sweep
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Triggers the same job that runs daily on a schedule:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            <strong>Task Due Soon</strong> — fires for active tasks whose
            target date is within 3 days (configurable).
          </li>
          <li>
            <strong>Task Overdue</strong> — fires for active tasks whose
            target date has passed.
          </li>
          <li>
            <strong>Digests</strong> — sends one daily digest email per user
            in digest mode with unread Email-enabled notifications.
          </li>
          <li>
            <strong>Purge</strong> — deletes read in-app notifications older
            than 90 days.
          </li>
          <li>
            <strong>Health recalc</strong> — recomputes every project's
            health score (notifications fire on Green→Yellow / Yellow→Red
            transitions).
          </li>
        </ul>
        <p className="mt-3 text-sm text-gray-600">
          The sweep is idempotent — running it twice in a row produces zero
          new notifications the second time, since each phase de-duplicates
          against entries written earlier the same day.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runSweep}
            disabled={running}
            className="inline-flex items-center justify-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Running…" : "Run sweep now"}
          </button>
          {lastRanAt ? (
            <span className="text-xs text-gray-500">
              Last run:{" "}
              <time dateTime={lastRanAt}>
                {new Date(lastRanAt).toLocaleString()}
              </time>
            </span>
          ) : null}
        </div>
      </div>

      {lastResult ? (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">
            Last sweep result
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SweepStat
              label="Due-soon notified"
              value={lastResult.due_soon_notified}
              hint="Tasks within the 3-day lead window."
            />
            <SweepStat
              label="Overdue notified"
              value={lastResult.overdue_notified}
              hint="Tasks past their target date."
            />
            <SweepStat
              label="Digests sent"
              value={lastResult.digests_sent}
              hint="Users in digest mode with unread items."
            />
            <SweepStat
              label="Old read purged"
              value={lastResult.purged_old}
              hint="Read in-app notifications older than 90 days."
            />
            <SweepStat
              label="Health-recalc projects"
              value={lastResult.health_recalc_attempted}
              hint="Number of projects whose score was re-evaluated."
            />
            <SweepStat
              label="Duration"
              value={`${lastResult.duration_ms}ms`}
              hint="Wall-clock time for the full sweep."
            />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function SweepStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {value}
      </dd>
      <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
    </div>
  );
}
