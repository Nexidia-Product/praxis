"use client";

/**
 * Per-resource detail view.
 *
 * Server-passes a single `ResourceRosterRow` already built; we just
 * render. Sections:
 *
 *   - Hero KPIs: workload bucket + score breakdown, performance
 *     bucket + 90-day metrics, last activity
 *   - Active projects table: every project the resource is on
 *   - Open tasks table: their open tasks, with past-due / blocked
 *     visually flagged
 *   - Bottleneck section: tasks they're blocking for someone else
 *
 * Charts (cycle time trend, on-time history) come in the next
 * sweep. This stub gives the Overview drill-down somewhere to
 * land and exposes the data the Overview alludes to.
 */

import Link from "next/link";

import type { ResourceRosterRow } from "@/lib/resources/roster";
import type { ResourceSettings } from "@/lib/db";

interface ResourceDetailProps {
  row: ResourceRosterRow;
  thresholds: ResourceSettings["workload_buckets"];
}

export function ResourceDetail({ row, thresholds }: ResourceDetailProps) {
  return (
    <div className="space-y-4">
      {row.free_text_only ? (
        <div role="status" className="pol-notice pol-notice-warn">
          <span aria-hidden="true">!</span>
          <span>
            This resource is referenced only as a free-text name. Linking
            them to a real user account on the affected projects will
            give more accurate performance metrics.
          </span>
        </div>
      ) : null}

      {/* Hero KPI strip — same shape as the Overview KPIs but
          scoped to this person and slightly larger. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        <HeroCard title="Workload">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Bucket value={row.workload_bucket} />
            <span style={{ color: "var(--tm)", fontSize: "var(--fs-sm)" }}>
              score {row.workload_score}
            </span>
          </div>
          <Breakdown row={row} />
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--tm)" }}>
            Bucket thresholds: light &lt; {thresholds.light_max}, balanced
            &lt; {thresholds.balanced_max}, heavy &lt; {thresholds.heavy_max},
            overloaded ≥ {thresholds.heavy_max}.
          </p>
        </HeroCard>

        <HeroCard title="Performance (90-day)">
          {row.performance_bucket === "Insufficient" ? (
            <div style={{ color: "var(--tm)", fontSize: "var(--fs-sm)" }}>
              Not enough completed tasks in the window for a meaningful
              score. Comes alive after a few completions.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <PerfBucket value={row.performance_bucket} />
                <span style={{ color: "var(--tm)", fontSize: "var(--fs-sm)" }}>
                  score {(row.performance_score ?? 0).toFixed(2)}
                </span>
              </div>
              <ul
                style={{
                  marginTop: 6,
                  paddingLeft: 16,
                  fontSize: 12,
                  color: "var(--t2)",
                }}
              >
                <li>
                  {row.completed_tasks_in_window} task
                  {row.completed_tasks_in_window === 1 ? "" : "s"} completed
                </li>
                <li>
                  On-time rate:{" "}
                  {row.on_time_rate !== null
                    ? `${(row.on_time_rate * 100).toFixed(0)}%`
                    : "—"}
                </li>
                <li>
                  Blocked rate:{" "}
                  {row.blocked_day_rate !== null
                    ? `${(row.blocked_day_rate * 100).toFixed(0)}%`
                    : "—"}
                </li>
              </ul>
            </>
          )}
        </HeroCard>

        <HeroCard title="At a glance">
          <ul
            style={{
              paddingLeft: 16,
              fontSize: 12,
              color: "var(--t2)",
              lineHeight: 1.7,
            }}
          >
            <li>{row.active_projects.length} active projects</li>
            <li>{row.open_tasks.length} open tasks</li>
            <li
              style={{
                color: row.past_due_tasks.length > 0 ? "var(--err)" : undefined,
              }}
            >
              {row.past_due_tasks.length} past-due
            </li>
            <li
              style={{
                color: row.blocked_tasks.length > 0 ? "var(--err)" : undefined,
              }}
            >
              {row.blocked_tasks.length} blocked
            </li>
            <li
              style={{
                color:
                  row.bottleneck_tasks.length > 0
                    ? "var(--warn-text, #92400e)"
                    : undefined,
              }}
            >
              {row.bottleneck_tasks.length} bottleneck
              {row.bottleneck_tasks.length === 1 ? "" : "s"} for others
            </li>
            <li>
              Last activity: {formatLastActivity(row.last_activity_at)}
            </li>
          </ul>
        </HeroCard>
      </div>

      {/* Active projects */}
      <Card title={`Active projects (${row.active_projects.length})`}>
        {row.active_projects.length === 0 ? (
          <Empty text="No active project assignments." />
        ) : (
          <SimpleTable
            headers={["ID", "Name", "Status", "Phase", "Health", "Target"]}
          >
            {row.active_projects.map((p) => (
              <tr key={p.project_id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={tdStyle}>
                  <Link
                    href={`/projects?id=${p.project_id}`}
                    style={{ color: "var(--brand)", fontFamily: "monospace" }}
                  >
                    {p.project_id}
                  </Link>
                </td>
                <td style={tdStyle}>{p.name}</td>
                <td style={tdStyle}>{p.status}</td>
                <td style={tdStyle}>{p.phase}</td>
                <td style={tdStyle}>
                  <HealthDot value={p.health_score} />{" "}
                  <span style={{ color: "var(--t2)" }}>
                    {p.health_score ?? "—"}
                  </span>
                </td>
                <td style={tdStyle}>{p.target_date ?? "—"}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Card>

      {/* Open tasks */}
      <Card title={`Open tasks (${row.open_tasks.length})`}>
        {row.open_tasks.length === 0 ? (
          <Empty text="No open tasks." />
        ) : (
          <SimpleTable
            headers={["ID", "Task", "Project", "Status", "Priority", "Target"]}
          >
            {row.open_tasks.map((t) => {
              const isPastDue = row.past_due_tasks.some(
                (pd) => pd.task_id === t.task_id,
              );
              const isBlocked = row.blocked_tasks.some(
                (b) => b.task_id === t.task_id,
              );
              return (
                <tr
                  key={t.task_id}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={tdStyle}>
                    <Link
                      href={`/tasks?id=${t.task_id}`}
                      style={{
                        color: "var(--brand)",
                        fontFamily: "monospace",
                      }}
                    >
                      {t.task_id}
                    </Link>
                  </td>
                  <td style={tdStyle}>{t.task_name}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", color: "var(--tm)", fontSize: 11 }}>
                    {t.project_id}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        color: isBlocked ? "var(--err)" : undefined,
                        fontWeight: isBlocked ? 600 : undefined,
                      }}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td style={tdStyle}>{t.priority}</td>
                  <td
                    style={{
                      ...tdStyle,
                      color: isPastDue ? "var(--err)" : undefined,
                      fontWeight: isPastDue ? 600 : undefined,
                    }}
                  >
                    {t.target_date ?? "—"}
                  </td>
                </tr>
              );
            })}
          </SimpleTable>
        )}
      </Card>

      {/* Bottlenecks — only render if non-zero, since the message is
          either substantive or absent. */}
      {row.bottleneck_tasks.length > 0 ? (
        <Card title={`Blocking other people (${row.bottleneck_tasks.length})`}>
          <p
            style={{
              marginBottom: 8,
              fontSize: 12,
              color: "var(--warn-text, #92400e)",
            }}
          >
            These tasks own work that someone else is structurally blocked
            on. Resolving them unblocks downstream work.
          </p>
          <SimpleTable
            headers={["ID", "Task", "Status", "Priority", "Target"]}
          >
            {row.bottleneck_tasks.map((t) => (
              <tr
                key={t.task_id}
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td style={tdStyle}>
                  <Link
                    href={`/tasks?id=${t.task_id}`}
                    style={{
                      color: "var(--brand)",
                      fontFamily: "monospace",
                    }}
                  >
                    {t.task_id}
                  </Link>
                </td>
                <td style={tdStyle}>{t.task_name}</td>
                <td style={tdStyle}>{t.status}</td>
                <td style={tdStyle}>{t.priority}</td>
                <td style={tdStyle}>{t.target_date ?? "—"}</td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "var(--fs-sm)",
};

function HeroCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pol-card" style={{ padding: 14 }}>
      <div
        style={{
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--tm)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pol-card" style={{ padding: 0 }}>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: "var(--fs-sm)",
          fontWeight: 700,
          color: "var(--t1)",
        }}
      >
        {title}
      </div>
      <div style={{ padding: 0 }}>{children}</div>
    </div>
  );
}

function SimpleTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full">
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
          {headers.map((h) => (
            <th key={h} style={{ padding: "8px 12px" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody style={{ background: "var(--card)" }}>{children}</tbody>
    </table>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        color: "var(--tm)",
        fontSize: "var(--fs-sm)",
      }}
    >
      {text}
    </div>
  );
}

function Bucket({ value }: { value: ResourceRosterRow["workload_bucket"] }) {
  const bg =
    value === "Overloaded"
      ? "var(--err-bg, #fee2e2)"
      : value === "Heavy"
        ? "var(--warn-bg, #fef3c7)"
        : value === "Balanced"
          ? "var(--ok-bg, #dcfce7)"
          : "#f3f4f6";
  const fg =
    value === "Overloaded"
      ? "var(--err)"
      : value === "Heavy"
        ? "var(--warn-text, #92400e)"
        : value === "Balanced"
          ? "var(--ok)"
          : "var(--t2)";
  return (
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
      {value}
    </span>
  );
}

function PerfBucket({
  value,
}: {
  value: ResourceRosterRow["performance_bucket"];
}) {
  const bg =
    value === "Green"
      ? "var(--ok-bg, #dcfce7)"
      : value === "Yellow"
        ? "var(--warn-bg, #fef3c7)"
        : value === "Red"
          ? "var(--err-bg, #fee2e2)"
          : "#f3f4f6";
  const fg =
    value === "Green"
      ? "var(--ok)"
      : value === "Yellow"
        ? "var(--warn-text, #92400e)"
        : value === "Red"
          ? "var(--err)"
          : "var(--tm)";
  return (
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
      {value}
    </span>
  );
}

function HealthDot({ value }: { value: "Red" | "Yellow" | "Green" | null }) {
  const color =
    value === "Red"
      ? "var(--err)"
      : value === "Yellow"
        ? "var(--warn-text, #92400e)"
        : value === "Green"
          ? "var(--ok)"
          : "var(--tm)";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}

function Breakdown({ row }: { row: ResourceRosterRow }) {
  const b = row.workload_breakdown;
  const items: { label: string; value: number }[] = [
    { label: "Projects", value: b.project_assignments },
    { label: "Open tasks", value: b.open_tasks },
    { label: "Past-due", value: b.past_due_tasks },
    { label: "Bottleneck", value: b.bottleneck_tasks },
  ];
  return (
    <ul
      style={{
        marginTop: 6,
        paddingLeft: 16,
        fontSize: 12,
        color: "var(--t2)",
      }}
    >
      {items.map((it) => (
        <li key={it.label}>
          {it.label}: <span style={{ color: "var(--t1)" }}>{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

function formatLastActivity(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
