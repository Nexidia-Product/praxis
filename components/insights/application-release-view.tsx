"use client";

/**
 * Application Release view.
 *
 * A release-date picker over a grid of per-project cards in the same
 * visual language as the Key Capabilities cards (identity + health
 * header, task-progress strip, latest status note, outcomes), extended
 * with stage, primary objective, use case, schedule-risk and blockers.
 * Read-only: selecting a date just updates `?date=` and the server
 * re-renders.
 */

import { useRouter } from "next/navigation";

import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  priorityBadgeClass,
} from "@/lib/projects/display";
import { formatQuarter, latestStatusSummary } from "@/lib/key-capabilities";
import type { ReleaseDateOption } from "@/lib/releases/calendar";
import type {
  ReleaseProjectEntry,
  ReleaseReport,
} from "@/lib/releases/report";
import { OutcomesList } from "@/components/projects/outcomes-list";

interface Props {
  options: ReleaseDateOption[];
  selectedDate: string | null;
  today: string;
  report: ReleaseReport | null;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ApplicationReleaseView({
  options,
  selectedDate,
  today,
  report,
}: Props) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      {/* Release date picker */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
        <label
          htmlFor="release-date"
          className="text-sm font-medium text-gray-700"
        >
          Release date
        </label>
        <select
          id="release-date"
          value={selectedDate ?? ""}
          onChange={(e) =>
            router.push(
              `/insights/application-release?date=${encodeURIComponent(e.target.value)}`,
            )
          }
          className="min-w-[18rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          {options.length === 0 ? <option value="">No release dates</option> : null}
          {options.map((o) => (
            <option key={o.date} value={o.date}>
              {formatDate(o.date)}
              {o.date === today ? " (today)" : ""}
              {" — "}
              {o.projectCount} project{o.projectCount === 1 ? "" : "s"}
              {o.offCycle ? " (off-cycle)" : ""}
            </option>
          ))}
        </select>
        {selectedDate ? (
          <span className="text-xs text-gray-500">
            {selectedDate < today
              ? "Past release"
              : selectedDate === today
                ? "Releases today"
                : "Upcoming release"}
          </span>
        ) : null}
      </div>

      {report ? (
        <>
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
            <Summary value={report.entries.length} label="projects" />
            <Summary
              value={report.missedCount}
              label="missed delivery"
              danger={report.missedCount > 0}
            />
            <Summary
              value={report.atRiskCount}
              label="at risk"
              danger={report.atRiskCount > 0}
            />
            <Summary
              value={report.blockedCount}
              label="with blockers"
              danger={report.blockedCount > 0}
            />
            <Summary value={report.deliveredCount} label="delivered" />
          </div>

          {report.entries.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              No projects are aligned to this release date.
            </p>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]">
              {report.entries.map((entry) => (
                <ReleaseCard
                  key={entry.project.project_id}
                  entry={entry}
                  today={today}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No release dates available yet.
        </p>
      )}
    </div>
  );
}

function Summary({
  value,
  label,
  danger = false,
}: {
  value: number;
  label: string;
  danger?: boolean;
}) {
  return (
    <span>
      <span
        className={`font-semibold ${danger ? "text-rose-600" : "text-gray-900"}`}
      >
        {value}
      </span>{" "}
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

function ReleaseCard({
  entry,
  today,
}: {
  entry: ReleaseProjectEntry;
  today: string;
}) {
  const { project, stats } = entry;
  const statusSummary = latestStatusSummary(project.status_history);

  return (
    <div
      className={`flex flex-col gap-3 rounded-md border bg-white p-3 shadow-sm ${
        entry.atRisk || entry.missedDelivery
          ? "border-rose-300"
          : "border-gray-200"
      }`}
    >
      {/* Identity + health */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-gray-500">
              {project.project_id}
            </span>
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityBadgeClass(project.priority)}`}
            >
              {project.priority}
            </span>
            {project.is_key_capability ? (
              <span
                className="inline-flex rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                title="Designated key capability"
              >
                Key capability
                {project.key_capability_quarter
                  ? ` · ${formatQuarter(project.key_capability_quarter)}`
                  : ""}
              </span>
            ) : null}
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-gray-900">
            {project.name}
          </h3>
        </div>
        {project.health_score ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[project.health_score]}`}
            title={HEALTH_TOOLTIP[project.health_score]}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health_score]}`}
            />
            {project.health_score}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-gray-400">No health</span>
        )}
      </div>

      {/* At-risk banner */}
      {entry.delivered ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
          Delivered — reached {project.stage} after the {project.target_date}{" "}
          release.
        </div>
      ) : null}

      {entry.atRisk ? (
        <div
          role="alert"
          className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-inset ring-rose-200"
        >
          <div className="font-semibold">
            {entry.missedDelivery
              ? `Missed delivery — ${project.target_date} release`
              : `At risk of missing the ${project.target_date} release`}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {entry.riskReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Classification */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <Fact label="Stage">
          {project.stage || "—"}
          {entry.stageIndex > 0
            ? ` (${entry.stageIndex}/${entry.stageCount})`
            : ""}
        </Fact>
        <Fact label="Status">{project.status}</Fact>
        <Fact label="Primary objective">
          {project.primary_objective || "—"}
        </Fact>
        <Fact label="Use case">
          {entry.useCaseNames.length > 0 ? entry.useCaseNames.join(", ") : "—"}
        </Fact>
        <Fact label="Track">{project.track || "—"}</Fact>
        <Fact label="Lead">{entry.leadName || "—"}</Fact>
        <Fact label="Application deployment">
          {project.target_date || "—"}
        </Fact>
        <Fact label="Executable deployment">
          {project.target_executable_deployment_date || "—"}
        </Fact>
      </dl>

      {/* Planned dates */}
      {entry.milestones.length > 0 ? (
        <div className="text-[11px]">
          <div className="font-medium uppercase tracking-wide text-gray-400">
            Planned dates
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {entry.milestones.map((m) => (
              <li
                key={m.label}
                className={`flex justify-between gap-2 ${
                  m.passed ? "text-gray-400" : "text-gray-600"
                }`}
              >
                <span>
                  {m.label}
                  {m.passed ? " (passed)" : ""}
                </span>
                <span className="font-mono">{m.date}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Task progress */}
      <div className="grid grid-cols-4 gap-2 border-t border-gray-100 pt-2">
        <MiniStat label="Open" value={stats.open} />
        <MiniStat label="Past due" value={stats.pastDue} danger={stats.pastDue > 0} />
        <MiniStat label="Blocked" value={stats.blocked} danger={stats.blocked > 0} />
        <MiniStat label="Done" value={stats.completed} />
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-gray-500">
          <span>
            {stats.completed}/{stats.total} tasks complete
          </span>
          <span className="font-medium text-gray-700">{stats.pctComplete}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${stats.pctComplete}%` }}
          />
        </div>
      </div>

      {/* Blockers */}
      {entry.blockers.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-200">
          <div className="font-semibold uppercase tracking-wide">
            Blocked ({entry.blockers.length})
          </div>
          <ul className="mt-1 space-y-1">
            {entry.blockers.map((b, i) => (
              <li key={`${b.subject}-${i}`}>
                <span className="font-medium">
                  {b.scope === "task" ? "Task " : ""}
                  {b.subject}:
                </span>{" "}
                {b.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Latest status note */}
      <div className="text-[11px] leading-snug">
        <span className="font-medium uppercase tracking-wide text-gray-400">
          Status
        </span>
        {statusSummary ? (
          <p className="mt-0.5 text-gray-600">{statusSummary}</p>
        ) : (
          <p className="mt-0.5 italic text-gray-400">—</p>
        )}
      </div>

      <OutcomesList outcomes={project.outcomes} />
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="truncate text-gray-700" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}

function MiniStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={`text-base font-semibold ${danger ? "text-rose-600" : "text-gray-900"}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
    </div>
  );
}
