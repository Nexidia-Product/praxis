"use client";

/**
 * Resources workspace — client side of the Insights → Resources page.
 *
 * Owns the tab strip and the Overview tab content (KPI strip, scope
 * toggle, roster table, free-text-resources warning). The Capacity
 * and Performance tabs are rendered as placeholder cards in this
 * sweep — the next sweeps fill them in. The "open detail" row
 * action navigates to /insights/resources/[user_id] (also stubbed
 * for now; click is wired so the navigation works once that page
 * lands).
 *
 * State strategy: tab + scope live in the URL so a teammate's
 * "look at this" link round-trips. The roster is server-rendered
 * and passed in; sort state for the table is client-only.
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CapacityTab } from "./capacity-tab";
import { PerformanceTab } from "./performance-tab";
import type {
  ResourcePerformanceSeries,
  ResourceRosterRow,
  ResourceScope,
} from "@/lib/resources/roster";
import type { ResourceSettings } from "@/lib/db";

interface ResourcesWorkspaceProps {
  initialTab: "overview" | "capacity" | "performance";
  scope: ResourceScope;
  canViewAll: boolean;
  roster: ResourceRosterRow[];
  /**
   * Total resource count before scoping — surfaced as "showing N of
   * M" so a Project Lead can see how many people they're filtered
   * down from.
   */
  rosterTotal: number;
  thresholds: ResourceSettings["workload_buckets"];
  /** Performance series (one per scoped resource), for the Performance tab. */
  perfSeries: ResourcePerformanceSeries[];
  perfThresholds: ResourceSettings["performance_thresholds"];
  perfWindowDays: number;
}

export function ResourcesWorkspace({
  initialTab,
  scope,
  canViewAll,
  roster,
  rosterTotal,
  thresholds,
  perfSeries,
  perfThresholds,
  perfWindowDays,
}: ResourcesWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Keep tab in URL so deep links work and back/forward navigates
  // tabs correctly. Mirrors the velocity dashboard pattern.
  function setTab(next: "overview" | "capacity" | "performance"): void {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`/insights/resources?${params.toString()}`);
  }
  function setScope(next: ResourceScope): void {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "everyone") params.set("scope", "everyone");
    else params.delete("scope");
    router.replace(`/insights/resources?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <TabStrip current={initialTab} onChange={setTab} />

      {initialTab === "overview" ? (
        <OverviewTab
          roster={roster}
          rosterTotal={rosterTotal}
          scope={scope}
          canViewAll={canViewAll}
          onScopeChange={setScope}
          thresholds={thresholds}
        />
      ) : null}

      {initialTab === "capacity" ? (
        <CapacityTab roster={roster} />
      ) : null}

      {initialTab === "performance" ? (
        <PerformanceTab
          roster={roster}
          series={perfSeries}
          thresholds={perfThresholds}
          windowDays={perfWindowDays}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab strip
// ---------------------------------------------------------------------------

function TabStrip({
  current,
  onChange,
}: {
  current: "overview" | "capacity" | "performance";
  onChange: (next: "overview" | "capacity" | "performance") => void;
}) {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "capacity", label: "Capacity" },
    { id: "performance", label: "Performance" },
  ] as const;
  return (
    <nav
      role="tablist"
      aria-label="Resource insights"
      className="flex border-b border-gray-200"
    >
      {tabs.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={
              active
                ? "-mb-px border-b-2 border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900"
            }
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

type SortKey =
  | "resource"
  | "active_projects"
  | "open_tasks"
  | "past_due"
  | "blocked"
  | "workload"
  | "performance"
  | "last_activity";
type SortDir = "asc" | "desc";

function OverviewTab({
  roster,
  rosterTotal,
  scope,
  canViewAll,
  onScopeChange,
  thresholds,
}: {
  roster: ResourceRosterRow[];
  rosterTotal: number;
  scope: ResourceScope;
  canViewAll: boolean;
  onScopeChange: (next: ResourceScope) => void;
  thresholds: ResourceSettings["workload_buckets"];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("workload");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => sortRoster(roster, sortKey, sortDir), [
    roster,
    sortKey,
    sortDir,
  ]);

  // KPI counts. Computed from the *visible* roster (post-scope) so
  // Project Leads see "my team" numbers, Admins see all-team.
  const kpis = useMemo(() => {
    let overloaded = 0;
    let heavy = 0;
    let light = 0;
    let pastDue = 0;
    let blocked = 0;
    let bottleneck = 0;
    for (const r of roster) {
      if (r.workload_bucket === "Overloaded") overloaded++;
      else if (r.workload_bucket === "Heavy") heavy++;
      else if (r.workload_bucket === "Light") light++;
      pastDue += r.past_due_tasks.length;
      blocked += r.blocked_tasks.length;
      bottleneck += r.bottleneck_tasks.length;
    }
    return { overloaded, heavy, light, pastDue, blocked, bottleneck };
  }, [roster]);

  const freeTextCount = useMemo(
    () => roster.filter((r) => r.free_text_only).length,
    [roster],
  );

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "resource" ? "asc" : "desc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="toolbar">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            flexWrap: "wrap",
          }}
        >
          <ScopeToggle
            scope={scope}
            canViewAll={canViewAll}
            onChange={onScopeChange}
          />
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--tm)" }}>
            Showing {roster.length}
            {scope === "my_team" && rosterTotal > roster.length
              ? ` of ${rosterTotal} resources`
              : roster.length === 1
                ? " resource"
                : " resources"}
          </span>
        </div>
      </div>

      {freeTextCount > 0 ? (
        <div role="status" className="pol-notice pol-notice-warn">
          <span aria-hidden="true">!</span>
          <span>
            <strong>{freeTextCount}</strong>{" "}
            {freeTextCount === 1 ? "resource" : "resources"} on this page is
            referenced only as a free-text name and not yet linked to a user
            account. Performance metrics for unlinked resources rely on string
            matching and may miss tasks. Replace with a real user assignment
            on the affected projects when you go live.
          </span>
        </div>
      ) : null}

      <KpiStrip kpis={kpis} totalResources={roster.length} />

      <div className="pol-card" style={{ padding: 0 }}>
        <table className="w-full" style={{ fontSize: "var(--fs-sm)" }}>
          <thead>
            <tr
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "var(--tm)",
                textAlign: "left",
              }}
            >
              <SortableTh
                label="Resource"
                col="resource"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <SortableTh
                label="Workload"
                col="workload"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableTh
                label="Performance"
                col="performance"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableTh
                label="Active projects"
                col="active_projects"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableTh
                label="Open tasks"
                col="open_tasks"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableTh
                label="Past due"
                col="past_due"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableTh
                label="Blocked"
                col="blocked"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableTh
                label="Last activity"
                col="last_activity"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
              />
            </tr>
          </thead>
          <tbody style={{ background: "var(--card)" }}>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: 32,
                    textAlign: "center",
                    color: "var(--tm)",
                    fontSize: "var(--fs-sm)",
                  }}
                >
                  No resources found.
                  {scope === "my_team" && canViewAll
                    ? " Try the Everyone scope."
                    : ""}
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <RosterRow key={r.resource} row={r} thresholds={thresholds} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({
  kpis,
  totalResources,
}: {
  kpis: {
    overloaded: number;
    heavy: number;
    light: number;
    pastDue: number;
    blocked: number;
    bottleneck: number;
  };
  totalResources: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
      }}
    >
      <Kpi
        label="Overloaded"
        value={kpis.overloaded}
        sublabel={`of ${totalResources} resources`}
        tone={kpis.overloaded > 0 ? "err" : "neutral"}
      />
      <Kpi
        label="Heavy load"
        value={kpis.heavy}
        sublabel="trending toward overload"
        tone={kpis.heavy > 0 ? "warn" : "neutral"}
      />
      <Kpi
        label="Past-due tasks"
        value={kpis.pastDue}
        sublabel="across all resources"
        tone={kpis.pastDue > 0 ? "err" : "neutral"}
      />
      <Kpi
        label="Bottleneck tasks"
        value={kpis.bottleneck}
        sublabel="blocking other people"
        tone={kpis.bottleneck > 0 ? "warn" : "neutral"}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: number;
  sublabel: string;
  tone: "err" | "warn" | "ok" | "neutral";
}) {
  const valueColor =
    tone === "err"
      ? "var(--err)"
      : tone === "warn"
        ? "var(--warn-text, #92400e)"
        : tone === "ok"
          ? "var(--ok)"
          : "var(--t1)";
  return (
    <div className="pol-card" style={{ padding: "12px 14px" }}>
      <div
        style={{
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--tm)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: valueColor,
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
        {sublabel}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope toggle
// ---------------------------------------------------------------------------

function ScopeToggle({
  scope,
  canViewAll,
  onChange,
}: {
  scope: ResourceScope;
  canViewAll: boolean;
  onChange: (next: ResourceScope) => void;
}) {
  const options: { id: ResourceScope; label: string }[] = [
    { id: "my_team", label: "My team" },
    { id: "everyone", label: "Everyone" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: "var(--pol-radius)",
        background: "var(--card)",
        padding: 2,
      }}
    >
      {options.map((opt) => {
        const active = scope === opt.id;
        const disabled = opt.id === "everyone" && !canViewAll;
        // Tooltip text spells out exactly what each scope means
        // (RES-05). Without this, "My team" reads as "just me" to
        // someone who isn't a project lead, which mismatches the
        // implemented semantic of "people on projects I lead".
        const tip = disabled
          ? "Requires the resources.view_all permission."
          : opt.id === "my_team"
            ? "Yourself plus anyone assigned to a project you lead."
            : "Every resource across the organization.";
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => !disabled && onChange(opt.id)}
            disabled={disabled}
            title={tip}
            style={{
              padding: "3px 12px",
              border: "none",
              borderRadius: 2,
              fontSize: 12,
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              background: active ? "var(--brand)" : "transparent",
              color: active ? "#fff" : "var(--t2)",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster row
// ---------------------------------------------------------------------------

function RosterRow({
  row,
  thresholds,
}: {
  row: ResourceRosterRow;
  thresholds: ResourceSettings["workload_buckets"];
}) {
  const router = useRouter();

  function openDetail() {
    if (row.user_id) {
      router.push(`/insights/resources/${row.user_id}`);
    }
    // Free-text-only rows have no user_id and no detail page; the
    // hover state already tells the user the row isn't clickable.
  }

  const clickable = row.user_id !== null;

  return (
    <tr
      onClick={clickable ? openDetail : undefined}
      className={
        clickable
          ? "cursor-pointer hover:bg-gray-50"
          : "cursor-not-allowed"
      }
      style={{
        borderTop: "1px solid var(--border)",
        opacity: clickable ? 1 : 0.7,
      }}
    >
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontWeight: 600, color: "var(--t1)" }}>
          {row.resource}
          {row.free_text_only ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: "var(--warn-text, #92400e)",
                background: "var(--warn-bg, #fef3c7)",
                padding: "1px 5px",
                borderRadius: 2,
                fontWeight: 700,
              }}
              title="Referenced as a free-text name; not yet linked to a user account."
            >
              UNLINKED
            </span>
          ) : null}
        </div>
        {row.bottleneck_tasks.length > 0 ? (
          <div
            style={{ fontSize: 11, color: "var(--warn-text, #92400e)", marginTop: 2 }}
          >
            ⚠ Blocking {row.bottleneck_tasks.length}{" "}
            {row.bottleneck_tasks.length === 1 ? "task" : "tasks"} elsewhere
          </div>
        ) : null}
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        <WorkloadCell row={row} thresholds={thresholds} />
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        <PerformanceCell row={row} />
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--t2)" }}>
        {row.active_projects.length}
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--t2)" }}>
        {row.open_tasks.length}
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        {row.past_due_tasks.length > 0 ? (
          <span
            style={{
              fontWeight: 700,
              color: "var(--err)",
            }}
          >
            {row.past_due_tasks.length}
          </span>
        ) : (
          <span style={{ color: "var(--tm)" }}>0</span>
        )}
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        {row.blocked_tasks.length > 0 ? (
          <span
            style={{
              fontWeight: 700,
              color: "var(--err)",
            }}
          >
            {row.blocked_tasks.length}
          </span>
        ) : (
          <span style={{ color: "var(--tm)" }}>0</span>
        )}
      </td>
      <td
        style={{ padding: "10px 12px", color: "var(--tm)", fontSize: 11 }}
      >
        {formatLastActivity(row.last_activity_at)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Workload cell — bucket badge + score, with a tooltip-style hover
// ---------------------------------------------------------------------------

function WorkloadCell({
  row,
  thresholds,
}: {
  row: ResourceRosterRow;
  thresholds: ResourceSettings["workload_buckets"];
}) {
  const bucket = row.workload_bucket;
  const tone =
    bucket === "Overloaded"
      ? "err"
      : bucket === "Heavy"
        ? "warn"
        : bucket === "Balanced"
          ? "ok"
          : "neutral";
  const badgeStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    background:
      tone === "err"
        ? "var(--err-bg, #fee2e2)"
        : tone === "warn"
          ? "var(--warn-bg, #fef3c7)"
          : tone === "ok"
            ? "var(--ok-bg, #dcfce7)"
            : "#f3f4f6",
    color:
      tone === "err"
        ? "var(--err)"
        : tone === "warn"
          ? "var(--warn-text, #92400e)"
          : tone === "ok"
            ? "var(--ok)"
            : "var(--t2)",
  };
  const tip = [
    `Score ${row.workload_score}`,
    `  Projects: ${row.workload_breakdown.project_assignments}`,
    `  Open tasks: ${row.workload_breakdown.open_tasks}`,
    `  Past-due: ${row.workload_breakdown.past_due_tasks}`,
    `  Bottleneck: ${row.workload_breakdown.bottleneck_tasks}`,
    "",
    `Bucket thresholds — light < ${thresholds.light_max}, balanced < ${thresholds.balanced_max}, heavy < ${thresholds.heavy_max}, overloaded ≥ ${thresholds.heavy_max}`,
  ].join("\n");
  return (
    <span title={tip}>
      <span style={badgeStyle}>{bucket}</span>{" "}
      <span style={{ color: "var(--tm)", fontSize: 11 }}>
        {row.workload_score}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Performance cell — Red/Yellow/Green pill
// ---------------------------------------------------------------------------

function PerformanceCell({ row }: { row: ResourceRosterRow }) {
  if (row.performance_bucket === "Insufficient") {
    return (
      <span
        title="Not enough completed tasks in the configured window for a meaningful score."
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 2,
          fontSize: 11,
          fontWeight: 600,
          background: "#f3f4f6",
          color: "var(--tm)",
        }}
      >
        —
      </span>
    );
  }
  const bucket = row.performance_bucket;
  const bg =
    bucket === "Green"
      ? "var(--ok-bg, #dcfce7)"
      : bucket === "Yellow"
        ? "var(--warn-bg, #fef3c7)"
        : "var(--err-bg, #fee2e2)";
  const fg =
    bucket === "Green"
      ? "var(--ok)"
      : bucket === "Yellow"
        ? "var(--warn-text, #92400e)"
        : "var(--err)";
  const tip = [
    `Score ${(row.performance_score ?? 0).toFixed(2)}`,
    `Completed: ${row.completed_tasks_in_window} task${row.completed_tasks_in_window === 1 ? "" : "s"} in window`,
    row.on_time_rate !== null
      ? `On-time rate: ${(row.on_time_rate * 100).toFixed(0)}%`
      : "On-time rate: n/a (no targets)",
    row.blocked_day_rate !== null
      ? `Blocked rate: ${(row.blocked_day_rate * 100).toFixed(0)}%`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span title={tip}>
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 2,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          background: bg,
          color: fg,
        }}
      >
        {bucket}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sortable table headers
// ---------------------------------------------------------------------------

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th
      scope="col"
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        textAlign: align,
        userSelect: "none",
      }}
      onClick={() => onClick(col)}
    >
      {label}
      {active ? (
        <span style={{ marginLeft: 4, color: "var(--brand)" }}>
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Sort logic
// ---------------------------------------------------------------------------

function sortRoster(
  roster: ResourceRosterRow[],
  key: SortKey,
  dir: SortDir,
): ResourceRosterRow[] {
  const out = [...roster];
  const m = dir === "asc" ? 1 : -1;
  out.sort((a, b) => {
    switch (key) {
      case "resource":
        return m * a.resource.localeCompare(b.resource);
      case "active_projects":
        return m * (a.active_projects.length - b.active_projects.length);
      case "open_tasks":
        return m * (a.open_tasks.length - b.open_tasks.length);
      case "past_due":
        return m * (a.past_due_tasks.length - b.past_due_tasks.length);
      case "blocked":
        return m * (a.blocked_tasks.length - b.blocked_tasks.length);
      case "workload":
        return m * (a.workload_score - b.workload_score);
      case "performance": {
        // Insufficient → always sort to the end regardless of dir.
        const aIns = a.performance_score === null;
        const bIns = b.performance_score === null;
        if (aIns && !bIns) return 1;
        if (!aIns && bIns) return -1;
        if (aIns && bIns) return 0;
        return (
          m * ((a.performance_score ?? 0) - (b.performance_score ?? 0))
        );
      }
      case "last_activity": {
        const av = a.last_activity_at ?? "";
        const bv = b.last_activity_at ?? "";
        return m * av.localeCompare(bv);
      }
    }
  });
  return out;
}

function formatLastActivity(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const now = new Date();
  const days = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

